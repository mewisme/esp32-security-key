#!/usr/bin/env python3
"""READ-ONLY eFuse state reporter for ESP32-S3 (provisioning check).

Runs `espefuse --chip esp32s3 -p PORT summary --format json` (or reads a saved JSON summary) and
classifies the chip. It never writes eFuses: the only espefuse sub-command used is `summary`.

Classification is a heuristic over documented eFuse names (esptool 5.x esp32s3 definitions):
  hardened            SECURE_BOOT_EN set, flash encryption on, JTAG disabled, download mode restricted
  partially hardened  at least one of the above is set, but not all
  development (open)  none set
Fields absent from the summary are reported as `unknown field`; they never count as set.
This is NOT a security audit and does not verify keys, key purposes or write-protection bits.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FIELDS = [
    "SECURE_BOOT_EN",
    "SPI_BOOT_CRYPT_CNT",
    "DIS_USB_JTAG",
    "DIS_PAD_JTAG",
    "SOFT_DIS_JTAG",
    "DIS_USB_SERIAL_JTAG",
    "DIS_DOWNLOAD_MODE",
    "ENABLE_SECURITY_DOWNLOAD",
    "DIS_DIRECT_BOOT",
    "DIS_USB_SERIAL_JTAG_DOWNLOAD_MODE",
    "DIS_USB_OTG_DOWNLOAD_MODE",
    "DIS_FORCE_DOWNLOAD",
    "DIS_DOWNLOAD_MANUAL_ENCRYPT",
]

SAMPLE_OPEN = {
    "SECURE_BOOT_EN": (False, "0x0"),
    "SPI_BOOT_CRYPT_CNT": ("Disable", "0x0"),
    "DIS_USB_JTAG": (False, "0x0"),
    "DIS_PAD_JTAG": (False, "0x0"),
    "SOFT_DIS_JTAG": (0, "0x0"),
    "DIS_DOWNLOAD_MODE": (False, "0x0"),
    "ENABLE_SECURITY_DOWNLOAD": (False, "0x0"),
    "DIS_DIRECT_BOOT": (False, "0x0"),
}


def _sample(**over):
    d = dict(SAMPLE_OPEN)
    d.update(over)
    return {k: {"name": k, "value": v[0], "raw_value": v[1]} for k, v in d.items()}


SAMPLES = {
    "open": (_sample(), "development (open)"),
    "partial": (
        _sample(SPI_BOOT_CRYPT_CNT=("Enable", "0x1"), DIS_PAD_JTAG=(True, "0x1")),
        "partially hardened",
    ),
    "hardened": (
        _sample(
            SECURE_BOOT_EN=(True, "0x1"),
            SPI_BOOT_CRYPT_CNT=("Enable", "0x7"),
            DIS_PAD_JTAG=(True, "0x1"),
            DIS_USB_JTAG=(True, "0x1"),
            DIS_DOWNLOAD_MODE=(True, "0x1"),
        ),
        "hardened",
    ),
}


def _as_bool(entry):
    """Return True/False/None (None = unknown field)."""
    if entry is None:
        return None
    v = entry.get("value")
    if isinstance(v, bool):
        return v
    raw = entry.get("raw_value")
    if isinstance(raw, str):
        try:
            return int(raw, 16) != 0
        except ValueError:
            pass
    if isinstance(v, int):
        return v != 0
    return None


def _crypt_enabled(entry):
    """SPI_BOOT_CRYPT_CNT: flash encryption is on when an odd number of bits is set."""
    if entry is None:
        return None
    raw = entry.get("raw_value")
    if isinstance(raw, str):
        try:
            return bin(int(raw, 16)).count("1") % 2 == 1
        except ValueError:
            pass
    v = entry.get("value")
    if isinstance(v, str):
        return v.strip().lower().startswith("enable")
    if isinstance(v, int):
        return bin(v).count("1") % 2 == 1
    return None


def analyse(summary):
    """summary: dict name -> {value, raw_value, ...}. Returns (classification, report lines)."""
    lines = []
    for name in FIELDS:
        e = summary.get(name)
        if e is None:
            lines.append(f"  {name:<36} unknown field")
        else:
            lines.append(f"  {name:<36} value={e.get('value')!r} raw={e.get('raw_value')}")

    def b(n):
        return _as_bool(summary.get(n))

    sb = b("SECURE_BOOT_EN")
    fe = _crypt_enabled(summary.get("SPI_BOOT_CRYPT_CNT"))
    jtag_pad = b("DIS_PAD_JTAG")
    jtag_usb = b("DIS_USB_JTAG") or b("DIS_USB_SERIAL_JTAG")
    soft = summary.get("SOFT_DIS_JTAG")
    jtag_off = bool(jtag_pad) and bool(jtag_usb)
    dl = bool(b("DIS_DOWNLOAD_MODE")) or bool(b("ENABLE_SECURITY_DOWNLOAD"))
    used = {
        "SECURE_BOOT_EN": sb,
        "flash_encryption(SPI_BOOT_CRYPT_CNT odd bits)": fe,
        "jtag_disabled(DIS_PAD_JTAG and (DIS_USB_JTAG or DIS_USB_SERIAL_JTAG))": jtag_off,
        "download_restricted(DIS_DOWNLOAD_MODE or ENABLE_SECURITY_DOWNLOAD)": dl,
    }
    if soft is not None:
        lines.append("  note: SOFT_DIS_JTAG is reported but not used for classification (software-reversible).")
    flags = [bool(v) for v in used.values()]
    if all(flags):
        cls = "hardened"
    elif any(flags):
        cls = "partially hardened"
    else:
        cls = "development (open)"
    lines.append("  fields used for classification:")
    for k, v in used.items():
        lines.append(f"    {k} = {'unknown field' if v is None else v}")
    lines.append(f"  classification: {cls}")
    lines.append("  caveat: heuristic only; key purposes, write-protect bits and boot-loader/app signing are NOT checked.")
    return cls, lines


def fetch_summary(port):
    exe = shutil.which("espefuse") or shutil.which("espefuse.py")
    cmd = [exe] if exe else [sys.executable, "-m", "espefuse"]
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "summary.json"
        full = cmd + ["--chip", "esp32s3", "-p", port, "summary", "--format", "json", "--file", str(out)]
        r = subprocess.run(full, capture_output=True, text=True)
        if r.returncode != 0 or not out.exists():
            sys.stderr.write(r.stdout + r.stderr)
            raise SystemExit(f"espefuse summary failed (exit {r.returncode})")
        return json.loads(out.read_text())


def self_test():
    ok = True

    def check(name, cond):
        nonlocal ok
        print(("PASS " if cond else "FAIL ") + name)
        ok &= bool(cond)

    for key, (summ, want) in SAMPLES.items():
        got, _ = analyse(summ)
        check(f"fixture {key} -> {want}", got == want)
    partial_missing = {k: v for k, v in SAMPLES["hardened"][0].items() if k != "ENABLE_SECURITY_DOWNLOAD"}
    _, lines = analyse(partial_missing)
    check("missing field reported as unknown field", any("ENABLE_SECURITY_DOWNLOAD" in l and "unknown field" in l for l in lines))
    src = Path(__file__).read_text()
    forbidden = ["burn" + "_efuse", "burn" + "-efuse", "burn" + "_key", "write" + "_protect"]
    for f in forbidden:
        check(f"source contains no '{f}'", f not in src)
    check("source has no signing-tool invocation", ("espsec" + "ure") not in src)
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description="Read-only ESP32-S3 eFuse state check (never writes eFuses).")
    ap.add_argument("-p", "--port", help="serial port of the board in download mode (required unless --json-file/--self-test)")
    ap.add_argument("--json-file", help="saved `espefuse summary --format json` output for offline analysis")
    ap.add_argument("--self-test", action="store_true", help="run built-in fixtures and source checks")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    if a.json_file:
        summary = json.loads(Path(a.json_file).read_text())
    elif a.port:
        summary = fetch_summary(a.port)
    else:
        ap.error("--port is required (or use --json-file / --self-test)")
    print("eFuse state (read-only; valid only for the chip queried):")
    cls, lines = analyse(summary)
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
