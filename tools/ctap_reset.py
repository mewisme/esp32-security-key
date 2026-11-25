#!/usr/bin/env python3
"""authenticatorReset for the connected MultiKeys (DESTRUCTIVE: deletes every credential and the FIDO PIN).

  .\\tools\\run_elevated.ps1 tools\\ctap_reset.py --yes-wipe-device

The firmware is built with ENABLE_POWER_ON_RESET=1 (CTAP 2.1): it only accepts a reset within 10 seconds of power-up
and needs a button press, so the script asks you to
unplug and re-plug the key, waits for it to reappear and sends the reset immediately; then press BOOT when told.
It prints the GetInfo options before and after (clientPin / makeCredUvNotRqd / alwaysUv). Nothing else is changed.
"""
import argparse
import sys
import time

from fido2.ctap import CtapError
from fido2.ctap2 import Ctap2
from fido2.hid import CtapHidDevice


def first_device():
    try:
        devs = list(CtapHidDevice.list_devices())
    except Exception:  # noqa: BLE001 - the device may be mid-enumeration
        return None
    return devs[0] if devs else None


def options(dev):
    return dict(Ctap2(dev).get_info().options)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes-wipe-device", action="store_true", required=True)
    ap.add_argument("--wait", type=int, default=120, help="seconds to wait for the unplug and the replug")
    a = ap.parse_args()
    dev = first_device()
    if dev is None:
        print("no key found", file=sys.stderr)
        return 2
    print("options before:", options(dev))
    print("UNPLUG the key now, then plug it back in (reset is accepted only within 10 s of power-up).", flush=True)
    deadline = time.time() + a.wait
    while first_device() is not None:  # wait for the unplug
        if time.time() > deadline:
            print("the key was not unplugged", file=sys.stderr)
            return 2
        time.sleep(0.3)
    while (dev := first_device()) is None:  # wait for the replug
        if time.time() > deadline:
            print("the key did not reappear", file=sys.stderr)
            return 2
        time.sleep(0.1)
    print(">>> key is back: PRESS BOOT NOW to confirm the reset <<<", flush=True)
    try:
        Ctap2(dev).reset()
    except CtapError as e:
        print(f"reset failed: {e}", file=sys.stderr)
        return 1
    time.sleep(1)
    after = None
    for _ in range(20):
        d = first_device()
        if d is not None:
            try:
                after = options(d)
                break
            except Exception:  # noqa: BLE001
                pass
        time.sleep(0.5)
    print("options after: ", after)
    ok = after is not None and not after.get("clientPin")
    print("RESET OK (no PIN set)" if ok else "reset returned but the PIN state could not be confirmed as cleared")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
