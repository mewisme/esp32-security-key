#!/usr/bin/env python3
"""Interactive physical user-presence test for the MultiKeys FIDO2 key. Needs hardware and a human at the board.

  .\\.venv\\Scripts\\python tools\\ctap_up_test.py            (elevated PowerShell on Windows)

Phases (each uses a NON-resident ES256 credential for rpId 'multikey.test'; nothing is stored on the device, no PIN is
used or changed, no reset is performed):
  A  no touch      : the request must FAIL after ~15 s (a key that succeeds here has no real user presence)
  B  touch         : press and release the button once after 'NOW'; the request must SUCCEED
  C  held button   : hold the button down BEFORE the request starts and keep holding; the request must NOT succeed
                     (a button that was already down does not count); release after the instruction and do not press again
Exit code 0 only if every phase that ran behaved as required.
"""
import argparse
import os
import sys
import threading
import time

from fido2.ctap import CtapError
from fido2.ctap2 import Ctap2
from fido2.hid import CtapHidDevice

RP = {"id": "multikey.test", "name": "MultiKeys test"}
PARAMS = [{"type": "public-key", "alg": -7}]
REFUSED = {CtapError.ERR.USER_ACTION_TIMEOUT, CtapError.ERR.OPERATION_DENIED, CtapError.ERR.ACTION_TIMEOUT,
           CtapError.ERR.TIMEOUT}
results = []


def make_cred(ctap, seen):
    def keepalive(status):
        seen.append((round(time.monotonic() - t0, 2), status))

    t0 = time.monotonic()
    user = {"id": os.urandom(16), "name": "up-test"}
    try:
        ctap.make_credential(os.urandom(32), RP, user, PARAMS, options={"rk": False}, on_keepalive=keepalive)
        return "success", time.monotonic() - t0
    except CtapError as e:
        return f"CtapError {e.code.name}", time.monotonic() - t0


def run_request(ctap):
    out = {}
    seen = []

    def work():
        out["res"], out["dt"] = make_cred(ctap, seen)

    th = threading.Thread(target=work, daemon=True)
    th.start()
    return th, out, seen


def record(name, ok, detail):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skip-hold", action="store_true", help="skip phase C")
    ap.add_argument("--only-a", action="store_true", help="run only phase A (no-touch)")
    ap.add_argument("--repeat-a", type=int, default=1, help="repeat phase A N times (spurious-press check)")
    a = ap.parse_args()

    devs = list(CtapHidDevice.list_devices())
    if not devs:
        print("No CTAPHID device found (Windows needs an elevated PowerShell).")
        return 2
    ctap = Ctap2(devs[0])
    opts = ctap.get_info().options
    print("clientPin option:", opts.get("clientPin"), "(a PIN-protected key would reject these requests; use a key without PIN)")

    for n in range(a.repeat_a):
        print(f"\n=== Phase A ({n + 1}/{a.repeat_a}): DO NOT TOUCH THE BOARD for ~20 s ===", flush=True)
        time.sleep(2)
        th, out, seen = run_request(ctap)
        th.join(30)
        res, dt = out.get("res"), out.get("dt", 0)
        refused = res is not None and res.startswith("CtapError") and CtapError.ERR[res.split()[1]] in REFUSED
        waited = 10 <= dt <= 25
        upneeded = any(s == 2 for _, s in seen)
        record("A no touch", bool(refused and waited), f"{res} after {dt:.1f}s; UP-needed keepalive seen={upneeded}")
    if a.only_a:
        print("\nRESULT:", "ALL AS REQUIRED" if all(results) else "FAILURES")
        return 0 if all(results) else 1

    print("\n=== Phase B: press and release the BOOT button ONCE when you see NOW (within 15 s) ===", flush=True)
    time.sleep(3)
    print("NOW", flush=True)
    th, out, seen = run_request(ctap)
    th.join(30)
    res, dt = out.get("res"), out.get("dt", 0)
    record("B touch", res == "success", f"{res} after {dt:.1f}s; UP-needed keepalive seen={any(s == 2 for _, s in seen)}")

    if not a.skip_hold:
        print("\n=== Phase C: HOLD the BOOT button DOWN now and keep holding ===", flush=True)
        time.sleep(4)
        print("Request starts now. KEEP HOLDING for 6 more seconds...", flush=True)
        th, out, seen = run_request(ctap)
        for i in range(6, 0, -1):
            print(f"  hold {i}", flush=True)
            time.sleep(1)
        print("RELEASE the button now and do NOT press it again. Waiting for the request to end...", flush=True)
        th.join(30)
        res, dt = out.get("res"), out.get("dt", 0)
        record("C held button", res != "success", f"{res} after {dt:.1f}s (success here would mean a held button counted)")

    print("\nRESULT:", "ALL AS REQUIRED" if all(results) else "FAILURES")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
