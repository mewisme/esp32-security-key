"""Regression tests for the pico-fido memory-safety / attack-surface fixes (patches/pico-fido 0007 and 0008).

These run against the emulation build like the other tests here. They have NOT been run by the author of the patches
(the emulator cannot be started alongside the parallel build jobs); run tools/run_emulation_tests.sh alone.

Not testable in emulation:
  * authenticatorReset outside the 10 s power-on window: cbor_reset() only checks board_millis() under
    ``#ifndef ENABLE_EMULATION`` (the emulator has no power-up clock), so the window can only be checked on hardware.
  * Management applet INS 0x1C / 0x1E removal: the management applet is reachable only over CCID, which the emulation
    fixtures disable (PICOKEYS_EMULATION_DISABLE_CCID=1).
"""
from __future__ import annotations

import os

import pytest
from conftest import PIN, RP_ID, ClientPin, CtapError
from fido2 import cbor

CTAP_VENDOR_CBOR = 0xC1  # CTAPHID_VENDOR_FIRST + 1
VENDOR_BACKUP, VENDOR_MSE, VENDOR_UNLOCK, VENDOR_EA = 0x01, 0x02, 0x03, 0x04


def _alive(session):
    """The emulator still answers and a normal request still works."""
    assert session.info() is not None


def _pin_hash_enc_request(session, protocol, pin_hash_enc):
    cp = ClientPin(session.ctap, protocol)
    key_agreement, _shared = cp._get_shared_secret()
    return session.ctap.client_pin(
        protocol.VERSION,
        ClientPin.CMD.GET_TOKEN_USING_PIN,
        key_agreement=key_agreement,
        pin_hash_enc=pin_hash_enc,
        permissions=ClientPin.PERMISSION.MAKE_CREDENTIAL,
        permissions_rpid=RP_ID,
    )


@pytest.mark.parametrize("length", [0, 1, 15, 16, 31, 33, 200])
def test_getpintoken_bad_pinhashenc_len(session, length):
    # Protocol 2 expects IV(16) + 16 = 32 bytes; everything else must be rejected before a retry is spent.
    from conftest import PinProtocolV2

    session.pin.set_pin(PIN)
    before = session.pin.get_pin_retries()
    with pytest.raises(CtapError) as exc:
        _pin_hash_enc_request(session, PinProtocolV2(), os.urandom(length))
    assert exc.value.code == CtapError.ERR.INVALID_PARAMETER
    _alive(session)
    assert session.pin.get_pin_retries() == before
    # a correct token request still works afterwards
    session.token(ClientPin.PERMISSION.MAKE_CREDENTIAL, RP_ID)


@pytest.mark.parametrize("length", [1, 8, 17, 200])
def test_getpintoken_bad_pinhashenc_len_protocol1(session, length):
    from fido2.ctap2.pin import PinProtocolV1

    session.pin.set_pin(PIN)
    before = session.pin.get_pin_retries()
    with pytest.raises(CtapError) as exc:
        _pin_hash_enc_request(session, PinProtocolV1(), os.urandom(length))
    assert exc.value.code == CtapError.ERR.INVALID_PARAMETER
    _alive(session)
    assert session.pin.get_pin_retries() == before


@pytest.mark.parametrize("proto_suffix", [b"\x02", b"\x05"])
def test_credential_id_short_with_proto_prefix(session, proto_suffix):
    # Credential IDs of 32..47 bytes that carry the 0xF1D00202 / 0xF1D00205 prefix used to underflow
    # cred_id_len - hdr_len in credential_verify().
    prefix = b"\xf1\xd0\x02" + proto_suffix
    for tail_len in range(28, 44):
        cred_id = prefix + os.urandom(tail_len)
        with pytest.raises(CtapError) as exc:
            session.ga(cred_id)
        assert exc.value.code == CtapError.ERR.NO_CREDENTIALS, (tail_len, exc.value)
    _alive(session)


def _vendor(session, sub, params=None):
    request = bytes([sub]) + cbor.encode(params or {1: 1})
    return session.dev.call(CTAP_VENDOR_CBOR, request)


@pytest.mark.parametrize("sub", [VENDOR_BACKUP, VENDOR_MSE, VENDOR_UNLOCK, VENDOR_EA])
def test_vendor_backup_disabled(session, sub):
    # BACKUP / MSE / UNLOCK / EA were reachable with only a button press; they must now be INVALID_COMMAND.
    try:
        response = _vendor(session, sub)
    except CtapError as e:
        assert e.code == CtapError.ERR.INVALID_COMMAND
    else:
        assert response[0] == CtapError.ERR.INVALID_COMMAND
    _alive(session)


def test_config_aut_enable_disable_unsupported(session):
    # CTAP_CONFIG vendor sub-commands AUT_ENABLE / AUT_DISABLE are gone. Without a PIN token the request is refused
    # earlier, so only check that the device stays alive and never reports success.
    for vendor_id in (0x00043F56B34285E2, 0x0001A40F04A25ED9):
        request = bytes([0x0D]) + cbor.encode({1: 0xFF, 2: {1: vendor_id}})
        try:
            response = session.dev.call(0x10, request)
        except CtapError:
            continue
        assert response[0] != 0, "AUT_ENABLE/AUT_DISABLE must never report success"
    _alive(session)


@pytest.mark.skip(reason="power-on reset window is compiled out of the emulation build (see module docstring)")
def test_reset_outside_power_window(session):
    pass
