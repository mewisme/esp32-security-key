#!/usr/bin/env python3
"""Read-only USB identity report for the MultiKey device on Windows (no elevation, no writes, no device commands).

  python tools/usb_identity.py [--vid 303A] [--pid 4002] [--expect-product "MultiKeys Security Key"]
                               [--expect-manufacturer MultiKeys] [--json]

What Windows reports and where it comes from (all via PnP properties, so this needs no libusb/driver change):
  * BusReportedDeviceDesc of the composite device  = iProduct string descriptor of the device descriptor
  * BusReportedDeviceDesc of each ..&MI_nn child   = iInterface string of that interface (HID, keyboard, CCID; the
                                                     WinUSB interface has no string on this firmware: esp_tinyusb keeps 8 slots)
  * DeviceDesc / FriendlyName                      = what Device Manager shows (taken from the INF/driver, NOT from the
                                                     device, and cached by Windows per device instance)
  * PC/SC reader name (optional, `multikey readers`) = iManufacturer + iInterface of the CCID interface + index
With --expect-* the exit code is 1 if the strings on the bus differ. On Linux use `lsusb -v -d 303a:4002`.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PS = r"""
$keys = 'DEVPKEY_Device_BusReportedDeviceDesc','DEVPKEY_Device_DeviceDesc','DEVPKEY_Device_FriendlyName','DEVPKEY_Device_Manufacturer'
$out = @()
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\VID_%VID%&PID_%PID%*' } | ForEach-Object {
  $p = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $keys -ErrorAction SilentlyContinue
  $o = [ordered]@{ instance = $_.InstanceId; class = $_.Class }
  foreach ($k in $p) { $o[($k.KeyName -replace 'DEVPKEY_Device_','')] = [string]$k.Data }
  $out += [pscustomobject]$o
}
$out | ConvertTo-Json -Depth 3 -Compress
"""


def pnp(vid: str, pid: str):
    script = PS.replace("%VID%", vid.upper()).replace("%PID%", pid.upper())
    r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"PowerShell failed: {r.stderr.strip()}")
    text = r.stdout.strip()
    if not text:
        return []
    data = json.loads(text)
    return data if isinstance(data, list) else [data]


def readers():
    exe = next((p for p in (ROOT / "host/target/debug/multikey.exe", ROOT / "host/target/release/multikey.exe") if p.exists()), None)
    exe = str(exe) if exe else shutil.which("multikey")
    if not exe:
        return None
    r = subprocess.run([exe, "readers"], capture_output=True, text=True)
    return [l.strip() for l in r.stdout.splitlines() if l.strip() and l.strip() != "(no readers)"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vid", default="303A")
    ap.add_argument("--pid", default="4002")
    ap.add_argument("--expect-product")
    ap.add_argument("--expect-manufacturer")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    if sys.platform != "win32":
        sys.exit("Windows only; use `lsusb -v` elsewhere.")

    devs = pnp(args.vid, args.pid)
    if not devs:
        print(f"no device with VID_{args.vid.upper()}&PID_{args.pid.upper()} present "
              f"(is it in download mode, VID_303A&PID_1001?)", file=sys.stderr)
        return 2
    top = [d for d in devs if "&MI_" not in d["instance"]]
    itfs = sorted((d for d in devs if "&MI_" in d["instance"]), key=lambda d: re.search(r"MI_(\d+)", d["instance"]).group(1))
    rd = readers()
    report = {
        "product_string": top[0].get("BusReportedDeviceDesc", "") if top else None,
        "interfaces": {re.search(r"MI_(\d+)", d["instance"]).group(1): {
            "iInterface": d.get("BusReportedDeviceDesc", ""), "windows_name": d.get("DeviceDesc", ""),
            "class": d.get("class")} for d in itfs},
        "composite_windows_name": top[0].get("DeviceDesc") if top else None,
        "pcsc_readers": rd,
    }
    ok = True
    if args.expect_product is not None:
        got = report["product_string"]
        match = got == args.expect_product
        ok &= match
        report["product_matches_expected"] = match
    if args.expect_manufacturer is not None:
        names = [r for r in (rd or []) if "multikey" in r.lower() or args.expect_manufacturer.lower() in r.lower()]
        match = bool(names) and all(n.startswith(args.expect_manufacturer + " ") for n in names)
        ok &= match
        report["manufacturer_matches_expected_in_reader_name"] = match
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"iProduct (bus reported)   : {report['product_string']!r}")
        for idx, i in report["interfaces"].items():
            print(f"  MI_{idx} iInterface       : {i['iInterface']!r:45} Windows shows {i['windows_name']!r} [{i['class']}]")
        print(f"composite device name     : {report['composite_windows_name']!r} (from the driver, cached per device)")
        print(f"PC/SC readers             : {rd if rd is not None else '(multikey binary not built)'}")
        for k in ("product_matches_expected", "manufacturer_matches_expected_in_reader_name"):
            if k in report:
                print(f"{'PASS' if report[k] else 'FAIL'}  {k}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
