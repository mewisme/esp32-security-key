"""Regression tests for the pico-keys-sdk audit fixes (patches/pico-keys-sdk 0007 and 0008).

* Chained APDUs (CLA bit 0x10) are reassembled in chain_buf. The command is driven through CTAPHID_MSG (the CCID
  interface is disabled in the emulator); the reassembly code in process_apdu() is shared by both transports.
  Limit: chain_used + nc must stay below 2038 bytes, anything else answers 6700 and the next command works.
* While a job runs, a packet from another channel is answered with CHANNEL_BUSY and must not disturb the job:
  its keepalives and its final answer keep the owning channel id.

The tests speak raw CTAPHID frames, like test_multikey_cancel.py. They need the emulator build of
tools/run_emulation_tests.sh (USB_BUFFER_SIZE=2048, as on the device).
"""
from __future__ import annotations

import os
import struct
import time

from test_multikey_cancel import (  # noqa: F401  (up_dev is a fixture)
    CID_BROADCAST,
    CMD_CANCEL,
    CMD_ERROR,
    CMD_INIT,
    CMD_KEEPALIVE,
    CMD_PING,
    CTAP1_ERR_CHANNEL_BUSY,
    CTAP2_ERR_KEEPALIVE_CANCEL,
    Raw,
    assert_cbor_status,
    up_dev,
)

CMD_MSG = 0x03
CHAIN_LIMIT = 2038          # exclusive: a chained command must be smaller than this
SW_OK = 0x9000
SW_WRONG_LENGTH = 0x6700
SW_INS_NOT_SUPPORTED = 0x6D00
UNKNOWN_INS = 0x7F


def ext_apdu(cla: int, ins: int, data: bytes) -> bytes:
    """Extended-length case-3 APDU."""
    return bytes([cla, ins, 0, 0, 0]) + struct.pack(">H", len(data)) + data


def msg(d: Raw, apdu: bytes):
    d.send(CMD_MSG, apdu)
    reply = d.reply(5)
    assert reply is not None, "no reply to CTAPHID_MSG"
    cid, cmd, data = reply
    assert cid == d.cid and cmd == CMD_MSG, (hex(cid), hex(cmd), data.hex())
    return data


def sw_of(data: bytes) -> int:
    assert len(data) >= 2, data.hex()
    return struct.unpack(">H", data[-2:])[0]


def chained(d: Raw, total: int, first: int) -> int:
    """Send ``total`` bytes as one chained command (first chunk of ``first`` bytes); returns the final SW."""
    assert 0 < first <= total
    payload = os.urandom(total)
    if first == total:
        return sw_of(msg(d, ext_apdu(0x10, UNKNOWN_INS, payload)))
    assert sw_of(msg(d, ext_apdu(0x10, UNKNOWN_INS, payload[:first]))) in (SW_OK, SW_WRONG_LENGTH)
    return sw_of(msg(d, ext_apdu(0x00, UNKNOWN_INS, payload[first:])))


def assert_still_usable(d: Raw):
    data = msg(d, bytes([0x00, 0x03, 0x00, 0x00]))          # U2F VERSION
    assert data == b"U2F_V2" + struct.pack(">H", SW_OK), data.hex()


def test_chained_apdu_at_the_limit_is_processed(emu):
    d = Raw()
    try:
        assert chained(d, CHAIN_LIMIT - 1, 1500) == SW_INS_NOT_SUPPORTED   # reaches the application
        assert_still_usable(d)
    finally:
        d.close()


def test_chained_apdu_overflow_is_rejected_and_next_command_works(emu):
    d = Raw()
    try:
        for total, first in ((CHAIN_LIMIT + 1, 1500), (CHAIN_LIMIT, 1000), (CHAIN_LIMIT + 400, 1900)):
            assert chained(d, total, first) == SW_WRONG_LENGTH, (total, first)
            assert_still_usable(d)
        # the first chunk alone already too big
        assert chained(d, CHAIN_LIMIT, CHAIN_LIMIT) in (SW_WRONG_LENGTH, SW_INS_NOT_SUPPORTED)
        assert_still_usable(d)
        # three-part chain over the limit: the failing chunk resets the chain
        payload = os.urandom(900)
        assert sw_of(msg(d, ext_apdu(0x10, UNKNOWN_INS, payload))) == SW_OK
        assert sw_of(msg(d, ext_apdu(0x10, UNKNOWN_INS, payload))) == SW_OK
        assert sw_of(msg(d, ext_apdu(0x00, UNKNOWN_INS, payload))) == SW_WRONG_LENGTH
        assert_still_usable(d)
    finally:
        d.close()


def test_busy_other_channel_is_rejected_and_job_keeps_its_channel(up_dev):
    d = up_dev(20)
    other = d.cid + 7
    d.start_mc()
    time.sleep(0.6)                                       # the card thread is inside the presence wait
    # a PING (init + continuation frames) from another channel
    d.send(CMD_PING, os.urandom(100), cid=other)
    deadline = time.monotonic() + 3
    busy = None
    while busy is None and time.monotonic() < deadline:
        m = d.frame(max(deadline - time.monotonic(), 0.05))
        if m is None:
            continue
        cid, cmd, data = m
        if cmd == CMD_KEEPALIVE:
            assert cid == d.cid, "keepalive sent on a foreign channel"
        else:
            busy = m
    assert busy is not None, "no CHANNEL_BUSY for the foreign channel"
    assert busy[0] == other and busy[1] == CMD_ERROR and busy[2][:1] == bytes([CTAP1_ERR_CHANNEL_BUSY]), busy
    # the foreign continuation frame produced nothing, and a broadcast INIT is busy as well
    assert [m for m in d.drain(0.6) if m[1] != CMD_KEEPALIVE] == []
    d.send(CMD_INIT, os.urandom(8), cid=CID_BROADCAST)
    deadline = time.monotonic() + 3
    got = None
    while got is None and time.monotonic() < deadline:
        m = d.frame(max(deadline - time.monotonic(), 0.05))
        if m is not None and m[1] != CMD_KEEPALIVE:
            got = m
    assert got is not None and got[1] == CMD_ERROR and got[2][:1] == bytes([CTAP1_ERR_CHANNEL_BUSY]), got
    # the owner still gets its own answer, on its own channel
    d.cancel()
    reply = d.reply(5)
    assert reply is not None and reply[0] == d.cid
    assert_cbor_status(reply, CTAP2_ERR_KEEPALIVE_CANCEL)


def test_new_channel_ids_are_not_sequential(emu):
    d = Raw()
    try:
        seen = []
        for _ in range(4):
            nonce = os.urandom(8)
            d.send(CMD_INIT, nonce, cid=CID_BROADCAST)
            reply = d.reply(3)
            assert reply is not None and reply[1] == CMD_INIT and reply[2][:8] == nonce
            cid = struct.unpack(">I", reply[2][8:12])[0]
            assert cid not in (0, CID_BROADCAST)
            seen.append(cid)
        assert len(set(seen)) == len(seen)
        assert any(b - a != 1 for a, b in zip(seen, seen[1:])), f"channel ids look sequential: {seen}"
    finally:
        d.close()
