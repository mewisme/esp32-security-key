#!/usr/bin/env python3
"""End-to-end hardware test of renaming: rename -> USB re-enumeration -> replug (persistence) -> restore default.
Needs the board, the built `multikey` CLI and a human for two button presses and one unplug/replug.

  python tools/name_flow_test.py [--name "Mew's Security Key"] [--default "MultiKeys Security Key"]

Every button prompt is a retry loop (15 s windows, up to --patience seconds in total), so you can press whenever you
notice the message. The device must be unenrolled for MKAUTH (no PIN): once enrolled the CLI asks for the PIN
interactively, which this script does not drive.
Steps:
  1 rename --reenumerate (press 1)  key detaches ~1.5 s; the NEW name must appear on the bus: iProduct, FIDO/Keyboard/CCID
                             interface strings and the PC/SC reader name
  2 replug (no press)        unplug and replug the cable: the NEW name must still be used (persisted in flash)
  3 reset-name --reenumerate (press 2)   the default name must be back on the bus
Nothing but the name file is written; keys, credentials, PINs, VID/PID and the AAGUID are not touched.
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import usb_identity  # noqa: E402

results = []


def record(name, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}{': ' + detail if detail else ''}", flush=True)


def cli(multikey, *a):
    r = subprocess.run([multikey, *a], capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def cli_with_press(multikey, patience, what, *a):
    """Retries while the only problem is a missing button press (exit code 4)."""
    print(f"      >>> {what}: PRESS AND RELEASE BOOT ONCE (any time in the next {patience} s) <<<", flush=True)
    end = time.monotonic() + patience
    while True:
        rc, out = cli(multikey, *a)
        if rc != 4 or time.monotonic() > end:
            return rc, out


def bus(vid="303A", pid="4002"):
    devs = usb_identity.pnp(vid, pid)
    top = [d for d in devs if "&MI_" not in d["instance"]]
    itf = {d["instance"].split("MI_")[1][:2]: d.get("BusReportedDeviceDesc", "") for d in devs if "&MI_" in d["instance"]}
    readers = usb_identity.readers() or []
    return (top[0].get("BusReportedDeviceDesc") if top else None), itf, readers


def wait_for(pred, seconds, label):
    end = time.monotonic() + seconds
    last = None
    while time.monotonic() < end:
        try:
            last = bus()
            if pred(last):
                return last
        except Exception:  # noqa: BLE001 - device briefly absent during re-enumeration
            pass
        time.sleep(0.5)
    print(f"      timed out waiting for: {label}; last seen {last}")
    return None


def check_names(tag, name, snapshot):
    prod, itf, readers = snapshot
    suffixes = {"00": "FIDO", "01": "Keyboard", "02": "CCID"}
    record(f"{tag}: iProduct == {name!r}", prod == name, repr(prod))
    for idx, suf in suffixes.items():
        got = itf.get(idx, "")
        want_prefix = name[: 31 - 1 - len(suf)].rstrip()
        record(f"{tag}: MI_{idx} iInterface == '<name> {suf}'", got == f"{want_prefix} {suf}", repr(got))
    rd = [r for r in readers if "multikey" in r.lower() or name.lower()[:10] in r.lower()]
    record(f"{tag}: PC/SC reader name contains the name and the manufacturer",
           bool(rd) and all(name[:20] in r or name[:10] in r for r in rd), repr(rd))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", default="Mew's Security Key")
    ap.add_argument("--default", default="MultiKeys Security Key")
    ap.add_argument("--patience", type=int, default=120)
    ap.add_argument("--multikey", default=str(ROOT / "host/target/debug/multikey.exe"))
    args = ap.parse_args()
    mk = args.multikey

    rc, out = cli(mk, "device", "show")
    print(out)
    if rc != 0:
        sys.exit("cannot talk to the device")
    if "custom" in out.splitlines()[0]:
        print("      note: a custom name is already stored; the test starts from it")

    rc, out = cli_with_press(mk, args.patience, "step 1, rename + re-enumerate", "device", "rename", args.name, "--reenumerate")
    record("1 rename accepted (button), re-enumeration requested", rc == 0 and "(custom)" in out, out.replace("\n", " | "))
    snap = wait_for(lambda s: s[0] == args.name and s[2], 40, "new name on the bus after re-enumeration")
    if snap:
        check_names("1 after re-enumeration", args.name, snap)
        rc, out = cli(mk, "device", "show")
        record("1 stored name is custom and no longer pending", rc == 0 and args.name in out and "pending         : false" in out, out.replace("\n", " | "))
    else:
        record("1 new name appeared on the bus", False)

    print("      >>> step 2: UNPLUG the USB cable, wait 3 s, PLUG IT BACK IN (no button) <<<", flush=True)
    gone = wait_for(lambda s: s[0] is None, args.patience, "device to disappear")
    back = wait_for(lambda s: s[0] is not None and s[2], args.patience, "device to come back")
    record("2 device was unplugged and came back", bool(gone) and bool(back))
    if back:
        check_names("2 after replug", args.name, back)
        rc, out = cli(mk, "device", "show")
        record("2 stored name survived the power cycle (custom, not pending)", rc == 0 and "(custom)" in out and "pending         : false" in out, out.replace("\n", " | "))

    rc, out = cli_with_press(mk, args.patience, "step 3, restore default name", "device", "reset-name", "--reenumerate")
    record("3 reset-name accepted (button)", rc == 0 and "(default)" in out, out.replace("\n", " | "))
    snap = wait_for(lambda s: s[0] == args.default and s[2], 40, "default name back on the bus")
    if snap:
        check_names("3 after reset-name", args.default, snap)
    else:
        record("3 default name back on the bus", False)
    print(f"\n{sum(results)}/{len(results)} checks passed")
    return 0 if results and all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
