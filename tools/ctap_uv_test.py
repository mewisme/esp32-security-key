#!/usr/bin/env python3
"""Hardware test of the FIDO2 user-presence / user-verification policy of the MultiKeys key (touch-only use).

  .\\tools\\run_elevated.ps1 tools\\ctap_uv_test.py                      # PIN-less device: everything that is safe
  .\\tools\\run_elevated.ps1 tools\\ctap_uv_test.py --only info raw      # no touch needed at all
  .\\tools\\run_elevated.ps1 tools\\ctap_uv_test.py --pin 123456          # additionally the PIN-set scenarios

Needs the board and a human for the groups marked TOUCH. All credentials are NON-resident for rpId multikey.test, so
nothing accumulates on the device. This script never sets or changes a PIN, never resets the authenticator and never
erases anything (setting a PIN is a separate, explicit step: --set-pin, see its help).

Groups (--only):
  info    GetInfo options as a browser sees them, AAGUID                                   (no touch)
  raw     CTAP-level UV option handling: uv=true must be refused (no built-in UV)           (no touch)
  nopin   WebAuthn userVerification discouraged / preferred / required on a PIN-less key    (TOUCH x4)
  timeout no touch -> the request must fail after the configured timeout                   (no touch, ~16 s)
  cancel  CTAPHID_CANCEL aborts a pending request quickly                                   (no touch)
  stale   a press that belongs to no request must not satisfy the next one                  (TOUCH x1, timed)
  pin     PIN set: required -> UV flag; discouraged non-resident -> touch only; rk needs PIN (TOUCH x3, needs --pin)

Exit 0 only if every executed check behaved as required.
"""
import argparse
import hashlib
import os
import sys
import threading
import time

from fido2.client import ClientError, DefaultClientDataCollector, Fido2Client, UserInteraction
from fido2.ctap import CtapError
from fido2.ctap2 import Ctap2
from fido2.ctap2.pin import ClientPin
from fido2.hid import CtapHidDevice
from fido2.webauthn import (AttestedCredentialData, AuthenticatorData, AuthenticatorSelectionCriteria,
                            PublicKeyCredentialCreationOptions, PublicKeyCredentialDescriptor,
                            PublicKeyCredentialParameters, PublicKeyCredentialRequestOptions,
                            PublicKeyCredentialRpEntity, PublicKeyCredentialUserEntity,
                            ResidentKeyRequirement, UserVerificationRequirement)

RP_ID = "multikey.test"
ORIGIN = "https://multikey.test"
UPSTREAM_AAGUID = "89fb94b706c936739b7e30526d968145"
DEFAULT_AAGUID = "0a63b9948ba65e749e5a0f894cc35c4d"
UV = UserVerificationRequirement
results: list[bool] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}{': ' + detail if detail else ''}", flush=True)
    return ok


class UI(UserInteraction):
    """Records what a browser would show: touch prompts and PIN requests."""

    def __init__(self, pin: str | None = None):
        self.pin = pin
        self.touch_prompts = 0
        self.pin_requests = 0

    def prompt_up(self):
        self.touch_prompts += 1
        print("      >>> TOUCH NOW: press and release the BOOT button <<<", flush=True)

    def request_pin(self, permissions, rp_id):
        self.pin_requests += 1
        return self.pin

    def request_uv(self, permissions, rp_id):
        return True


def flags_text(flags: int) -> str:
    return f"UP={int(bool(flags & AuthenticatorData.FLAG.UP))} UV={int(bool(flags & AuthenticatorData.FLAG.UV))}"


def make_options(uv, rk=ResidentKeyRequirement.DISCOURAGED):
    return PublicKeyCredentialCreationOptions(
        rp=PublicKeyCredentialRpEntity(id=RP_ID, name="MultiKeys UV test"),
        user=PublicKeyCredentialUserEntity(id=b"uv-test", name="uv-test", display_name="uv-test"),
        challenge=os.urandom(32),
        pub_key_cred_params=[PublicKeyCredentialParameters(type="public-key", alg=-7)],
        authenticator_selection=AuthenticatorSelectionCriteria(user_verification=uv, resident_key=rk),
        timeout=20000)


def request_options(cred_id: bytes, uv):
    return PublicKeyCredentialRequestOptions(
        challenge=os.urandom(32), rp_id=RP_ID, user_verification=uv, timeout=20000,
        allow_credentials=[PublicKeyCredentialDescriptor(type="public-key", id=cred_id)])


def client_for(dev, ui):
    return Fido2Client(dev, DefaultClientDataCollector(ORIGIN), user_interaction=ui)


def register(client, uv):
    """Returns (credential id, public key object, flags) or raises."""
    resp = client.make_credential(make_options(uv))
    ad = resp.response.attestation_object.auth_data
    return ad.credential_data.credential_id, ad.credential_data.public_key, int(ad.flags)


def assert_(client, cred_id, public_key, uv):
    sel = client.get_assertion(request_options(cred_id, uv))
    r = sel.get_response(0)
    ad = r.response.authenticator_data
    public_key.verify(bytes(ad) + r.response.client_data.hash, r.response.signature)  # raises if invalid
    return int(ad.flags)


def timed(fn):
    t0 = time.monotonic()
    try:
        return fn(), None, time.monotonic() - t0
    except (ClientError, CtapError) as e:
        return None, e, time.monotonic() - t0


def err_name(e) -> str:
    if isinstance(e, ClientError):
        cause = e.cause
        return f"ClientError {e.code.name}" + (f" (cause {cause.code.name})" if isinstance(cause, CtapError) else "")
    if isinstance(e, CtapError):
        return f"CtapError {e.code.name}"
    return repr(e)


def chromium_make_credential(options, uv, rk_required=False, hmac_secret=False, can_collect_pin=True):
    """Port of Chromium's FidoDeviceAuthenticator::PINUVDispositionForMakeCredential (+ the rk/alwaysUv UV upgrade in
    MakeCredentialRequestHandler::SpecializeRequestForAuthenticator), device/fido/*.cc, read 2026-11. Returns
    'NoUV' (plain request, touch only), 'GetToken' (needs a PIN token; with no PIN set Chromium offers to create one)
    or 'Unsatisfiable'. The Windows native WebAuthn dialog is a separate implementation and is NOT modelled here."""
    up = {"discouraged": 0, "preferred": 1, "required": 2}
    pin_supported = "clientPin" in options
    pin_configured = options.get("clientPin") is True
    uv_configured = options.get("uv") is True
    req = uv
    if rk_required or options.get("alwaysUv"):
        req = max((uv, "preferred"), key=lambda x: up[x])
    can_without_uv = req == "discouraged" and bool(options.get("makeCredUvNotRqd"))
    eff = "required" if (pin_configured and not can_without_uv) else req
    if eff == "discouraged" or (eff == "preferred" and (not pin_configured or not can_collect_pin) and not uv_configured
                                and not (hmac_secret and "hmac-secret" in options.get("_ext", []))):
        return "NoUV"
    if (can_collect_pin and pin_supported) or uv_configured:
        return "GetToken"
    return "NoUV" if eff == "preferred" else "Unsatisfiable"


# ---------------------------------------------------------------------------------------------------------------- groups
def group_info(dev, ctap, args):
    info = ctap.info
    o = info.options
    print(f"      versions={info.versions} options={dict(o)} extensions={info.extensions}")
    record("clientPin option present (supported) ", "clientPin" in o, f"clientPin={o.get('clientPin')}")
    pin_set = bool(o.get("clientPin"))
    if not pin_set:
        record("no built-in UV advertised ('uv' option absent)", "uv" not in o, f"uv={o.get('uv')}")
    record("alwaysUv is false", o.get("alwaysUv") is False, f"alwaysUv={o.get('alwaysUv')}")
    record("makeCredUvNotRqd is true (touch-only registration allowed once a PIN exists)",
           o.get("makeCredUvNotRqd") is True, f"makeCredUvNotRqd={o.get('makeCredUvNotRqd')}")
    record("pinUvAuthToken advertised", o.get("pinUvAuthToken") is True)
    aaguid = info.aaguid.hex()
    record("AAGUID is not upstream Pico FIDO's", aaguid != UPSTREAM_AAGUID, aaguid)
    record(f"AAGUID equals the expected project value", aaguid == args.expect_aaguid.lower(), f"{aaguid} (expected {args.expect_aaguid.lower()})")
    if pin_set:
        print("      note: a PIN is set: U2F_V2 is not offered ->", "U2F_V2" not in info.versions)
    # What a browser would do with this GetInfo (Chromium logic), i.e. when a PIN prompt is expected:
    mo = dict(o)
    mo["_ext"] = list(info.extensions or [])
    print("      browser model (Chromium) for this device state:")
    rows = []
    for uv in ("discouraged", "preferred", "required"):
        for rk in (False, True):
            for hs in (False, True):
                rows.append((uv, rk, hs, chromium_make_credential(mo, uv, rk, hs)))
    for uv, rk, hs, d in rows:
        print(f"        uv={uv:11} rk_required={str(rk):5} hmac-secret={str(hs):5} -> {d}")
    plain = {(uv, rk, hs): d for uv, rk, hs, d in rows}
    if not pin_set:
        record("model: PIN-less key, uv=discouraged/preferred, no rk, no hmac-secret -> plain touch-only request",
               plain[("discouraged", False, False)] == "NoUV" and plain[("preferred", False, False)] == "NoUV")
        record("model: PIN-less key, uv=required -> browser must obtain a PIN (offers to create one)",
               plain[("required", False, False)] == "GetToken")


def group_raw(dev, ctap, args):
    cdh = os.urandom(32)
    rp = {"id": RP_ID, "name": "t"}
    user = {"id": b"raw", "name": "raw"}
    for name, call in (
        ("makeCredential uv=true", lambda: ctap.make_credential(cdh, rp, user, [{"type": "public-key", "alg": -7}], options={"uv": True})),
        ("getAssertion uv=true", lambda: ctap.get_assertion(RP_ID, cdh, options={"uv": True})),
    ):
        _, e, dt = timed(call)
        record(f"{name} is refused without a touch (no built-in UV)",
               isinstance(e, CtapError) and e.code == CtapError.ERR.INVALID_OPTION and dt < 3,
               f"{err_name(e) if e else 'SUCCEEDED'} after {dt:.1f}s")


def raw_register(ctap):
    """What Chromium sends when it decides 'no UV': plain makeCredential, no pinUvAuthParam, no options."""
    cdh = hashlib.sha256(os.urandom(8)).digest()
    att = ctap.make_credential(cdh, {"id": RP_ID, "name": "t"}, {"id": b"raw", "name": "raw"},
                               [{"type": "public-key", "alg": -7}])
    cd = att.auth_data.credential_data
    return cd.credential_id, cd.public_key, int(att.auth_data.flags)


def raw_assert(ctap, cred_id, public_key):
    cdh = hashlib.sha256(os.urandom(8)).digest()
    a = ctap.get_assertion(RP_ID, cdh, [{"type": "public-key", "id": cred_id}])
    public_key.verify(bytes(a.auth_data) + cdh, a.signature)
    return int(a.auth_data.flags)


def group_nopin(dev, ctap, args):
    if ctap.info.options.get("clientPin"):
        print("      skipped: a PIN is set (use --pin and group 'pin')")
        return
    ui = UI()
    client = client_for(dev, ui)
    print("      4 touches needed in this group; press only when the prompt says NOW")
    # (1) discouraged through the python-fido2 client (a browser-like client)
    out, e, dt = timed(lambda: register(client, UV.DISCOURAGED))
    cred = None
    if e:
        record("register userVerification=discouraged", False, f"{err_name(e)} after {dt:.1f}s")
    else:
        cid, pk, fl = out
        cred = (cid, pk)
        record("register userVerification=discouraged: UP set, UV NOT set, PIN never requested",
               bool(fl & AuthenticatorData.FLAG.UP) and not fl & AuthenticatorData.FLAG.UV and ui.pin_requests == 0,
               f"{flags_text(fl)} pin_requests={ui.pin_requests}")
    if cred:
        out, e, dt = timed(lambda: assert_(client, cred[0], cred[1], UV.DISCOURAGED))
        record("assert userVerification=discouraged: signature valid, UP set, UV NOT set",
               e is None and bool(out & AuthenticatorData.FLAG.UP) and not out & AuthenticatorData.FLAG.UV,
               err_name(e) if e else flags_text(out))
    # (2) preferred. python-fido2 refuses it (it treats 'preferred' like 'required' whenever clientPin is
    #     merely PRESENT in GetInfo); Chromium does not (see the browser model above): with no PIN configured and no
    #     hmac-secret it sends a plain request. Test the device with exactly that request.
    out, e, dt = timed(lambda: register(client_for(dev, UI()), UV.PREFERRED))
    print(f"      info: python-fido2 client, userVerification=preferred -> "
          f"{err_name(e) if e else 'succeeded ' + flags_text(out[2])} (client policy, not firmware: the device was not asked)")
    out, e, dt = timed(lambda: (print("      >>> TOUCH NOW: press and release the BOOT button <<<", flush=True), raw_register(ctap))[1])
    if e:
        record("preferred (browser model: plain request) registration", False, f"{err_name(e)} after {dt:.1f}s")
    else:
        cid, pk, fl = out
        record("preferred (browser model: plain request): UP set, UV NOT set",
               bool(fl & AuthenticatorData.FLAG.UP) and not fl & AuthenticatorData.FLAG.UV, flags_text(fl))
        out, e, dt = timed(lambda: (print("      >>> TOUCH NOW: press and release the BOOT button <<<", flush=True), raw_assert(ctap, cid, pk))[1])
        record("preferred (browser model: plain request) assertion: signature valid, UP set, UV NOT set",
               e is None and bool(out & AuthenticatorData.FLAG.UP) and not out & AuthenticatorData.FLAG.UV,
               err_name(e) if e else flags_text(out))
    # (3) required: a client with no way to verify the user must refuse before asking for a touch
    ui2 = UI(pin=None)
    client2 = client_for(dev, ui2)
    out, e, dt = timed(lambda: register(client2, UV.REQUIRED))
    record("register userVerification=required without a PIN fails, no UV flag fabricated",
           e is not None and ui2.touch_prompts == 0,
           f"{err_name(e) if e else 'SUCCEEDED ' + flags_text(out[2])} after {dt:.1f}s, "
           f"touch prompts={ui2.touch_prompts}, pin requests={ui2.pin_requests}")
    if cred:
        out, e, dt = timed(lambda: assert_(client2, cred[0], cred[1], UV.REQUIRED))
        record("assert userVerification=required without a PIN fails, no UV flag fabricated",
               e is not None and ui2.touch_prompts == 0,
               f"{err_name(e) if e else 'SUCCEEDED ' + flags_text(out)} after {dt:.1f}s, touch prompts={ui2.touch_prompts}")


def group_timeout(dev, ctap, args):
    print("      do NOT touch the key for ~16 s")
    cdh = os.urandom(32)
    _, e, dt = timed(lambda: ctap.make_credential(cdh, {"id": RP_ID, "name": "t"}, {"id": b"t", "name": "t"},
                                                  [{"type": "public-key", "alg": -7}]))
    refused = {CtapError.ERR.USER_ACTION_TIMEOUT, CtapError.ERR.OPERATION_DENIED, CtapError.ERR.ACTION_TIMEOUT}
    record("no touch: request fails after the user-presence timeout (default 15 s)",
           isinstance(e, CtapError) and e.code in refused and 13 <= dt <= 20,
           f"{err_name(e) if e else 'SUCCEEDED'} after {dt:.1f}s")


def start_pending(ctap, ev, out):
    def run():
        t0 = time.monotonic()
        try:
            ctap.make_credential(os.urandom(32), {"id": RP_ID, "name": "t"}, {"id": b"t", "name": "t"},
                                 [{"type": "public-key", "alg": -7}], event=ev)
            out["r"] = "SUCCEEDED"
        except CtapError as e:
            out["r"] = e.code
        out["dt"] = time.monotonic() - t0
    th = threading.Thread(target=run, daemon=True)
    th.start()
    return th


def group_cancel(dev, ctap, args):
    ev, out = threading.Event(), {}
    th = start_pending(ctap, ev, out)
    time.sleep(2.0)
    t_cancel = time.monotonic()
    ev.set()
    th.join(10)
    dt_after = time.monotonic() - t_cancel
    record("CTAPHID_CANCEL aborts the pending request (KEEPALIVE_CANCEL) within 3 s",
           out.get("r") == CtapError.ERR.KEEPALIVE_CANCEL and dt_after < 3,
           f"{out.get('r')} {dt_after:.2f}s after cancel")
    # The device must be usable again right away (not stuck waiting for the cancelled request).
    t0 = time.monotonic()
    try:
        Ctap2(dev).get_info()
        record("device answers GetInfo right after a cancel", True, f"{time.monotonic() - t0:.2f}s")
    except Exception as e:  # noqa: BLE001
        record("device answers GetInfo right after a cancel", False, repr(e))


def group_stale(dev, ctap, args):
    ev, out = threading.Event(), {}
    th = start_pending(ctap, ev, out)
    time.sleep(1.0)
    ev.set()
    th.join(10)
    ok_cancel = out.get("r") == CtapError.ERR.KEEPALIVE_CANCEL
    record("request A cancelled", ok_cancel, str(out.get("r")))
    print("      >>> NOW press and release BOOT exactly ONCE within the next 6 s. This press belongs to NO request. <<<", flush=True)
    for left in range(6, 0, -1):
        print(f"      ... {left}", flush=True)
        time.sleep(1.0)
    print("      request B starts on a NEW channel (like a browser): do NOT touch the key for ~16 s", flush=True)
    # B must not reuse A's channel: right after CTAPHID_CANCEL the firmware answers the next request on the SAME channel
    # with a stale empty success (known issue, tools/ctap_cancel_probe.py, docs/FIDO_UV.md).
    dev.close()
    ctap = Ctap2(next(iter(CtapHidDevice.list_devices())))
    out2 = {}
    th = start_pending(ctap, threading.Event(), out2)
    th.join(30)
    refused = {CtapError.ERR.USER_ACTION_TIMEOUT, CtapError.ERR.OPERATION_DENIED, CtapError.ERR.ACTION_TIMEOUT}
    record("a press made before request B does not satisfy B (B fails after the timeout)",
           out2.get("r") in refused and out2.get("dt", 0) >= 13, f"{out2.get('r')} after {out2.get('dt', 0):.1f}s")


def group_pin(dev, ctap, args):
    if not args.pin:
        print("      skipped: pass --pin PIN (an existing PIN; this script never sets one by itself)")
        return
    o = ctap.info.options
    if not o.get("clientPin"):
        print("      skipped: no PIN is set on the device")
        return
    ui = UI(pin=args.pin)
    client = client_for(dev, ui)
    print("      3 touches needed in this group")
    out, e, dt = timed(lambda: register(client, UV.REQUIRED))
    if e:
        record("register userVerification=required with the PIN", False, err_name(e))
    else:
        cid, pk, fl = out
        record("required + PIN: UP and UV both set (UV only after a real PIN check)",
               bool(fl & AuthenticatorData.FLAG.UP) and bool(fl & AuthenticatorData.FLAG.UV) and ui.pin_requests >= 1,
               f"{flags_text(fl)} pin_requests={ui.pin_requests}")
    ui2 = UI(pin=None)
    client2 = client_for(dev, ui2)
    out, e, dt = timed(lambda: register(client2, UV.DISCOURAGED))
    if e:
        record("discouraged non-resident registration on a PIN-protected key needs only a touch", False,
               f"{err_name(e)} (makeCredUvNotRqd={o.get('makeCredUvNotRqd')})")
    else:
        cid2, pk2, fl2 = out
        record("discouraged non-resident registration on a PIN-protected key needs only a touch (UP, no UV, no PIN)",
               bool(fl2 & AuthenticatorData.FLAG.UP) and not fl2 & AuthenticatorData.FLAG.UV and ui2.pin_requests == 0,
               flags_text(fl2))
        out, e, dt = timed(lambda: assert_(client2, cid2, pk2, UV.DISCOURAGED))
        record("discouraged assertion on a PIN-protected key needs only a touch",
               e is None and bool(out & AuthenticatorData.FLAG.UP) and not out & AuthenticatorData.FLAG.UV,
               err_name(e) if e else flags_text(out))
    # Resident key without UV must be refused (PUAT_REQUIRED) and must not need a touch.
    _, e, dt = timed(lambda: ctap.make_credential(os.urandom(32), {"id": RP_ID, "name": "t"}, {"id": b"rk", "name": "rk"},
                                                  [{"type": "public-key", "alg": -7}], options={"rk": True}))
    record("resident-key makeCredential without pinUvAuthParam is refused with PUAT_REQUIRED",
           isinstance(e, CtapError) and e.code == CtapError.ERR.PUAT_REQUIRED and dt < 3,
           f"{err_name(e) if e else 'SUCCEEDED (a resident credential was created!)'} after {dt:.1f}s")


GROUPS = {"info": group_info, "raw": group_raw, "nopin": group_nopin, "timeout": group_timeout,
          "cancel": group_cancel, "stale": group_stale, "pin": group_pin}
DEFAULT_GROUPS = ["info", "raw", "nopin", "timeout", "cancel"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="+", choices=list(GROUPS), help=f"groups to run (default: {' '.join(DEFAULT_GROUPS)})")
    ap.add_argument("--pin", help="EXISTING PIN, only for group 'pin' (or set MULTIKEY_TEST_PIN)")
    ap.add_argument("--yes", action="store_true", help="do not wait for Enter before starting")
    ap.add_argument("--expect-aaguid", default=DEFAULT_AAGUID, help="expected AAGUID hex (default: project development value)")
    args = ap.parse_args()
    args.pin = args.pin or os.environ.get("MULTIKEY_TEST_PIN")  # keeps the PIN off the command line
    devs = list(CtapHidDevice.list_devices())
    if not devs:
        sys.exit("No CTAPHID device found. On Windows run from an elevated PowerShell (tools\\run_elevated.ps1); "
                 "also check the board is not in download mode.")
    dev = devs[0]
    ctap = Ctap2(dev)
    print(f"device: {dev.descriptor.product_name!r} VID:PID {dev.descriptor.vid:04X}:{dev.descriptor.pid:04X} "
          f"serial {dev.descriptor.serial_number}")
    groups = args.only or DEFAULT_GROUPS
    if not args.yes and sys.stdin.isatty() and set(groups) & {"nopin", "stale", "pin", "timeout"}:
        input("Touch prompts follow (15 s each). Put a finger near the BOOT button and press Enter to start... ")
    for name in groups:
        print(f"\n== {name}", flush=True)
        GROUPS[name](dev, ctap, args)
    print(f"\n{sum(results)}/{len(results)} checks passed")
    return 0 if results and all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
