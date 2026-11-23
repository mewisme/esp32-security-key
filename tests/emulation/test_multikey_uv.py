"""MultiKeys FIDO2 user-verification behaviour, run against pico-fido's emulation build.

Source of truth is the patched pico-fido/pico-keys-sdk tree (see tools/run_emulation_tests.sh for the
build). UP is always satisfied in emulation, so these tests pin down UV / PIN semantics only.

Each test gets a factory-fresh device (see conftest.emu). Where firmware behaviour differs from plain
CTAP 2.1 expectations, the test asserts the REAL behaviour and the comment cites file:line.
"""
from __future__ import annotations

import hashlib
import os

import pytest
from conftest import (EXPECTED_AAGUID, FLAG_UP, FLAG_UV, ORIGIN, PIN, RP_ID, UPSTREAM_AAGUID,
                      ClientError, ClientPin, Ctap1, CtapError)
from fido2.ctap1 import ApduError
from fido2.ctap2.config import Config
from fido2.webauthn import (AuthenticatorSelectionCriteria, PublicKeyCredentialCreationOptions,
                            PublicKeyCredentialDescriptor, PublicKeyCredentialParameters,
                            PublicKeyCredentialRequestOptions, PublicKeyCredentialRpEntity,
                            PublicKeyCredentialType, PublicKeyCredentialUserEntity,
                            ResidentKeyRequirement, UserVerificationRequirement)

PERM_MC = ClientPin.PERMISSION.MAKE_CREDENTIAL
PERM_GA = ClientPin.PERMISSION.GET_ASSERTION
PERM_ACFG = ClientPin.PERMISSION.AUTHENTICATOR_CFG


# --------------------------------------------------------------------------- helpers
def reg_options(uv, rk=False):
    return PublicKeyCredentialCreationOptions(
        rp=PublicKeyCredentialRpEntity(id=RP_ID, name="Example"),
        user=PublicKeyCredentialUserEntity(id=os.urandom(8), name="u", display_name="U"),
        challenge=os.urandom(32),
        pub_key_cred_params=[PublicKeyCredentialParameters(type=PublicKeyCredentialType.PUBLIC_KEY, alg=-7)],
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=uv,
            resident_key=ResidentKeyRequirement.REQUIRED if rk else ResidentKeyRequirement.DISCOURAGED),
    )


def auth_options(uv, cred_id):
    return PublicKeyCredentialRequestOptions(
        challenge=os.urandom(32), rp_id=RP_ID, user_verification=uv,
        allow_credentials=[PublicKeyCredentialDescriptor(type=PublicKeyCredentialType.PUBLIC_KEY, id=cred_id)])


def browser_register(client, uv, rk=False):
    resp = client.make_credential(reg_options(uv, rk))
    ao = resp.response.attestation_object
    return ao.auth_data.flags, ao.auth_data.credential_data


def browser_assert(client, uv, cred_data):
    sel = client.get_assertion(auth_options(uv, cred_data.credential_id))
    r = sel.get_response(0)
    ad = r.response.authenticator_data
    # signature must verify with the credential public key
    cred_data.public_key.verify(bytes(ad) + r.response.client_data.hash, r.response.signature)
    return ad.flags


def raw_verify(att_cred_pubkey, asr, cdh):
    att_cred_pubkey.verify(bytes(asr.auth_data) + cdh, asr.signature)


def expect_err(code, fn, *a, **kw):
    with pytest.raises(CtapError) as e:
        fn(*a, **kw)
    assert e.value.code == code, f"expected {code!r}, got {e.value.code!r}"


def setpin(session):
    session.pin.set_pin(PIN)


# =========================================================================== 1. fresh device
def test_01_fresh_getinfo(session):
    info = session.info()
    o = info.options
    assert o["clientPin"] is False          # supported, not set
    assert "uv" not in o                    # no built-in UV (cbor_get_info.c has no "uv" key)
    assert o["alwaysUv"] is False
    assert o["makeCredUvNotRqd"] is True    # CONFIG_MULTIKEY_FIDO_MAKECRED_UV_NOT_REQUIRED (fido.c:484)
    assert o["pinUvAuthToken"] is True
    assert o["rk"] is True
    assert info.aaguid == EXPECTED_AAGUID
    assert info.aaguid != UPSTREAM_AAGUID
    assert "FIDO_2_1" in info.versions


# =========================================================================== 2. no PIN, discouraged/preferred
def test_02_no_pin_browser_discouraged(session, browser):
    client, ui = browser(pin=None)
    uv = UserVerificationRequirement.DISCOURAGED
    flags, cred = browser_register(client, uv)
    assert flags & FLAG_UP and not flags & FLAG_UV
    flags = browser_assert(client, uv, cred)
    assert flags & FLAG_UP and not flags & FLAG_UV
    assert ui.pin_requests == 0


def test_02_no_pin_browser_preferred(session, browser):
    """CLIENT behaviour, not firmware: python-fido2 2.2.1 (_should_use_uv, client/__init__.py:652-661) treats the
    mere presence of the `clientPin` option (even False) as 'UV supported', so userVerification=preferred on a
    PIN-less device raises CONFIGURATION_UNSUPPORTED instead of degrading to no-UV. A browser that degrades
    (modelled by retrying as discouraged) gets UP-only, UV clear."""
    client, ui = browser(pin=None)
    pref = UserVerificationRequirement.PREFERRED
    with pytest.raises(ClientError) as e:
        client.make_credential(reg_options(pref))
    assert e.value.code == ClientError.ERR.CONFIGURATION_UNSUPPORTED
    # degrade like a browser would
    flags, cred = browser_register(client, UserVerificationRequirement.DISCOURAGED)
    assert flags & FLAG_UP and not flags & FLAG_UV
    with pytest.raises(ClientError) as e:
        client.get_assertion(auth_options(pref, cred.credential_id))
    assert e.value.code == ClientError.ERR.CONFIGURATION_UNSUPPORTED
    flags = browser_assert(client, UserVerificationRequirement.DISCOURAGED, cred)
    assert flags & FLAG_UP and not flags & FLAG_UV
    assert ui.pin_requests == 0


def test_02_no_pin_raw_flags_and_signature(session):
    cdh, att = session.mc()
    assert att.auth_data.flags & FLAG_UP and not att.auth_data.flags & FLAG_UV
    cred = att.auth_data.credential_data
    cdh2, asr = session.ga(cred.credential_id)
    assert asr.auth_data.flags & FLAG_UP and not asr.auth_data.flags & FLAG_UV
    raw_verify(cred.public_key, asr, cdh2)


# =========================================================================== 3. no PIN, UV required
def test_03_no_pin_browser_uv_required_fails(session, browser):
    client, ui = browser(pin=None)
    with pytest.raises(ClientError) as e:
        client.make_credential(reg_options(UserVerificationRequirement.REQUIRED))
    assert e.value.code == ClientError.ERR.CONFIGURATION_UNSUPPORTED
    # and for an existing credential
    _, att = session.mc()
    with pytest.raises(ClientError) as e:
        client.get_assertion(auth_options(UserVerificationRequirement.REQUIRED,
                                          att.auth_data.credential_data.credential_id))
    assert e.value.code == ClientError.ERR.CONFIGURATION_UNSUPPORTED


def test_03_no_pin_raw_uv_true_is_invalid_option(session):
    # cbor_make_credential.c:414 / cbor_get_assertion.c:307
    expect_err(CtapError.ERR.INVALID_OPTION, session.mc, uv=True)
    _, att = session.mc()
    expect_err(CtapError.ERR.INVALID_OPTION, session.ga, att.auth_data.credential_data.credential_id, uv=True)


# =========================================================================== 4. with a PIN
def test_04_pin_set_getinfo(session):
    setpin(session)
    o = session.info().options
    assert o["clientPin"] is True
    assert o["alwaysUv"] is False       # same session: keydev_unlocked after set_pin (see test_04_after_power_cycle)
    assert o["makeCredUvNotRqd"] is True
    assert "uv" not in o


def test_04_pin_uv_required_sets_up_and_uv(session, browser):
    setpin(session)
    client, ui = browser(pin=PIN)
    flags, cred = browser_register(client, UserVerificationRequirement.REQUIRED)
    assert flags & FLAG_UP and flags & FLAG_UV
    flags = browser_assert(client, UserVerificationRequirement.REQUIRED, cred)
    assert flags & FLAG_UP and flags & FLAG_UV
    assert ui.pin_requests >= 1


def test_04_pin_uv_required_without_user_pin_fails(session, browser):
    setpin(session)
    client, ui = browser(pin=None)      # user cancels the PIN prompt
    with pytest.raises(ClientError):
        client.make_credential(reg_options(UserVerificationRequirement.REQUIRED))


def test_04_pin_discouraged_non_resident_mc_without_param_is_up_only(session):
    setpin(session)
    # makeCredUvNotRqd (cbor_make_credential.c:436-440, 449): non-rk, uv absent, no pinUvAuthParam -> allowed.
    _, att = session.mc()
    assert att.auth_data.flags & FLAG_UP and not att.auth_data.flags & FLAG_UV


def test_04_pin_discouraged_ga_without_pin_is_up_only(session):
    setpin(session)
    cdh0, att = session.mc()
    cred = att.auth_data.credential_data
    cdh, asr = session.ga(cred.credential_id)
    assert asr.auth_data.flags & FLAG_UP and not asr.auth_data.flags & FLAG_UV
    raw_verify(cred.public_key, asr, cdh)


def test_04_pin_resident_key_mc_without_param_needs_puat(session):
    setpin(session)
    # cbor_make_credential.c:437-438 (rule 7.1)
    expect_err(CtapError.ERR.PUAT_REQUIRED, session.mc, rk=True)


def test_04_pin_resident_key_mc_with_pin_succeeds_with_uv(session):
    setpin(session)
    _, att = session.mc(rk=True, auth_perm=PERM_MC)
    assert att.auth_data.flags & FLAG_UP and att.auth_data.flags & FLAG_UV


def test_04_pin_mc_with_explicit_uv_false_and_rk_needs_puat(session):
    setpin(session)
    expect_err(CtapError.ERR.PUAT_REQUIRED, session.mc, rk=True, uv=False)


def test_04_wrong_pin_decrements_retries_and_does_not_set_uv(session):
    setpin(session)
    cp = session.pin
    start, _ = cp.get_pin_retries()
    expect_err(CtapError.ERR.PIN_INVALID, cp.get_pin_token, "000000", PERM_MC, RP_ID)
    assert cp.get_pin_retries()[0] == start - 1
    # no token was issued, so a UV-less op is still UP-only
    _, att = session.mc()
    assert not att.auth_data.flags & FLAG_UV
    # a correct PIN restores the counter
    cp.get_pin_token(PIN, PERM_MC, RP_ID)
    assert cp.get_pin_retries()[0] == start


def test_04_wrong_pin_token_cannot_authorise_mc(session):
    setpin(session)
    cdh = session.cdh()
    cp = session.pin
    bad_token = os.urandom(32)
    param = cp.protocol.authenticate(bad_token, cdh)
    with pytest.raises(CtapError) as e:
        session.ctap.make_credential(
            cdh, {"id": RP_ID, "name": "x"}, {"id": b"u", "name": "u"},
            [{"type": "public-key", "alg": -7}], pin_uv_param=param, pin_uv_protocol=cp.protocol.VERSION)
    assert e.value.code == CtapError.ERR.PIN_AUTH_INVALID


def test_04_u2f_registered_before_pin_then_pin_set(session):
    """In the SAME power-on session the PIN-wrapped device key is already unlocked by set_pin, so U2F
    is still offered and works (cbor_get_info.c:95 / cmd_authenticate.c:40 use `pin && !keydev_unlocked`)."""
    ctap1 = Ctap1(session.dev)
    app, chal = hashlib.sha256(RP_ID.encode()).digest(), os.urandom(32)
    reg = ctap1.register(chal, app)
    setpin(session)
    assert "U2F_V2" in session.info().versions
    auth = ctap1.authenticate(chal, app, reg.key_handle)
    assert auth.user_presence & 1
    auth.verify(app, chal, reg.public_key)


def test_04_after_power_cycle_pin_blocks_u2f_and_reports_always_uv(emu, session, reopen):
    """After a power cycle with a PIN set (device key is PIN-wrapped and locked):
      * getInfo advertises alwaysUv=True and drops U2F_V2 (cbor_get_info.c:95,104-106),
      * U2F authenticate is refused with SW 6985 (cmd_authenticate.c:40-42).
    makeCredUvNotRqd stays True in getInfo (cbor_get_info.c: only forced False by the AUV *option*)."""
    ctap1 = Ctap1(session.dev)
    app, chal = hashlib.sha256(RP_ID.encode()).digest(), os.urandom(32)
    reg = ctap1.register(chal, app)
    setpin(session)
    session.close()
    emu.restart()
    s2 = reopen()
    info = s2.info()
    assert info.options["clientPin"] is True
    assert info.options["alwaysUv"] is True
    assert "U2F_V2" not in info.versions
    assert info.versions[:1] == ["FIDO_2_0"]
    with pytest.raises(ApduError) as e:
        Ctap1(s2.dev).authenticate(chal, app, reg.key_handle)
    assert e.value.code == 0x6985


def test_04_after_power_cycle_pin_wrapped_key_blocks_uvless_mc(emu, session, reopen):
    """After a power cycle with a PIN set the device key is PIN-wrapped and locked until the first
    PIN-authenticated operation (fido.c load_keydev needs session_pin). Pinned here:
      * a discouraged non-resident makeCredential without pinUvAuthParam is refused with PUAT_REQUIRED (the key
        cannot be loaded; credential_create no longer ignores that), although makeCredUvNotRqd is advertised;
      * getAssertion is refused with PUAT_REQUIRED as well (patch pico-fido 0005);
      * a resident-key makeCredential still needs a PIN (PUAT_REQUIRED);
      * the first PIN-authenticated makeCredential unlocks the key: alwaysUv drops back to False, U2F_V2 returns,
        and UV-less discouraged makeCredential works again (cbor_get_info.c:95 / fido.c:298)."""
    setpin(session)
    _, att = session.mc(auth_perm=PERM_MC)
    cred = att.auth_data.credential_data
    session.close()
    emu.restart()
    s2 = reopen()
    o = s2.info().options
    assert o["alwaysUv"] is True and o["makeCredUvNotRqd"] is True
    expect_err(CtapError.ERR.PUAT_REQUIRED, s2.mc)              # key locked: credential_create refuses
    expect_err(CtapError.ERR.PUAT_REQUIRED, s2.ga, cred.credential_id)
    expect_err(CtapError.ERR.PUAT_REQUIRED, s2.mc, rk=True)
    _, att_pin = s2.mc(auth_perm=PERM_MC)
    assert att_pin.auth_data.flags & FLAG_UV
    info = s2.info()
    assert info.options["alwaysUv"] is False and "U2F_V2" in info.versions
    _, att_up = s2.mc()
    assert att_up.auth_data.flags & FLAG_UP and not att_up.auth_data.flags & FLAG_UV


def _locked_device_with_credential(emu, session, reopen):
    setpin(session)
    _, att = session.mc(auth_perm=PERM_MC)
    cred = att.auth_data.credential_data
    session.close()
    emu.restart()
    return reopen(), cred


def test_04_locked_getassertion_is_refused_not_a_fake_signature(emu, session, reopen):
    """While the PIN-wrapped key is locked (after a power cycle) a UV-less getAssertion is refused with
    PUAT_REQUIRED, whether or not the request carries an options map. Upstream answered with a success carrying a
    made-up credential id and a signature of 0x0B bytes (the silent-authentication decoy): its `up` default was
    false, so a request without options looked like a silent probe. Once a PIN-authenticated operation has
    unlocked the key, the same assertion verifies."""
    s2, cred = _locked_device_with_credential(emu, session, reopen)
    expect_err(CtapError.ERR.PUAT_REQUIRED, s2.ga, cred.credential_id)
    for opts in ({"up": True}, {"up": False}):
        expect_err(CtapError.ERR.PUAT_REQUIRED, s2.ctap.get_assertion, RP_ID, s2.cdh(),
                   [{"type": "public-key", "id": cred.credential_id}], options=opts)
    expect_err(CtapError.ERR.PUAT_REQUIRED, s2.ga, cred.credential_id, uv=False)
    s2.mc(auth_perm=PERM_MC)          # unlock
    cdh, asr = s2.ga(cred.credential_id)
    assert asr.auth_data.flags & FLAG_UP and not asr.auth_data.flags & FLAG_UV
    assert asr.credential["id"] == cred.credential_id
    raw_verify(cred.public_key, asr, cdh)


def test_04_unlocked_getassertion_without_options_is_a_real_assertion(session):
    """A request with no options map means up=true: it must not be mistaken for a silent probe."""
    setpin(session)
    _, att = session.mc(auth_perm=PERM_MC)
    cred = att.auth_data.credential_data
    cdh = session.cdh()
    asr = session.ctap.get_assertion(RP_ID, cdh, [{"type": "public-key", "id": cred.credential_id}])
    assert asr.auth_data.flags & FLAG_UP
    assert asr.credential["id"] == cred.credential_id
    raw_verify(cred.public_key, asr, cdh)


def test_04_no_credential_getassertion_is_an_error(session):
    expect_err(CtapError.ERR.NO_CREDENTIALS, session.ga, b"\x01" * 80)

# =========================================================================== 5. alwaysUv toggle
def _toggle_always_uv(session):
    cp, tok = session.token(PERM_ACFG)
    Config(session.ctap, cp.protocol, tok).toggle_always_uv()


def test_05_always_uv_on(session):
    setpin(session)
    _, att = session.mc()                      # baseline: UP only
    cred = att.auth_data.credential_data
    _toggle_always_uv(session)
    info = session.info()
    assert info.options["alwaysUv"] is True
    assert info.options["makeCredUvNotRqd"] is False   # cbor_get_info.c: AUV forces false
    assert "U2F_V2" not in info.versions
    # discouraged without pinUvAuthParam is refused (cbor_make_credential.c:431-434)
    expect_err(CtapError.ERR.PUAT_REQUIRED, session.mc)
    expect_err(CtapError.ERR.PUAT_REQUIRED, session.mc, rk=True)
    # with a PIN token it works and sets UV
    _, att2 = session.mc(auth_perm=PERM_MC)
    assert att2.auth_data.flags & FLAG_UP and att2.auth_data.flags & FLAG_UV
    # U2F authenticate is refused while alwaysUv (cmd_authenticate.c:40-42)
    with pytest.raises(ApduError) as e:
        app = hashlib.sha256(RP_ID.encode()).digest()
        Ctap1(session.dev).authenticate(os.urandom(32), app, cred.credential_id)
    assert e.value.code == 0x6985


def test_05_always_uv_round_trip_restores_up_only(session):
    """Turning alwaysUv on remembers makeCredUvNotRqd and turning it off restores it (patch pico-fido 0005);
    other configuration is left alone."""
    setpin(session)
    _toggle_always_uv(session)
    o = session.info().options
    assert o["alwaysUv"] is True and o["makeCredUvNotRqd"] is False
    _toggle_always_uv(session)
    o = session.info().options
    assert o["alwaysUv"] is False
    assert o["makeCredUvNotRqd"] is True
    assert o["clientPin"] is True and o["rk"] is True
    _, att = session.mc()
    assert att.auth_data.flags & FLAG_UP and not att.auth_data.flags & FLAG_UV
    # a second round trip behaves the same
    _toggle_always_uv(session)
    _toggle_always_uv(session)
    assert session.info().options["makeCredUvNotRqd"] is True


def test_05_always_uv_remembered_flag_survives_power_cycle(emu, session, reopen):
    """The remembered makeCredUvNotRqd value is stored in flash, so it survives a power cycle."""
    setpin(session)
    _toggle_always_uv(session)
    session.close()
    emu.restart()
    s2 = reopen()
    s2.mc(auth_perm=PERM_MC)          # unlock the PIN-wrapped key
    _toggle_always_uv(s2)
    o = s2.info().options
    assert o["alwaysUv"] is False and o["makeCredUvNotRqd"] is True


def test_05_always_uv_without_token_is_refused(session):
    setpin(session)
    with pytest.raises(CtapError) as e:
        Config(session.ctap).toggle_always_uv()
    assert e.value.code in (CtapError.ERR.PUAT_REQUIRED, CtapError.ERR.PIN_AUTH_INVALID,
                            CtapError.ERR.MISSING_PARAMETER)
    assert session.info().options["alwaysUv"] is False


def test_05_always_uv_getassertion_needs_puat(session):
    """alwaysUv is enforced for getAssertion like for makeCredential (patch pico-fido 0005): without a
    pinUvAuthParam the request is refused with PUAT_REQUIRED; with a PIN token it works and sets UV."""
    setpin(session)
    _, att = session.mc(auth_perm=PERM_MC)
    cred = att.auth_data.credential_data
    _toggle_always_uv(session)
    assert session.info().options["alwaysUv"] is True
    expect_err(CtapError.ERR.PUAT_REQUIRED, session.ga, cred.credential_id)
    cdh, asr = session.ga(cred.credential_id, auth_perm=PERM_GA)
    assert asr.auth_data.flags & FLAG_UP and asr.auth_data.flags & FLAG_UV
    raw_verify(cred.public_key, asr, cdh)


def test_05_always_uv_getassertion_refuses_silent_probe_too(session):
    """A request with options {up: false} and no pinUvAuthParam would return a real UV-less assertion for a
    loadable credential, so alwaysUv refuses it as well."""
    setpin(session)
    _, att = session.mc(auth_perm=PERM_MC)
    cred = att.auth_data.credential_data
    _toggle_always_uv(session)
    expect_err(CtapError.ERR.PUAT_REQUIRED, session.ctap.get_assertion, RP_ID, session.cdh(),
               [{"type": "public-key", "id": cred.credential_id}], options={"up": False})


def test_05_always_uv_survives_power_cycle(emu, session, reopen):
    setpin(session)
    _toggle_always_uv(session)
    session.close()
    emu.restart()
    s2 = reopen()
    o = s2.info().options
    assert o["alwaysUv"] is True and o["makeCredUvNotRqd"] is False
    expect_err(CtapError.ERR.PUAT_REQUIRED, s2.mc)


# =========================================================================== 6. authenticatorReset
def test_06_reset_restores_pinless_device_with_default_options(session):
    setpin(session)
    _toggle_always_uv(session)
    _, att = session.mc(auth_perm=PERM_MC, rk=True)
    session.ctap.reset()
    o = session.info().options
    assert o["clientPin"] is False
    assert o["alwaysUv"] is False
    assert o["makeCredUvNotRqd"] is True   # CONFIG default re-applied (see fido.c:484 + test below)
    assert "uv" not in o
    # fresh behaviour again
    _, att = session.mc()
    assert att.auth_data.flags & FLAG_UP and not att.auth_data.flags & FLAG_UV
    expect_err(CtapError.ERR.INVALID_OPTION, session.mc, uv=True)
    # old credential gone
    cdh, att = session.mc()
    assert session.info().aaguid == EXPECTED_AAGUID


def test_06_reset_clears_credentials_and_pin(session):
    setpin(session)
    _, att = session.mc(auth_perm=PERM_MC)
    cred = att.auth_data.credential_data
    session.ctap.reset()
    assert session.pin.get_pin_retries()[0] == 8
    expect_err(CtapError.ERR.NO_CREDENTIALS, session.ga, cred.credential_id)


def test_06_reset_default_survives_power_cycle(emu, session, reopen):
    session.ctap.reset()
    session.close()
    emu.restart()
    s2 = reopen()
    o = s2.info().options
    assert o["makeCredUvNotRqd"] is True and o["alwaysUv"] is False and o["clientPin"] is False
