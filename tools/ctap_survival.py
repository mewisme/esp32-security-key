#!/usr/bin/env python3
"""Proves that credentials survive a firmware update / USB rename / AAGUID change. Needs the board and a human (touches).

  .\\tools\\run_elevated.ps1 tools\\ctap_survival.py snapshot            # BEFORE the change: 2 touches
  ... flash the new firmware, or rename the device ...
  .\\tools\\run_elevated.ps1 tools\\ctap_survival.py verify              # AFTER the change: 2 touches

snapshot creates one NON-resident ES256 credential for rpId multikey.survival (its id is an encrypted blob that only
the device's own key material can open) and lists every resident credential the device holds for rpId multikey.test
(ids only). verify signs with the saved credential (signature checked against the saved public key) and re-lists the
resident ones: the ids must be identical. Nothing is erased, no PIN is used or changed, no reset is performed.
The state file lives outside the repository (default: %TEMP%\\multikey-survival.json).
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from fido2 import cbor
from fido2.cose import CoseKey
from fido2.ctap import CtapError
from fido2.ctap2 import Ctap2
from fido2.hid import CtapHidDevice
import hashlib

RP_SURV = "multikey.survival"
RP_RES = "multikey.test"
CLIENT_DATA = "survival-test"


def touch_note():
    print("      >>> TOUCH NOW if the key waits: press and release BOOT <<<", flush=True)


def resident_ids(ctap):
    """Credential ids of all discoverable credentials for RP_RES (one touch)."""
    cdh = hashlib.sha256(CLIENT_DATA.encode()).digest()
    touch_note()
    try:
        first = ctap.get_assertion(RP_RES, cdh)
    except CtapError as e:
        if e.code == CtapError.ERR.NO_CREDENTIALS:
            return []
        raise
    ids = [first.credential["id"].hex()]
    for _ in range((first.number_of_credentials or 1) - 1):
        ids.append(ctap.get_next_assertion().credential["id"].hex())
    return sorted(ids)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["snapshot", "verify"])
    ap.add_argument("--yes", action="store_true", help="do not wait for Enter before starting")
    ap.add_argument("--state", default=str(Path(tempfile.gettempdir()) / "multikey-survival.json"))
    args = ap.parse_args()
    devs = list(CtapHidDevice.list_devices())
    if not devs:
        sys.exit("No CTAPHID device found (elevated PowerShell? board in download mode?).")
    ctap = Ctap2(devs[0])
    print(f"device AAGUID {ctap.info.aaguid.hex()} product {devs[0].descriptor.product_name!r}")
    state = Path(args.state)
    if not args.yes and sys.stdin.isatty():
        input("Touches are needed (15 s each). Put a finger near the BOOT button and press Enter to start... ")
    cdh = hashlib.sha256(CLIENT_DATA.encode()).digest()

    if args.mode == "snapshot":
        print("creating a non-resident credential (touch 1)")
        touch_note()
        att = ctap.make_credential(cdh, {"id": RP_SURV, "name": "survival"}, {"id": b"s", "name": "s"},
                                   [{"type": "public-key", "alg": -7}])
        cd = att.auth_data.credential_data
        print("listing resident credentials for", RP_RES, "(touch 2)")
        ids = resident_ids(ctap)
        state.write_text(json.dumps({
            "aaguid": ctap.info.aaguid.hex(),
            "cred_id": cd.credential_id.hex(),
            "public_key_cbor": cbor.encode(dict(cd.public_key)).hex(),
            "resident_ids": ids}, indent=1))
        print(f"saved {state}: 1 non-resident credential, {len(ids)} resident credential(s) for {RP_RES}")
        return 0

    saved = json.loads(state.read_text())
    ok = True
    pk = cbor.decode(bytes.fromhex(saved["public_key_cbor"]))
    key = CoseKey.parse(pk)
    print(f"AAGUID before {saved['aaguid']} / now {ctap.info.aaguid.hex()}"
          + ("  (changed, credentials must not care)" if saved["aaguid"] != ctap.info.aaguid.hex() else ""))
    print("signing with the saved non-resident credential (touch 1)")
    touch_note()
    a = ctap.get_assertion(RP_SURV, cdh, [{"type": "public-key", "id": bytes.fromhex(saved["cred_id"])}])
    try:
        key.verify(a.auth_data + cdh, a.signature)
        print("PASS  non-resident credential still works and its signature verifies against the saved public key")
    except Exception as e:  # noqa: BLE001
        ok = False
        print("FAIL  signature does not verify:", e)
    print("listing resident credentials (touch 2)")
    ids = resident_ids(ctap)
    same = ids == saved["resident_ids"]
    ok &= same
    print(f"{'PASS' if same else 'FAIL'}  resident credential ids for {RP_RES}: {len(ids)} now / {len(saved['resident_ids'])} before")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
