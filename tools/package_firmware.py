#!/usr/bin/env python3
"""Package, describe and verify prebuilt MultiKeys firmware (stdlib only).

  python tools/package_firmware.py package --build-dir build-fido-dev --sdkconfig sdkconfig.fido-dev.generated \
      --app fido --board esp32s3-n16r8-boot-button --version 0.2.0 --commit <sha> --out dist-fw --source-date-epoch N
  python tools/package_firmware.py manifest --entries 'dist-fw/*.entry.json' --version 0.2.0 --tag v0.2.0 \
      --commit <sha> --out dist-fw/firmware-manifest.json
  python tools/package_firmware.py verify dist-fw/multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev.zip \
      --manifest dist-fw/firmware-manifest.json

`package` refuses anything that is not a flashable development image for the supported board: wrong chip or flash
size, unset pins, CI-only images, Secure Boot / flash encryption / eFuse provisioning, an image that touches nvs,
phy_init or part0, a partition table that differs from partitions.csv, an app whose descriptor names another project
or version, or a WebUSB landing URL other than the web installer. The zip is deterministic (sorted entries, fixed
timestamps). The manifest (firmware-manifest.json) is what the web installer reads; its format is documented in
docs/RELEASES.md and validated again in web/src/lib/firmware/manifest.ts.
"""
from __future__ import annotations

import argparse
import copy
import glob
import hashlib
import json
import re
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import flash_dev as fd  # noqa: E402
from check_usb_descriptors import DescriptorError, validate_url  # noqa: E402
from package_release import FORBIDDEN  # noqa: E402

REPOSITORY = "mewisme/esp32-security-key"
LANDING_URL = "https://multikeys.mewis.me"
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$")
ASSET_RE = re.compile(r"^multikey-firmware-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-esp32s3-n16r8-(fido|openpgp)-dev\.zip$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
DATA_PRESERVING_FROM = "0.2.0"
INSTALL_MODES = ["first-install", "update", "update-unverified", "switch-image", "replace-compatible-layout",
                 "repurpose"]
TITLES = {"fido": "MultiKeys FIDO2 — Development Firmware", "openpgp": "MultiKeys OpenPGP — Development Firmware"}
IMAGE_FILES = {"bootloader": "bootloader.bin", "partition-table": "partition-table.bin"}
TEMPLATES = ROOT / "packaging" / "firmware"


class PackageError(Exception):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cargo_version(text: str) -> str:
    """[workspace.package] version from host/Cargo.toml (the same value CMakeLists.txt stamps into the app)."""
    m = re.search(r"^\[workspace\.package\]\s*$(.*?)^\[", text + "\n[", re.M | re.S)
    v = m and re.search(r'^version\s*=\s*"([^"]+)"', m.group(1), re.M)
    if not v:
        raise PackageError("no [workspace.package] version in host/Cargo.toml")
    return v.group(1)


def package_name(version: str, app: str) -> str:
    return f"multikey-firmware-v{version}-esp32s3-n16r8-{app}-dev.zip"


def image_file(role: str, app: str) -> str:
    return IMAGE_FILES.get(role, f"multikey-{app}.bin")


def layout_id(parts: dict) -> str:
    """Identifies the layout of everything the installer preserves: same id = same nvs/phy_init/part0 placement."""
    text = "".join(f"{n},{parts[n]['offset']},{parts[n]['size']}\n" for n in fd.PROTECTED)
    return "mk16-" + sha256(text.encode())[:12]


def member_names(app: str) -> list:
    return sorted(["bootloader.bin", "partition-table.bin", f"multikey-{app}.bin", "firmware.json", "SHA256SUMS",
                   "LICENSE", "NOTICE.txt", "README.txt"])


def zip_dt(epoch: int) -> tuple:
    return time.gmtime(max(epoch, 315532800))[:6]  # ZIP cannot represent dates before 1980


def write_zip(dest: Path, root: str, data: dict, epoch: int) -> None:
    dt = zip_dt(epoch)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for member in sorted(data):
            zi = zipfile.ZipInfo(f"{root}/{member}", date_time=dt)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = (0o100000 | 0o644) << 16
            zi.create_system = 3
            z.writestr(zi, data[member], compresslevel=9)


def dumps(obj) -> str:
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def check_config(cfg: dict, board_cfg: dict) -> None:
    problems = []
    if cfg.get("CONFIG_MULTIKEY_ALLOW_UNSET_PINS_FOR_CI") == "y":
        problems.append("CI-only image (--ci-pins) cannot be packaged")
    problems += fd.check_sdkconfig(cfg)
    want_gpio = board_cfg.get("CONFIG_MULTIKEY_BUTTON_GPIO")
    if want_gpio is None:
        problems.append("board file has no CONFIG_MULTIKEY_BUTTON_GPIO")
    elif cfg.get("CONFIG_MULTIKEY_BUTTON_GPIO") != want_gpio:
        problems.append(f"CONFIG_MULTIKEY_BUTTON_GPIO={cfg.get('CONFIG_MULTIKEY_BUTTON_GPIO')} but the board file "
                        f"says {want_gpio}")
    for key in ("CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW", "CONFIG_MULTIKEY_LED_TYPE_NONE", "CONFIG_ESPTOOLPY_FLASHSIZE_16MB",
                "CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED"):
        if cfg.get(key) != "y":
            problems.append(f"{key} must be y")
    if cfg.get("CONFIG_PARTITION_TABLE_CUSTOM_FILENAME") != "partitions.csv":
        problems.append("CONFIG_PARTITION_TABLE_CUSTOM_FILENAME must be partitions.csv")
    url = cfg.get("CONFIG_MULTIKEY_WEBUSB_LANDING_URL")
    if url != LANDING_URL:
        problems.append(f"CONFIG_MULTIKEY_WEBUSB_LANDING_URL is {url!r}, expected {LANDING_URL!r}")
    else:
        try:
            validate_url(url)
        except DescriptorError as e:
            problems.append(f"landing URL invalid: {e}")
    for key in ("CONFIG_MULTIKEY_USB_VID", "CONFIG_MULTIKEY_USB_PID"):
        try:
            int(cfg.get(key, ""), 0)
        except ValueError:
            problems.append(f"{key} is missing or not a number")
    if problems:
        raise PackageError("; ".join(problems))


def package(build_dir: Path, sdkconfig: Path, app: str, board: str, version: str, commit: str, out: Path,
            epoch: int, partitions: Path = ROOT / "partitions.csv", license_file: Path = ROOT / "LICENSE",
            boards_dir: Path = ROOT / "boards", templates: Path = TEMPLATES) -> tuple[Path, dict]:
    if not VERSION_RE.match(version):
        raise PackageError(f"bad version {version!r}")
    if not COMMIT_RE.match(commit):
        raise PackageError(f"bad commit {commit!r} (40 lowercase hex characters)")
    if app not in TITLES:
        raise PackageError(f"unknown app {app!r}")
    try:
        fa = json.loads((build_dir / "flasher_args.json").read_text(encoding="utf-8"))
        chip = fa["extra_esptool_args"]["chip"]
        settings = fa["flash_settings"]
        files = {int(k, 16): v for k, v in fa["flash_files"].items()}
    except (OSError, ValueError, KeyError) as e:
        raise PackageError(f"cannot read {build_dir / 'flasher_args.json'}: {e}") from e
    if chip != "esp32s3":
        raise PackageError(f"build target is {chip!r}, not esp32s3")
    if settings.get("flash_size") != fd.POLICY["flash_size"]:
        raise PackageError(f"flash size is {settings.get('flash_size')!r}, not {fd.POLICY['flash_size']}")

    cfg = fd.parse_sdkconfig(sdkconfig.read_text(encoding="utf-8"))
    board_file = boards_dir / f"{board}.board"
    if not board_file.is_file():
        raise PackageError(f"unknown board {board!r} ({board_file} missing)")
    check_config(cfg, fd.parse_sdkconfig(board_file.read_text(encoding="utf-8")))

    parts = fd.parse_partitions_csv(partitions.read_text(encoding="utf-8"))
    images = sorted(files.items())
    blobs = {}
    for _, rel in images:
        p = build_dir / rel
        if p.is_file():
            blobs[rel] = p.read_bytes()
    problems = fd.check_images(images, {rel: len(b) for rel, b in blobs.items()}, parts)
    if problems:
        raise PackageError("image layout: " + "; ".join(problems))
    by_role = {fd.ALLOWED_WRITES[off]: (off, blobs[rel]) for off, rel in images}
    status, detail = fd.parse_device_table(by_role["partition-table"][1], parts)
    if status != "match":
        raise PackageError(f"built partition table does not match partitions.csv: {detail}")
    desc = fd.parse_app_descriptor(by_role["app"][1][:256])
    if desc is None:
        raise PackageError("app image has no app descriptor")
    if desc["project_name"] != f"multikey-{app}":
        raise PackageError(f"app project is {desc['project_name']!r}, expected 'multikey-{app}'")
    if desc["version"] != version:
        raise PackageError(f"app version is {desc['version']!r}, expected {version!r} (build with --release?)")

    entry = {
        "id": f"esp32s3-n16r8-{app}-dev", "image": app, "project_name": f"multikey-{app}", "version": version,
        "title": TITLES[app], "board": board, "chip": fd.POLICY["chip"], "flash_size": fd.POLICY["flash_size"],
        "flash_mode": settings.get("flash_mode"), "flash_freq": settings.get("flash_freq"),
        "security_profile": "development",
        "idf_version": desc["idf_ver"] or cfg.get("CONFIG_IDF_INIT_VERSION", ""),
        "user_presence": {"gpio": int(cfg["CONFIG_MULTIKEY_BUTTON_GPIO"]), "active_low": True}, "led": "none",
        "usb": {"vid": int(cfg["CONFIG_MULTIKEY_USB_VID"], 0), "pid": int(cfg["CONFIG_MULTIKEY_USB_PID"], 0),
                "webusb_landing_url": cfg["CONFIG_MULTIKEY_WEBUSB_LANDING_URL"]},
        "images": [{"role": fd.ALLOWED_WRITES[off], "file": image_file(fd.ALLOWED_WRITES[off], app), "offset": off,
                    "size": len(blobs[rel]), "sha256": sha256(blobs[rel])} for off, rel in images],
        "partitions": [{"name": n, "type": p["type"], "subtype": p["subtype"], "offset": p["offset"],
                        "size": p["size"]} for n, p in parts.items()],
        "layout_id": layout_id(parts),
        "protected_partitions": list(fd.PROTECTED), "repurpose_fill": list(fd.POLICY["repurpose_fill"]),
        "update": {"data_preserving_from": DATA_PRESERVING_FROM}, "install_modes": INSTALL_MODES,
        "verification": "build-verified",
    }
    name = package_name(version, app)
    root = name.removesuffix(".zip")
    command = "python -m esptool --chip esp32s3 -p PORT write_flash " + " ".join(
        f"{i['offset']:#x} {i['file']}" for i in entry["images"])
    data = {i["file"]: by_role[i["role"]][1] for i in entry["images"]}
    data["SHA256SUMS"] = "".join(f"{i['sha256']}  {i['file']}\n" for i in sorted(entry["images"],
                                                                                 key=lambda x: x["file"])).encode()
    data["firmware.json"] = dumps(entry).encode()
    data["LICENSE"] = license_file.read_bytes()
    data["NOTICE.txt"] = (templates / "NOTICE.txt").read_text(encoding="utf-8").replace("{version}", version).encode()
    data["README.txt"] = (templates / "README.txt").read_text(encoding="utf-8").format(
        title=TITLES[app].removeprefix("MultiKeys "), version=version, command=command, app_file=f"multikey-{app}.bin",
        vid=f"{entry['usb']['vid']:04X}", pid=f"{entry['usb']['pid']:04X}").encode()
    if sorted(data) != member_names(app):
        raise PackageError(f"internal: member set {sorted(data)}")
    for member in data:
        if not member.endswith(".bin") and FORBIDDEN.search(member):
            raise PackageError(f"forbidden file name {member}")
    out.mkdir(parents=True, exist_ok=True)
    dest = out / name
    write_zip(dest, root, data, epoch)
    blob = dest.read_bytes()
    full = dict(entry, package={"name": name, "size": len(blob), "sha256": sha256(blob)})
    (out / f"{name}.entry.json").write_text(dumps(full), encoding="utf-8")
    return dest, full


def manifest(entry_paths: list, version: str, tag: str, commit: str) -> dict:
    if not VERSION_RE.match(version):
        raise PackageError(f"bad version {version!r}")
    if tag != f"v{version}" and tag != "local":
        raise PackageError(f"tag {tag!r} does not match version {version!r}")
    if not COMMIT_RE.match(commit):
        raise PackageError(f"bad commit {commit!r}")
    if not entry_paths:
        raise PackageError("no build entries")
    builds = [json.loads(Path(p).read_text(encoding="utf-8")) for p in entry_paths]
    ids = [b["id"] for b in builds]
    if len(set(ids)) != len(ids):
        raise PackageError(f"duplicate build ids {ids}")
    for b in builds:
        if b["version"] != version:
            raise PackageError(f"build {b['id']} has version {b['version']!r}, manifest is {version!r}")
    return {"schema": "multikeys-firmware-manifest", "schema_version": 1, "version": version, "tag": tag,
            "source_commit": commit, "repository": REPOSITORY, "builds": sorted(builds, key=lambda b: b["id"])}


def verify(zip_path: Path, man: dict) -> list:
    blob = zip_path.read_bytes()
    build = next((b for b in man.get("builds", []) if b["package"]["name"] == zip_path.name), None)
    if build is None:
        raise PackageError(f"{zip_path.name} is not listed in the manifest")
    if len(blob) != build["package"]["size"] or sha256(blob) != build["package"]["sha256"]:
        raise PackageError(f"{zip_path.name}: size or SHA-256 differs from the manifest")
    root = zip_path.name.removesuffix(".zip")
    with zipfile.ZipFile(zip_path) as z:
        names = sorted(z.namelist())
        want = [f"{root}/{m}" for m in member_names(build["image"])]
        if names != want:
            raise PackageError(f"unexpected members: extra {sorted(set(names) - set(want))}, "
                               f"missing {sorted(set(want) - set(names))}")
        read = {n.split("/", 1)[1]: z.read(n) for n in names}
    for img in build["images"]:
        data = read[img["file"]]
        if len(data) != img["size"] or sha256(data) != img["sha256"]:
            raise PackageError(f"{img['file']}: size or SHA-256 differs from the manifest")
    entry = copy.deepcopy(build)
    del entry["package"]
    if json.loads(read["firmware.json"]) != entry:
        raise PackageError("firmware.json differs from the manifest entry")
    app = next(i for i in build["images"] if i["role"] == "app")
    desc = fd.parse_app_descriptor(read[app["file"]][:256])
    if desc is None or desc["version"] != man["version"] or desc["project_name"] != build["project_name"]:
        raise PackageError(f"app descriptor {desc} does not match manifest version {man['version']!r}")
    return names


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("package", help="validate one build and write its zip + entry json")
    p.add_argument("--build-dir", required=True, type=Path)
    p.add_argument("--sdkconfig", required=True, type=Path)
    p.add_argument("--app", choices=sorted(TITLES), required=True)
    p.add_argument("--board", required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--source-date-epoch", type=int, required=True)
    m = sub.add_parser("manifest", help="combine entry json files into firmware-manifest.json")
    m.add_argument("--entries", required=True, help="glob of *.entry.json")
    m.add_argument("--version", required=True)
    m.add_argument("--tag", required=True)
    m.add_argument("--commit", required=True)
    m.add_argument("--out", required=True, type=Path)
    v = sub.add_parser("verify", help="re-check a firmware zip against the manifest")
    v.add_argument("zip", nargs="+", type=Path)
    v.add_argument("--manifest", required=True, type=Path)
    sub.add_parser("version", help="print the [workspace.package] version from host/Cargo.toml")
    a = ap.parse_args()
    try:
        if a.cmd == "version":
            print(cargo_version((ROOT / "host" / "Cargo.toml").read_text(encoding="utf-8")))
        elif a.cmd == "package":
            dest, entry = package(a.build_dir, a.sdkconfig, a.app, a.board, a.version, a.commit, a.out,
                                  a.source_date_epoch)
            print(f"{dest}  sha256={entry['package']['sha256']}")
        elif a.cmd == "manifest":
            man = manifest(sorted(glob.glob(a.entries)), a.version, a.tag, a.commit)
            a.out.write_text(dumps(man), encoding="utf-8")
            print(f"{a.out}: {len(man['builds'])} build(s)")
        else:
            man = json.loads(a.manifest.read_text(encoding="utf-8"))
            for z in a.zip:
                verify(z, man)
                print(f"{z}: OK")
    except PackageError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
