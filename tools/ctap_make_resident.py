#!/usr/bin/env python3
"""Create ONE resident (discoverable) ES256 credential for rpId multikey.cli-test, to exercise `multikey fido credentials ...`.

  $env:MULTIKEY_TEST_PIN = '...'      # the FIDO PIN of the key (a PIN must already be set; rk needs one on this firmware)
  .\\tools\\run_elevated.ps1 tools\\ctap_make_resident.py

One touch (press and release BOOT within 15 s). Prints the credential id (hex) and verifies, via getAssertion
discovery, that it is stored. Nothing is deleted and no PIN is set or changed. Delete it again with
`multikey fido credentials delete --id <hex>`.
"""
import hashlib
import os
import sys

from fido2.ctap import CtapError
from fido2.ctap2 import ClientPin, Ctap2
from fido2.hid import CtapHidDevice

RP_ID = "multikey.cli-test"


def main() -> int:
    pin = os.environ.get("MULTIKEY_TEST_PIN")
    if not pin:
        print("set MULTIKEY_TEST_PIN to the key's FIDO PIN first", file=sys.stderr)
        return 64
    devs = list(CtapHidDevice.list_devices())
    if not devs:
        print("no CTAPHID device (Windows needs an elevated shell)", file=sys.stderr)
        return 2
    ctap = Ctap2(devs[0])
    if not ctap.get_info().options.get("clientPin"):
        print("no PIN is set on the key; set one first", file=sys.stderr)
        return 2
    cdh = os.urandom(32)
    cp = ClientPin(ctap)
    tok = cp.get_pin_token(pin, permissions=ClientPin.PERMISSION.MAKE_CREDENTIAL, permissions_rpid=RP_ID)
    print(">>> TOUCH NOW: press and release BOOT <<<", flush=True)
    try:
        att = ctap.make_credential(
            cdh, {"id": RP_ID, "name": "multikey CLI test"},
            {"id": os.urandom(16), "name": "cli-test", "displayName": "CLI test"},
            [{"type": "public-key", "alg": -7}], options={"rk": True},
            pin_uv_param=cp.protocol.authenticate(tok, cdh), pin_uv_protocol=cp.protocol.VERSION,
        )
    except CtapError as e:
        print(f"makeCredential failed: {e}", file=sys.stderr)
        return 1
    cid = bytes(att.auth_data.credential_data.credential_id)
    print("credential id:", cid.hex())
    if att.auth_data.rp_id_hash != hashlib.sha256(RP_ID.encode()).digest():
        print("rpIdHash mismatch", file=sys.stderr)
        return 1
    print("created (resident). List it with: multikey fido credentials list --pin-stdin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
