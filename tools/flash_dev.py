#!/usr/bin/env python3
"""Safety logic and orchestration behind tools/flash-dev.ps1 (stdlib only; runs inside the ESP-IDF environment).

Flashes the DEVELOPMENT image of this repository to an ESP32-S3 N16R8 over its native USB port and verifies that it
enumerates. It writes exactly three regions (bootloader 0x0, partition table 0x8000, app 0x20000) and never touches the
credential store (`part0`), nvs, phy_init or eFuses. There is no override for any of these stop conditions.

Exit codes: 0 PASS / dry run ok, 1 failure, 2 prerequisite or argument problem, 3 no or ambiguous device,
4 user declined, 5 storage-safety stop, 6 verification FAIL.

Pure functions (everything above `run_flash`) are unit-tested in tests/flash/test_flash_dev.py without hardware.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EXIT_OK, EXIT_FAIL, EXIT_PREREQ, EXIT_DEVICE, EXIT_DECLINED, EXIT_STORAGE, EXIT_VERIFY = 0, 1, 2, 3, 4, 5, 6

# Shared with tools/package_firmware.py and the web installer (web/src/lib/firmware/policy.ts).
POLICY = json.loads((Path(__file__).resolve().parent / "flash_policy.json").read_text(encoding="utf-8"))

# The only offsets this tool may write: (offset, role).
ALLOWED_WRITES = {w["offset"]: w["role"] for w in POLICY["allowed_writes"]}
MAX_IMAGE_SIZE = {w["offset"]: w["max_size"] for w in POLICY["allowed_writes"] if "max_size" in w}
APP_OFFSET = next(w["offset"] for w in POLICY["allowed_writes"] if w["role"] == "app")
PROTECTED = tuple(POLICY["protected_partitions"])  # partitions whose range no image may touch
PARTITION_TABLE_OFFSET = POLICY["partition_table"]["offset"]
PARTITION_TABLE_LEN = POLICY["partition_table"]["read_length"]
CREDENTIAL_PARTITION = POLICY["credential_partition"]

NATIVE_DOWNLOAD = tuple(POLICY["native_usb"]["download"])
NATIVE_APP = tuple(POLICY["native_usb"]["app"])
UART_BRIDGES = {(vid, pid): name for vid, pid, name in POLICY["uart_bridges"]}

# Hardware profiles: one per supported flash size. All use the same partition table (it ends at 0x300000, below 4 MiB).
PROFILES: dict = {p["id"]: p for p in POLICY["profiles"]}
DEFAULT_PROFILE = POLICY["default_profile"]
SIZE_CODES = {"4MB": 2, "8MB": 3, "16MB": 4}  # image header byte 3, high nibble
MODE_CODES = {"qio": 0, "qout": 1, "dio": 2, "dout": 3}  # image header byte 2
FREQ_CODES = {"80m": 0xF}  # image header byte 3, low nibble

APP_DESC_MAGIC = 0xABCD5432
APP_DESC_IMAGE_OFFSET = 0x20  # esp_app_desc_t follows the 24-byte image header and the 8-byte segment header

# Argument tokens that must never appear in any command this tool runs.
FORBIDDEN_TOKENS = ("erase_flash", "erase-flash", "erase_region", "erase-region", "--erase-all", "-e",
                    "espefuse", "espsecure", "burn", "burn_efuse", "burn-efuse", "write_flash_status")


IDF_MISSING = ("ESP-IDF v5.5.x not found. One-time setup: install ESP-IDF v5.5.6 "
               "(https://docs.espressif.com/projects/esp-idf/en/v5.5.6/esp32s3/get-started/windows-setup.html) "
               "then rerun, or pass -IdfPath.")


class Stop(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# --------------------------------------------------------------------------- pure helpers

def profile(hw: str) -> dict:
    try:
        return PROFILES[hw]
    except KeyError:
        raise ValueError(f"unknown hardware profile {hw!r} (known: {', '.join(sorted(PROFILES))})") from None


def supported_flash_sizes() -> list:
    """Flash sizes of every profile, ascending (['4MB', '8MB', '16MB'])."""
    return sorted({p["flash_size"] for p in PROFILES.values()}, key=lambda s: SIZE_CODES[s])


def build_tag(app: str, sec_profile: str, hw: str, hardened: bool = False) -> str:
    """Build directory / sdkconfig tag. The default (16 MB) profile keeps the historical `fido-dev` form."""
    profile(hw)
    suffix = "" if hw == DEFAULT_PROFILE else "-" + hw.removeprefix("esp32s3-")
    return f"{app}-{sec_profile}" + ("-hardened" if hardened else "") + suffix


def flash_fragment(hw: str) -> str:
    """sdkconfig defaults that select the profile's flash size and mode (layered over sdkconfig.defaults)."""
    prof = profile(hw)
    lines = [f"CONFIG_ESPTOOLPY_FLASHSIZE_{prof['flash_size']}=y"]
    lines += [f"# CONFIG_ESPTOOLPY_FLASHSIZE_{size} is not set" for size in sorted(SIZE_CODES, key=SIZE_CODES.get)
              if size != prof["flash_size"]]
    lines.append(f"CONFIG_ESPTOOLPY_FLASHMODE_{prof['config_flash_mode'].upper()}=y")
    return "\n".join(lines) + "\n"


def check_image_header(blob: bytes, prof: dict) -> list:
    """Problems in the first four bytes of an esp image (bootloader or app) versus the profile: magic 0xE9, flash mode
    (byte 2), flash size (byte 3, high nibble) and flash frequency (byte 3, low nibble)."""
    if len(blob) < 4:
        return ["image is shorter than its 4-byte image header"]
    if blob[0] != 0xE9:
        return [f"image header magic is {blob[0]:#04x}, expected 0xe9"]
    problems = []
    for what, codes, have, want in (("mode", MODE_CODES, blob[2], prof["flash_mode"]),
                                    ("size", SIZE_CODES, blob[3] >> 4, prof["flash_size"]),
                                    ("frequency", FREQ_CODES, blob[3] & 0xF, prof["flash_freq"])):
        shown = next((name for name, code in codes.items() if code == have), f"code {have:#x}")
        if shown != want:
            problems.append(f"image header flash {what} is {shown}, profile {prof['id']} needs {want}")
    return problems


def parse_size(text: str) -> int:
    t = text.strip().rstrip(",")
    m = re.fullmatch(r"(0x[0-9a-fA-F]+|\d+)([KkMm]?)", t)
    if not m:
        raise ValueError(f"bad size {text!r}")
    n = int(m.group(1), 0)
    return n * {"": 1, "k": 1024, "m": 1024 * 1024}[m.group(2).lower()]


def parse_partitions_csv(text: str) -> dict:
    """name -> {offset, size, type, subtype} from an ESP-IDF partitions.csv."""
    parts = {}
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        f = [x.strip() for x in line.split(",")]
        if len(f) < 5:
            raise ValueError(f"bad partition line {raw!r}")
        parts[f[0]] = {"type": f[1], "subtype": f[2], "offset": parse_size(f[3]), "size": parse_size(f[4])}
    return parts


def parse_flash_args(text: str) -> tuple[list, list]:
    """(option tokens, [(offset, relative path)]) from build/flash_args."""
    opts, images = [], []
    for line in text.splitlines():
        toks = line.split()
        if not toks:
            continue
        if toks[0].startswith("--"):
            opts += toks
        elif len(toks) == 2 and re.fullmatch(r"0x[0-9a-fA-F]+", toks[0]):
            images.append((int(toks[0], 16), toks[1]))
        else:
            raise ValueError(f"unexpected line in flash_args: {line!r}")
    return opts, images


def check_images(images: list, sizes: dict, parts: dict) -> list:
    """Return a list of problems (empty = ok). `sizes` maps image path -> byte size."""
    problems = []
    offsets = [o for o, _ in images]
    if sorted(offsets) != sorted(ALLOWED_WRITES):
        problems.append(f"flash_args writes offsets {[hex(o) for o in sorted(offsets)]}, "
                        f"expected exactly {[hex(o) for o in sorted(ALLOWED_WRITES)]}")
    if len(set(offsets)) != len(offsets):
        problems.append("duplicate flash offsets")
    for off, path in images:
        size = sizes.get(path)
        if size is None:
            problems.append(f"missing image {path}")
            continue
        end = off + size
        for name in PROTECTED:
            p = parts.get(name)
            if p is None:
                problems.append(f"partitions.csv has no {name} partition")
                continue
            if off < p["offset"] + p["size"] and end > p["offset"]:
                problems.append(f"{path} [{off:#x},{end:#x}) overlaps protected partition {name} "
                                f"[{p['offset']:#x},{p['offset'] + p['size']:#x})")
    by_off = dict(images)
    fac = parts.get("factory")
    if fac and APP_OFFSET in by_off and sizes.get(by_off[APP_OFFSET], 0) > fac["size"]:
        problems.append("app image is larger than the factory partition")
    for off, limit in MAX_IMAGE_SIZE.items():
        if off in by_off and sizes.get(by_off[off], 0) > limit:
            problems.append(f"{ALLOWED_WRITES[off].replace('-', ' ')} image is larger than {limit:#x} bytes")
    return problems


def parse_app_descriptor(blob: bytes) -> dict | None:
    """esp_app_desc_t fields from the first >= 256 bytes of an app image (or flash read at the app offset).
    Returns None when the descriptor magic is absent."""
    d = blob[APP_DESC_IMAGE_OFFSET:APP_DESC_IMAGE_OFFSET + 0xE0]
    if len(d) < 128 or int.from_bytes(d[0:4], "little") != APP_DESC_MAGIC:
        return None

    def cstr(start: int, length: int) -> str:
        return d[start:start + length].split(b"\x00", 1)[0].decode("ascii", "replace")

    return {"version": cstr(16, 32), "project_name": cstr(48, 32), "time": cstr(80, 16),
            "date": cstr(96, 16), "idf_ver": cstr(112, 32)}


def parse_device_table(blob: bytes, parts: dict) -> tuple[str, str]:
    """Judge the partition table read from the device. Returns (status, detail); status is
    'blank' | 'match' | 'mismatch' | 'garbage'. Only blank and match allow flashing."""
    if not blob:
        return "garbage", "no data read"
    if set(blob) == {0xFF}:
        return "blank", "flash is blank, nothing to preserve"
    entries = {}
    pos = 0
    saw_end = False
    while pos + 32 <= len(blob):
        e = blob[pos:pos + 32]
        pos += 32
        if e[:2] == b"\xaa\x50":
            typ, sub = e[2], e[3]
            off = int.from_bytes(e[4:8], "little")
            size = int.from_bytes(e[8:12], "little")
            label = e[12:28].split(b"\x00", 1)[0].decode("ascii", "replace")
            entries[label] = {"type": typ, "subtype": sub, "offset": off, "size": size}
        elif e[:2] == b"\xeb\xeb" or set(e) == {0xFF}:
            saw_end = True
            break
        else:
            return "garbage", f"unrecognised entry at table offset {pos - 32:#x}"
    if not entries or not saw_end:
        return "garbage", "partition table is not terminated or empty"
    for name in PROTECTED:
        want = parts.get(name)
        got = entries.get(name)
        if want is None:
            return "mismatch", f"partitions.csv has no {name}"
        if got is None:
            return "mismatch", f"device table has no {name} partition"
        if got["offset"] != want["offset"] or got["size"] != want["size"]:
            return "mismatch", (f"{name} on the device is [{got['offset']:#x}, size {got['size']:#x}] but this build "
                                f"expects [{want['offset']:#x}, size {want['size']:#x}]")
    p0 = entries[CREDENTIAL_PARTITION["name"]]
    if p0["type"] != CREDENTIAL_PARTITION["type"] or p0["subtype"] != CREDENTIAL_PARTITION["subtype"]:
        return "mismatch", "part0 on the device has an unexpected type/subtype"
    return "match", "device partition table matches this build"


def classify_port(vid: int, pid: int, name: str = "") -> str:
    if (vid, pid) == NATIVE_DOWNLOAD:
        return "native-download"
    if (vid, pid) in UART_BRIDGES:
        return "uart-bridge"
    return "ignore"


def select_port(ports: list, requested: str | None, running_present: bool) -> tuple[str | None, int, str]:
    """ports: dicts with com/vid/pid/name. Returns (port, exit code, message); code 0 means `port` is usable."""
    by_com = {p["com"].upper(): p for p in ports}
    if requested:
        p = by_com.get(requested.upper())
        if p is None:
            cands = ", ".join(f"{x['com']} ({x.get('name', '')})" for x in ports) or "none"
            return None, EXIT_DEVICE, f"{requested} is not present. Serial ports seen: {cands}"
        return p["com"], EXIT_OK, f"using {p['com']} as requested ({classify_port(p['vid'], p['pid'])})"
    native = [p for p in ports if classify_port(p["vid"], p["pid"]) == "native-download"]
    if len(native) == 1:
        return native[0]["com"], EXIT_OK, f"found the ESP32-S3 download port {native[0]['com']} (303A:1001)"
    if len(native) > 1:
        cands = ", ".join(p["com"] for p in native)
        return None, EXIT_DEVICE, f"several ESP32-S3 download ports ({cands}); pass -Port to choose one"
    if running_present:
        return None, EXIT_DEVICE, ("The key is running its firmware (303A:4002), not in download mode. Enter download "
                                   "mode: unplug USB, hold the BOOT button, plug USB in, release BOOT "
                                   "(BOOT+RST works too on boards with an RST button).")
    return None, EXIT_DEVICE, ("No ESP32-S3 download port (303A:1001) found. Use the board's native USB port, hold BOOT "
                               "while plugging in, or pass -Port for a UART bridge.")


def parse_sdkconfig(text: str) -> dict:
    cfg = {}
    for line in text.splitlines():
        m = re.match(r"^(CONFIG_[A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            v = m.group(2)
            cfg[m.group(1)] = v[1:-1] if v.startswith('"') and v.endswith('"') else v
    return cfg


def check_sdkconfig(cfg: dict) -> list:
    problems = []
    if cfg.get("CONFIG_IDF_TARGET") != "esp32s3":
        problems.append("target is not esp32s3")
    gpio = cfg.get("CONFIG_MULTIKEY_BUTTON_GPIO")
    if gpio is None or gpio == "-1":
        problems.append("CONFIG_MULTIKEY_BUTTON_GPIO is unset or -1 (not a usable key)")
    for key, why in (("CONFIG_MULTIKEY_ALLOW_UNSET_PINS_FOR_CI", "a CI-only image (--ci-pins) must never be flashed"),
                     ("CONFIG_MULTIKEY_ALLOW_EFUSE_PROVISIONING", "eFuse provisioning is enabled"),
                     ("CONFIG_SECURE_BOOT", "Secure Boot is enabled"),
                     ("CONFIG_SECURE_FLASH_ENC_ENABLED", "flash encryption is enabled")):
        if cfg.get(key) == "y":
            problems.append(f"{key}=y: {why}")
    return problems


def board_gpio(text: str) -> str | None:
    m = re.search(r"^CONFIG_MULTIKEY_BUTTON_GPIO=(-?\d+)", text, re.M)
    return m.group(1) if m else None


def build_flash_cmd(python: str, port: str, flash_args: str = "@flash_args") -> list:
    """The proven write command (docs/FIRST_RUN_WINDOWS.md). Built from an allowlist and checked."""
    argv = [python, "-m", "esptool", "--chip", "esp32s3", "-p", port, "-b", "460800", "--before", "default_reset",
            "--after", "watchdog_reset", "write_flash", flash_args]
    assert_safe_argv(argv)
    return argv


def assert_safe_argv(argv: list) -> None:
    for tok in argv:
        if tok in FORBIDDEN_TOKENS or tok.startswith("--erase"):
            raise Stop(EXIT_STORAGE, f"refusing to run a command containing {tok!r}")


def esptool_readonly(python: str, port: str, *sub: str) -> list:
    argv = [python, "-m", "esptool", "--chip", "esp32s3", "-p", port, "--before", "default_reset", "--after", "no_reset",
            *sub]
    assert_safe_argv(argv)
    return argv


def check_flash_id(output: str, hw: str = DEFAULT_PROFILE) -> tuple[list, str | None]:
    """Validate `esptool flash_id` output: an ESP32-S3 whose flash size is the profile's. Returns (problems, MAC)."""
    want = profile(hw)["flash_size"]
    problems = []
    if "ESP32-S3" not in output:
        problems.append("the chip is not an ESP32-S3")
    m = re.search(r"Detected flash size:\s*(\S+)", output)
    found = m.group(1) if m else "unknown"
    if found != want:
        problems.append(f"flash size is {found}, this build is for {want} (profile {hw}); "
                        f"supported profiles: {', '.join(supported_flash_sizes())}")
    mac = re.search(r"MAC:\s*([0-9a-fA-F:]{17})", output)
    return problems, (mac.group(1).lower() if mac else None)


def judge_usb_identity(report: dict, expected_product: str | None) -> tuple[list, list]:
    """(failures, notes) from tools/usb_identity.py --json output."""
    fails, notes = [], []
    itfs = report.get("interfaces", {})
    classes = [i.get("class") for i in itfs.values()]
    if classes.count("HIDClass") < 2:
        fails.append(f"expected 2 HID interfaces (FIDO + keyboard), found {classes.count('HIDClass')}")
    if "SmartCardReader" not in classes:
        fails.append("no CCID smart-card reader interface")
    if "USBDevice" not in classes:
        fails.append("no WinUSB interface (the WebCCID interface did not bind WinUSB)")
    prod = report.get("product_string")
    if not prod:
        fails.append("no product string")
    elif expected_product and prod != expected_product:
        notes.append(f"product string is {prod!r}, build default is {expected_product!r} "
                     "(a custom name stored with `multikey device rename` takes precedence)")
    return fails, notes


# --------------------------------------------------------------------------- orchestration

def step(n: int, total: int, name: str) -> None:
    print(f"[{n}/{total}] {name} ...", flush=True)


def run(argv: list, **kw) -> subprocess.CompletedProcess:
    assert_safe_argv([str(a) for a in argv])
    return subprocess.run(argv, **kw)


def pnp_ports() -> list:
    """Present serial ports with their USB ids (Windows)."""
    ps = (r"Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match '^USB\\VID_' -and "
          r"$_.Name -match '\(COM\d+\)' } | ForEach-Object { $m = [regex]::Match($_.PNPDeviceID,"
          r"'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})'); $c = [regex]::Match($_.Name,'\((COM\d+)\)').Groups[1].Value; "
          r"[pscustomobject]@{ com=$c; vid=$m.Groups[1].Value; pid=$m.Groups[2].Value; name=$_.Name } } | "
          r"ConvertTo-Json -Compress")
    r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                       capture_output=True, text=True)
    text = r.stdout.strip()
    if r.returncode != 0 or not text:
        return []
    data = json.loads(text)
    data = data if isinstance(data, list) else [data]
    return [{"com": d["com"], "vid": int(d["vid"], 16), "pid": int(d["pid"], 16), "name": d["name"]} for d in data]


def running_firmware_present(vid: int = NATIVE_APP[0], pid: int = NATIVE_APP[1]) -> bool:
    ps = f"Get-PnpDevice -PresentOnly | Where-Object {{ $_.InstanceId -like 'USB\\VID_{vid:04X}&PID_{pid:04X}*' }} | Measure-Object | Select-Object -ExpandProperty Count"
    r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                       capture_output=True, text=True)
    return r.stdout.strip().isdigit() and int(r.stdout.strip()) > 0


def stop_on(problems: list, code: int, what: str) -> None:
    if problems:
        raise Stop(code, what + ": " + "; ".join(problems))


def run_flash(args: argparse.Namespace) -> int:
    total = 9
    app = args.app
    tag = f"{app}-dev"
    build_dir = ROOT / f"build-{tag}"
    py = sys.executable

    step(1, total, "prerequisites")
    if sys.version_info < (3, 9):
        raise Stop(EXIT_PREREQ, f"Python 3.9 or newer is required (this is {sys.version.split()[0]})")
    if shutil.which("git") is None:
        raise Stop(EXIT_PREREQ, "git was not found on PATH")
    idf_path = os.environ.get("IDF_PATH")
    if not idf_path or not (Path(idf_path) / "tools" / "idf.py").is_file():
        raise Stop(EXIT_PREREQ, IDF_MISSING)
    r = run([py, str(Path(idf_path) / "tools" / "idf.py"), "--version"], capture_output=True, text=True)
    if r.returncode != 0 or not re.search(r"v?5\.5", r.stdout + r.stderr):
        raise Stop(EXIT_PREREQ, IDF_MISSING + " (found: " + (r.stdout + r.stderr).strip()[:80] + ")")
    if app == "openpgp" and not args.ack_openpgp:
        raise Stop(EXIT_PREREQ, "-App openpgp needs -AcknowledgeOpenPgpImage: the OpenPGP image shares the credential "
                                "file system with different applets; data from the FIDO image is not usable.")

    step(2, total, "board configuration")
    board = ROOT / "sdkconfig.board"
    sample = ROOT / "boards" / "esp32s3-boot-button.board"
    if not board.exists():
        shutil.copyfile(sample, board)
        print("  created sdkconfig.board from boards/esp32s3-boot-button.board (BOOT button = GPIO0, active low)")
    gpio = board_gpio(board.read_text())
    if gpio is None:
        raise Stop(EXIT_PREREQ, "sdkconfig.board does not define CONFIG_MULTIKEY_BUTTON_GPIO")
    if gpio != "0":
        print(f"  WARNING: sdkconfig.board uses GPIO {gpio}, not the standard BOOT button GPIO 0; make sure that is intended.")

    step(3, total, "sources (submodules and patches)")
    r = run(["git", "submodule", "status"], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        raise Stop(EXIT_PREREQ, "git submodule status failed (is this a git checkout?)")
    for line in r.stdout.splitlines():
        if line.startswith("+"):
            raise Stop(EXIT_PREREQ, f"submodule is at a different commit than this checkout records: {line.strip()} "
                                    "(refusing to touch it; patches may be applied on top, run `git submodule status` to inspect)")
    if any(line.startswith("-") for line in r.stdout.splitlines()):
        if run(["git", "submodule", "update", "--init", "pico-keys-sdk", "pico-fido"], cwd=ROOT).returncode != 0:
            raise Stop(EXIT_PREREQ, "git submodule update failed")
    if run([py, str(ROOT / "tools" / "apply_patches.py")], cwd=ROOT).returncode != 0:
        raise Stop(EXIT_PREREQ, "applying the MultiKeys patches failed")

    step(4, total, "device detection")
    deadline = time.time() + args.wait
    while True:
        ports = pnp_ports()
        port, code, message = select_port(ports, args.port, running_firmware_present())
        if port or args.port or time.time() >= deadline or code == EXIT_DEVICE and "several" in message:
            break
        print(f"  waiting for download mode ({int(deadline - time.time())} s left)... {message.splitlines()[0][:70]}", flush=True)
        time.sleep(2)
    if not port:
        raise Stop(EXIT_DEVICE, message)
    print("  " + message)

    step(5, total, "build (development image, real pins)")
    if not args.no_build:
        if run([py, str(ROOT / "tools" / "build.py"), "dev", "--app", app], cwd=ROOT).returncode != 0:
            raise Stop(EXIT_FAIL, "build failed")
    cfg_path = ROOT / f"sdkconfig.{tag}.generated"
    if not cfg_path.is_file() or not (build_dir / "flash_args").is_file():
        raise Stop(EXIT_PREREQ, f"no build found for {tag}; run without -NoBuild")
    stop_on(check_sdkconfig(parse_sdkconfig(cfg_path.read_text())), EXIT_STORAGE, "unsafe configuration")
    if run([py, str(ROOT / "tools" / "check_no_irreversible.py"), tag], cwd=ROOT).returncode != 0:
        raise Stop(EXIT_STORAGE, "check_no_irreversible.py failed")
    parts = parse_partitions_csv((ROOT / "partitions.csv").read_text())
    opts, images = parse_flash_args((build_dir / "flash_args").read_text())
    sizes = {p: (build_dir / p).stat().st_size for _, p in images if (build_dir / p).is_file()}
    stop_on(check_images(images, sizes, parts), EXIT_STORAGE, "image layout")
    app_image = next(p for o, p in images if o == APP_OFFSET)
    sha = hashlib.sha256((build_dir / app_image).read_bytes()).hexdigest()
    if app == "openpgp":
        print("  The OpenPGP image uses the same part0 file system with different applets. Credentials, PINs and keys\n"
              "  from the FIDO image are not usable and may be lost or mis-read. Back up first; this script does not.")

    step(6, total, "board identity and credential-store protection (read-only)")
    r = run(esptool_readonly(py, port, "flash_id"), cwd=ROOT, capture_output=True, text=True)
    out = r.stdout + r.stderr
    if r.returncode != 0:
        raise Stop(EXIT_DEVICE, "could not talk to the chip (is it in download mode?):\n" + out[-600:])
    problems, mac = check_flash_id(out)
    stop_on(problems, EXIT_STORAGE, "this is not the supported board")
    print(f"  chip ESP32-S3, 16MB flash, MAC {mac}")
    tmp = ROOT / "build-flash-dev-ptable.bin"
    try:
        r = run(esptool_readonly(py, port, "read_flash", hex(PARTITION_TABLE_OFFSET), hex(PARTITION_TABLE_LEN), str(tmp)),
                cwd=ROOT,
                capture_output=True, text=True)
        if r.returncode != 0 or not tmp.is_file():
            raise Stop(EXIT_STORAGE, "could not read the device partition table; credential preservation cannot be "
                                     "established; no flash performed")
        status, detail = parse_device_table(tmp.read_bytes(), parts)
    finally:
        tmp.unlink(missing_ok=True)
    if status not in ("blank", "match"):
        raise Stop(EXIT_STORAGE, f"{detail}. Credential preservation cannot be established; no flash performed")
    print("  " + detail)

    step(7, total, "confirmation")
    cmd = build_flash_cmd(py, port)
    print()
    print(f"  board       : ESP32-S3 16MB, MAC {mac}, port {port}")
    print(f"  app image   : build-{tag}/{app_image} ({sizes[app_image]} bytes, sha256 {sha})")
    print("  will write  : 0x0 bootloader.bin | 0x8000 partition-table.bin | 0x20000 " + Path(app_image).name)
    print("  will NOT touch: part0 (credentials, PINs, keys) 0x200000-0x2FFFFF, nvs, phy_init, eFuses;")
    print("                  no erase-flash, no authenticatorReset, no PIN change")
    print("  command     : " + " ".join(cmd))
    print()
    if args.dry_run:
        print("DRY RUN: nothing written")
        return EXIT_OK
    try:
        answer = input("Type FLASH to write the firmware: ")
    except EOFError:
        answer = ""
    if answer.strip() != "FLASH":
        raise Stop(EXIT_DECLINED, "not confirmed; nothing written")

    step(8, total, "flash")
    r = run(cmd, cwd=build_dir)
    if r.returncode != 0:
        raise Stop(EXIT_FAIL, f"esptool failed with exit code {r.returncode}")
    print("  The COM port disappearing is normal: the native USB port is taken over by the firmware.\n"
          "  If the key does not appear within 15 s, unplug and replug it.")

    step(9, total, "verify enumeration")
    if sys.platform != "win32":
        print("  (verification uses Windows PnP; skipped on this OS)")
        return EXIT_OK
    deadline = time.time() + 20
    while not running_firmware_present():
        if time.time() > deadline:
            raise Stop(EXIT_VERIFY, "FAIL: the key did not enumerate as 303A:4002 within 20 s")
        time.sleep(1)
    time.sleep(2)  # let the child interfaces register
    r = run([py, str(ROOT / "tools" / "usb_identity.py"), "--json"], cwd=ROOT, capture_output=True, text=True)
    try:
        report = json.loads(r.stdout)
    except ValueError:
        raise Stop(EXIT_VERIFY, "FAIL: tools/usb_identity.py produced no report: " + (r.stderr or r.stdout)[-300:])
    product = parse_sdkconfig(cfg_path.read_text()).get("CONFIG_MULTIKEY_USB_PRODUCT_NAME")
    fails, notes = judge_usb_identity(report, product)
    for n in notes:
        print("  note: " + n)
    if fails:
        raise Stop(EXIT_VERIFY, "FAIL: " + "; ".join(fails))
    print("PASS: MultiKeys enumerates (FIDO HID + CCID + WinUSB).")
    print("Next (read-only): multikey device list | multikey device info | multikey fido info (elevated terminal on Windows)")
    return EXIT_OK


def cmd_board_check(args: argparse.Namespace) -> int:
    text = Path(args.file).read_text()
    gpio = board_gpio(text)
    if gpio is None:
        print("sdkconfig.board does not define CONFIG_MULTIKEY_BUTTON_GPIO", file=sys.stderr)
        return EXIT_PREREQ
    if gpio != "0":
        print(f"WARNING: button GPIO is {gpio}, not the standard BOOT button GPIO 0")
    print(f"button GPIO {gpio}")
    return EXIT_OK


def cmd_ports(args: argparse.Namespace) -> int:
    data = json.loads(Path(args.json_file).read_text()) if args.json_file else pnp_ports()
    for p in data:
        print(f"{p['com']}\t{p['vid']:04X}:{p['pid']:04X}\t{classify_port(p['vid'], p['pid'])}\t{p.get('name', '')}")
    return EXIT_OK


def cmd_flash_cmd(args: argparse.Namespace) -> int:
    print(" ".join(build_flash_cmd(sys.executable, args.port)))
    return EXIT_OK


def cmd_device_table(args: argparse.Namespace) -> int:
    parts = parse_partitions_csv((ROOT / "partitions.csv").read_text())
    status, detail = parse_device_table(Path(args.file).read_bytes(), parts)
    print(f"{status}: {detail}")
    return EXIT_OK if status in ("blank", "match") else EXIT_STORAGE


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("flash", help="the full flow (used by flash-dev.ps1)")
    f.add_argument("--app", choices=["fido", "openpgp"], default="fido")
    f.add_argument("--port")
    f.add_argument("--dry-run", action="store_true")
    f.add_argument("--no-build", action="store_true")
    f.add_argument("--wait", type=int, default=60)
    f.add_argument("--ack-openpgp", action="store_true")
    b = sub.add_parser("board-check")
    b.add_argument("file", nargs="?", default=str(ROOT / "sdkconfig.board"))
    p = sub.add_parser("ports", help="list serial ports with their classification")
    p.add_argument("--json-file")
    c = sub.add_parser("flash-cmd", help="print the write command for PORT")
    c.add_argument("port")
    d = sub.add_parser("device-table", help="judge a partition table dump (read_flash 0x8000 0xC00)")
    d.add_argument("file")
    args = ap.parse_args()
    try:
        if args.cmd == "flash":
            return run_flash(args)
        return {"board-check": cmd_board_check, "ports": cmd_ports, "flash-cmd": cmd_flash_cmd,
                "device-table": cmd_device_table}[args.cmd](args)
    except Stop as e:
        print(f"STOP: {e.message}", file=sys.stderr)
        return e.code
    except KeyboardInterrupt:
        print("interrupted; nothing further was run", file=sys.stderr)
        return EXIT_DECLINED


if __name__ == "__main__":
    sys.exit(main())
