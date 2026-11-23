#!/usr/bin/env python3
"""Diagnostic: what does the key answer to a request that follows a CTAPHID_CANCELled one? No button press needed.

  .\\tools\\run_elevated.ps1 tools\\ctap_cancel_probe.py

Sequence per case: request A (makeCredential, waits for a touch) -> cancelled after 1 s -> wait DELAY seconds -> request B
(makeCredential, same shape, nobody touches). B must wait ~15 s and then fail with OPERATION_DENIED. The raw reply of B is
printed (python-fido2's own parser would hide an empty success). Non-resident, nothing is stored, no PIN, no reset.
"""
import os
import sys
import threading
import time

from fido2.ctap import CtapError
from fido2.ctap2 import Ctap2
from fido2.hid import CtapHidDevice


def request(ctap, ev=None):
    args = {1: os.urandom(32), 2: {"id": "multikey.test", "name": "t"}, 3: {"id": b"p", "name": "p"},
            4: [{"type": "public-key", "alg": -7}]}
    t0 = time.monotonic()
    try:
        r = ctap.send_cbor(Ctap2.CMD.MAKE_CREDENTIAL, args, event=ev)
        return f"SUCCESS-REPLY {type(r).__name__} keys={sorted(r) if isinstance(r, dict) else r!r}", time.monotonic() - t0
    except CtapError as e:
        return f"CtapError {e.code.name}", time.monotonic() - t0


def open_dev():
    return next(iter(CtapHidDevice.list_devices()))


def case(delay, fresh):
    """A cancelled after 1 s; B after DELAY s on the same channel, or (fresh) on a new channel (new CTAPHID_INIT)."""
    dev = open_dev()
    ctap = Ctap2(dev)
    ev, out = threading.Event(), {}
    th = threading.Thread(target=lambda: out.update(a=request(ctap, ev)), daemon=True)
    th.start()
    time.sleep(1.0)
    ev.set()
    th.join(10)
    print(f"  A after cancel: {out.get('a')}", flush=True)
    time.sleep(delay)
    if fresh:
        dev.close()
        ctap = Ctap2(open_dev())
    res, dt = request(ctap)
    ok = res == "CtapError OPERATION_DENIED" and dt >= 13
    print(f"{'PASS' if ok else 'FAIL'}  delay {delay}s, {'fresh channel' if fresh else 'same channel'}: B -> {res} after {dt:.1f}s", flush=True)
    time.sleep(20)  # let any leftover (stale) work finish before the next case
    return ok


def main() -> int:
    if not list(CtapHidDevice.list_devices()):
        sys.exit("No CTAPHID device (elevated shell? download mode?)")
    print("DO NOT TOUCH THE BOARD during this probe (about 2 minutes).", flush=True)
    results = []
    for delay, fresh in ((2, True), (0, False), (6, False)):
        try:
            results.append(case(delay, fresh))
        except Exception as e:  # noqa: BLE001
            print(f"FAIL  delay {delay}, fresh={fresh}: {type(e).__name__}: {e}", flush=True)
            results.append(False)
            time.sleep(20)
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
