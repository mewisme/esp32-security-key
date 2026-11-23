#!/usr/bin/env python3
"""Read-only HID liveness probe: lists CTAPHID devices, sends CTAPHID_INIT and GetInfo, prints each stage, and ends the
process after 25 s whatever happens (a hung HID call cannot block the terminal). No touch, no PIN, nothing is stored.

  .\\.venv\\Scripts\\python.exe -u tools\\ctap_hid_probe.py        (elevated PowerShell on Windows)
"""
import os
import threading
import time

threading.Timer(25, lambda: (print("STUCK: no answer within 25 s (the process was ended by the watchdog)", flush=True), os._exit(3))).start()
t0 = time.monotonic()


def say(msg):
    print(f"[{time.monotonic() - t0:5.1f}s] {msg}", flush=True)


from fido2.ctap2 import Ctap2  # noqa: E402
from fido2.hid import CtapHidDevice  # noqa: E402

say("listing HID devices")
devs = list(CtapHidDevice.list_devices())
say(f"{len(devs)} device(s): " + ", ".join(f"{d.descriptor.product_name!r} {d.descriptor.vid:04X}:{d.descriptor.pid:04X}" for d in devs))
if not devs:
    os._exit(2)
say("CTAPHID_INIT done (device opened)")
info = Ctap2(devs[0]).info
say(f"GetInfo ok: versions={info.versions[:2]}.. alwaysUv={info.options.get('alwaysUv')} clientPin={info.options.get('clientPin')}")
os._exit(0)
