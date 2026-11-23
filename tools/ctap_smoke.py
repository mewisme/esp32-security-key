#!/usr/bin/env python3
"""FIDO2/U2F smoke test for the connected MultiKeys device (python-fido2 2.x).

Results are valid ONLY for the connected device/firmware at the time of the run. This script does not
prove CTAP2.1 compliance or FIDO conformance; it exercises a handful of commands and checks signatures.
It only deletes credentials it created itself for rpId `multikey.test`.
Paste the output into docs/hw-reports/<date>-ctap.md (a human does that; see docs/TESTING.md).
Status of this script itself: Implemented; import-checked only. Not run against hardware (pending hardware).
On Windows, raw FIDO HID access needs an elevated shell.
"""
import argparse
import datetime
import hashlib
import os
import sys

from fido2.cose import CoseKey
from fido2.ctap import CtapError
from fido2.ctap1 import ApduError, Ctap1
from fido2.ctap2 import Ctap2, ClientPin, CredentialManagement
from fido2.hid import CAPABILITY, CtapHidDevice
from fido2.webauthn import AuthenticatorData

RP_ID = "multikey.test"
RP = {"id": RP_ID, "name": "MultiKeys smoke test"}
HEADER = f"""\
=== MultiKeys CTAP smoke test ({datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}) ===
Results below are valid ONLY for the device that is connected right now. This run does NOT prove CTAP2.1
support or FIDO conformance. A human must paste this output into docs/hw-reports/<date>-ctap.md together with
board, IDF version and firmware commit. Credentials are created only for rpId '{RP_ID}'.
"""

results = []


def record(name, status, reason=""):
    results.append((name, status))
    print(f"[{status}] {name}" + (f" - {reason}" if reason else ""))


def touch_cb(status):
    if int(status) == 2:
        print("    ... touch the device button now (press and release BOOT once; 15 s limit)", flush=True)


def pin_token(dev_ctap, pin, perms, rpid=None):
    cp = ClientPin(dev_ctap)
    tok = cp.get_pin_token(pin, permissions=perms, permissions_rpid=rpid)
    return cp, tok


def has_pin(ctap):
    return bool(ctap.get_info().options.get("clientPin"))


def auth_params(ctap, pin, perms, cdh, rpid):
    """Return (pin_uv_param, pin_uv_protocol) or (None, None) if the device has no PIN set."""
    if not has_pin(ctap):
        return None, None
    cp, tok = pin_token(ctap, pin, perms, rpid)
    return cp.protocol.authenticate(tok, cdh), cp.protocol.VERSION


def roundtrip(ctap, alg, pin, created):
    cdh = os.urandom(32)
    user = {"id": os.urandom(16), "name": f"smoke-{alg}", "displayName": f"smoke {alg}"}
    p, v = auth_params(ctap, pin, ClientPin.PERMISSION.MAKE_CREDENTIAL, cdh, RP_ID)
    print(f"  step: makeCredential alg {alg} (press BOOT within 15 s of the prompt)", flush=True)
    att = ctap.make_credential(
        cdh, RP, user, [{"type": "public-key", "alg": alg}],
        options={"rk": True}, pin_uv_param=p, pin_uv_protocol=v, on_keepalive=touch_cb,
    )
    ad = att.auth_data
    cred = ad.credential_data
    created.append(bytes(cred.credential_id))
    if ad.rp_id_hash != hashlib.sha256(RP_ID.encode()).digest():
        raise AssertionError("rpIdHash mismatch in attestation authData")
    if not ad.flags & AuthenticatorData.FLAG.UP:
        raise AssertionError("UP flag not set in makeCredential authData")
    pub = CoseKey.parse(cred.public_key)
    if pub[3] != alg:
        raise AssertionError(f"credential alg {pub[3]} != requested {alg}")
    cdh2 = os.urandom(32)
    p, v = auth_params(ctap, pin, ClientPin.PERMISSION.GET_ASSERTION, cdh2, RP_ID)
    print(f"  step: getAssertion alg {alg}", flush=True)
    asr = ctap.get_assertion(
        RP_ID, cdh2, [{"type": "public-key", "id": cred.credential_id}],
        pin_uv_param=p, pin_uv_protocol=v, on_keepalive=touch_cb,
    )
    if not asr.auth_data.flags & AuthenticatorData.FLAG.UP:
        raise AssertionError("UP flag not set in getAssertion authData")
    # verify with the `cryptography` package (CoseKey.verify wraps cryptography's verifier)
    pub.verify(bytes(asr.auth_data) + cdh2, asr.signature)
    # tamper check: a modified clientDataHash must fail
    try:
        pub.verify(bytes(asr.auth_data) + os.urandom(32), asr.signature)
    except Exception:
        return
    raise AssertionError("signature verified over a different clientDataHash")


def main():
    ap = argparse.ArgumentParser(description="MultiKeys FIDO2/U2F smoke test (needs hardware).")
    ap.add_argument("--pin", help="device PIN (used for PIN-protected steps; if the device has no PIN, it is SET to this value)")
    ap.add_argument("--reset", action="store_true", help="run authenticatorReset first (wipes ALL credentials and PIN)")
    ap.add_argument("--yes-wipe-device", action="store_true", help="required together with --reset")
    ap.add_argument("--skip-pin-change", action="store_true", help="skip PIN set/verify/change")
    ap.add_argument("--index", type=int, default=0, help="which HID device to use if several are present")
    ap.add_argument("--skip-eddsa", action="store_true", help="skip the EdDSA credential (avoids leaving another test credential)")
    a = ap.parse_args()
    if a.reset and not a.yes_wipe_device:
        print("--reset erases all credentials; add --yes-wipe-device to confirm.", file=sys.stderr)
        return 64

    print(HEADER)
    devs = list(CtapHidDevice.list_devices())
    if not devs:
        print("No CTAPHID device found.")
        if sys.platform == "win32":
            print("On Windows, python-fido2 needs an elevated (Administrator) PowerShell to open FIDO HID devices.")
        print("Check: the board's NATIVE USB port (GPIO19/20) is connected, the fido image is flashed, and")
        print("Get-PnpDevice -PresentOnly | Where-Object InstanceId -like 'USB\\VID_303A*' lists the device.")
        return 2
    if not 0 <= a.index < len(devs):
        print(f"--index {a.index} out of range: {len(devs)} device(s) found.")
        return 2
    dev = devs[a.index]
    print("When a step says 'touch', press the BOOT button once (hold it only briefly, release it).")
    print(f"Device: {dev.descriptor if hasattr(dev, 'descriptor') else dev}  product={getattr(dev, 'product_name', None)}")
    if not CAPABILITY.CBOR.supported(dev.capabilities):
        record("CTAP2 GetInfo", "FAIL", "device does not advertise CBOR capability")
        ctap = None
    else:
        ctap = Ctap2(dev)

    created = []
    eddsa = False

    if ctap and a.reset:
        try:
            print("authenticatorReset: touch the device when it blinks (must be within ~10 s of plug-in).")
            ctap.reset(on_keepalive=touch_cb)
            record("authenticatorReset", "PASS")
        except Exception as e:
            record("authenticatorReset", "FAIL", repr(e))

    if ctap:
        try:
            info = ctap.get_info()
            algs = [x.get("alg") for x in info.algorithms]
            eddsa = -8 in algs
            print(f"  versions    : {info.versions}")
            print(f"  extensions  : {info.extensions}")
            print(f"  algorithms  : {algs}  (EdDSA -8 listed: {eddsa})")
            print(f"  options     : {dict(info.options)}")
            print(f"  aaguid      : {info.aaguid}")
            print(f"  firmware    : {info.firmware_version}")
            print(f"  pinProtocols: {info.pin_uv_protocols}  maxMsgSize: {info.max_msg_size}")
            record("GetInfo", "PASS", "printed above; advertised values only")
        except Exception as e:
            record("GetInfo", "FAIL", repr(e))
            ctap = None

    if ctap:
        pin_set = has_pin(ctap)
        if pin_set and not a.pin:
            record("makeCredential(rk, ES256)+getAssertion", "SKIP", "device has a PIN set; pass --pin")
        else:
            try:
                roundtrip(ctap, -7, a.pin, created)
                record("makeCredential(rk, ES256)+getAssertion", "PASS", "signature verified with cryptography")
            except Exception as e:
                record("makeCredential(rk, ES256)+getAssertion", "FAIL", repr(e))
        if a.skip_eddsa:
            record("EdDSA credential", "SKIP", "--skip-eddsa")
        elif not eddsa:
            record("EdDSA credential", "SKIP", "-8 not listed in GetInfo algorithms")
        elif pin_set and not a.pin:
            record("EdDSA credential", "SKIP", "device has a PIN set; pass --pin")
        else:
            try:
                roundtrip(ctap, -8, a.pin, created)
                record("EdDSA credential", "PASS", "signature verified")
            except Exception as e:
                record("EdDSA credential", "FAIL", repr(e))

        # PIN set/verify/change
        if not a.pin:
            record("PIN set/verify/change", "SKIP", "--pin not given")
        elif a.skip_pin_change:
            record("PIN set/verify/change", "SKIP", "--skip-pin-change")
        else:
            try:
                cp = ClientPin(ctap)
                if not has_pin(ctap):
                    cp.set_pin(a.pin)
                    print("    (PIN was not set; set to --pin value)")
                retries, _ = cp.get_pin_retries()
                if retries <= 3:
                    raise RuntimeError(f"only {retries} PIN retries left; refusing to risk lockout")
                cp.get_pin_token(a.pin, permissions=ClientPin.PERMISSION.GET_ASSERTION, permissions_rpid=RP_ID)
                new = a.pin + "0"
                cp.change_pin(a.pin, new)
                cp.get_pin_token(new, permissions=ClientPin.PERMISSION.GET_ASSERTION, permissions_rpid=RP_ID)
                cp.change_pin(new, a.pin)
                cp.get_pin_token(a.pin, permissions=ClientPin.PERMISSION.GET_ASSERTION, permissions_rpid=RP_ID)
                record("PIN set/verify/change", "PASS", "PIN restored to --pin value")
            except Exception as e:
                record("PIN set/verify/change", "FAIL", repr(e) + " (PIN may now be --pin or --pin+'0')")

        # Credential management
        info = ctap.get_info()
        if not CredentialManagement.is_supported(info):
            record("credential management", "SKIP", "not advertised in GetInfo")
        elif not a.pin or not has_pin(ctap):
            record("credential management", "SKIP", "needs a PIN set on the device and --pin")
        elif not created:
            record("credential management", "SKIP", "no credential created by this run")
        else:
            try:
                cp, tok = pin_token(ctap, a.pin, ClientPin.PERMISSION.CREDENTIAL_MGMT)
                cm = CredentialManagement(ctap, cp.protocol, tok)
                rp_hash = hashlib.sha256(RP_ID.encode()).digest()
                rps = [r for r in cm.enumerate_rps() if r[CredentialManagement.RESULT.RP_ID_HASH] == rp_hash]
                if not rps:
                    raise AssertionError(f"rpId {RP_ID} not enumerated")
                creds = cm.enumerate_creds(rp_hash)
                ids = [bytes(c[CredentialManagement.RESULT.CREDENTIAL_ID]["id"]) for c in creds]
                missing = [i for i in created if i not in ids]
                if missing:
                    raise AssertionError("created credential(s) not enumerated")
                print(f"    {len(ids)} credential(s) for {RP_ID}; deleting only the {len(created)} created by this run")
                for cid in created:
                    cm.delete_cred({"type": "public-key", "id": cid})
                after = [bytes(c[CredentialManagement.RESULT.CREDENTIAL_ID]["id"]) for c in cm.enumerate_creds(rp_hash)]
                if any(i in after for i in created):
                    raise AssertionError("credential still present after delete")
                created.clear()
                record("credential management", "PASS", "enumerate + delete of own credentials")
            except Exception as e:
                record("credential management", "FAIL", repr(e))
        if created:
            print(f"NOTE: {len(created)} test credential(s) for {RP_ID} remain on the device.")

    # U2F via CTAPHID MSG
    try:
        u2f = Ctap1(dev)
        ver = u2f.get_version()
        if ver != "U2F_V2":
            raise AssertionError(f"unexpected U2F version {ver!r}")
        try:
            u2f.authenticate(os.urandom(32), os.urandom(32), os.urandom(64), check_only=True)
            record("U2F version + check-only authenticate", "FAIL", "random key handle was accepted")
        except ApduError as e:
            if e.code in (0x6A80, 0x6985):
                record("U2F version + check-only authenticate", "PASS", f"VERSION=U2F_V2; bogus handle rejected with {e.code:04X}")
            else:
                record("U2F version + check-only authenticate", "FAIL", f"unexpected SW {e.code:04X}")
    except (CtapError, ApduError, OSError) as e:
        record("U2F version + check-only authenticate", "FAIL", repr(e))
    except Exception as e:
        record("U2F version + check-only authenticate", "FAIL", repr(e))
    print("U2F register/authenticate with a real key handle is not exercised (needs button; use a browser or ssh_smoke).")

    print("\n=== Summary (valid only for this device/run) ===")
    for n, s in results:
        print(f"{s:5} {n}")
    return 1 if any(s == "FAIL" for _, s in results) else 0


if __name__ == "__main__":
    sys.exit(main())
