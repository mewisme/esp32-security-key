"""CTAPHID_CANCEL / channel recovery, run against pico-fido's emulation build.

Hardware finding (docs/hw-reports/2026-11-23-uv-and-identity.md): a request sent on the same HID channel right after
a CTAPHID_CANCEL got an instant empty success, replies shifted by one, and CTAPHID_INIT timed out for a while.
Root cause (pico-keys-sdk hid.c/usb.c): the cancel handler zeroed finished_data_size and stopped the job's
timeout, but the card thread was still inside the user-presence wait. It finished the cancelled job later, posted
EV_EXEC_FINISHED and wrote its result byte into the shared response buffer; the next request on the channel took
that stale completion as its own answer. patches/pico-keys-sdk/0005 stamps every job with a generation, answers the
cancel once when the cancelled job has really finished, refuses new commands while a job is outstanding and drops
the completion of an abandoned job; pico-fido 0006 lets CTAPHID_INIT abort a presence wait.

The emulator normally satisfies user presence at once. These tests start it with PICOKEYS_EMULATION_UP_TIMEOUT
(fixture ``emu_up``): the same wait as on the board, with a virtual button that is never pressed.

The tests speak raw CTAPHID frames over the emulator's socket so that nothing hides an empty success or a stale
reply (python-fido2 would swallow some of them).
"""
from __future__ import annotations

import os
import socket
import struct
import threading
import time

import pytest
from conftest import RP_ID, CtapError, Session
from fido2 import cbor
from fido2.ctap2 import Ctap2

CID_BROADCAST = 0xFFFFFFFF
CMD_PING, CMD_INIT, CMD_CBOR, CMD_CANCEL = 0x01, 0x06, 0x10, 0x11
CMD_KEEPALIVE, CMD_ERROR = 0x3B, 0x3F
CTAP2_OK = 0x00
CTAP2_ERR_KEEPALIVE_CANCEL = 0x2D
CTAP2_ERR_OPERATION_DENIED = 0x27
CTAP1_ERR_CHANNEL_BUSY = 0x06


class Raw:
    """Raw CTAPHID over the emulator socket (python-fido2 emulation connection)."""

    def __init__(self):
        self.session = Session()               # python-fido2 allocates a channel for us
        self.conn = self.session.dev._connection
        self.cid = self.session.dev._channel_id

    def close(self):
        self.session.close()

    # ---- frames ------------------------------------------------------------
    def send(self, cmd: int, data: bytes = b"", cid: int | None = None):
        cid = self.cid if cid is None else cid
        first, rest = data[:57], data[57:]
        pkt = struct.pack(">IBH", cid, 0x80 | cmd, len(data)) + first
        self.conn.write_packet(pkt.ljust(64, b"\0"))
        seq = 0
        while rest:
            chunk, rest = rest[:59], rest[59:]
            self.conn.write_packet((struct.pack(">IB", cid, seq) + chunk).ljust(64, b"\0"))
            seq += 1

    def frame(self, timeout: float):
        """Next complete message as (cid, cmd, payload), or None on timeout."""
        deadline = time.monotonic() + timeout
        self.conn.handle.settimeout(max(deadline - time.monotonic(), 0.001))
        try:
            pkt = self.conn.read_packet()
        except (socket.timeout, TimeoutError):
            return None
        cid, cmd, ln = struct.unpack(">IBH", pkt[:7])
        assert cmd & 0x80, f"continuation frame without an initialisation frame: {pkt.hex()}"
        data = pkt[7:7 + ln]
        seq = 0
        while len(data) < ln:
            self.conn.handle.settimeout(2)
            cont = self.conn.read_packet()
            ccid, cseq = struct.unpack(">IB", cont[:5])
            assert (ccid, cseq) == (cid, seq), f"bad continuation {cont[:5].hex()}"
            data += cont[5:5 + ln - len(data)]
            seq += 1
        return cid, cmd & 0x7F, data

    def reply(self, timeout: float):
        """Next non-keepalive message, or None on timeout."""
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return None
            msg = self.frame(left)
            if msg is None:
                return None
            if msg[1] != CMD_KEEPALIVE:
                return msg

    def drain(self, quiet: float = 0.4):
        """Everything that still arrives (without keepalives) until the line stays quiet for ``quiet`` s."""
        out = []
        while True:
            msg = self.frame(quiet)
            if msg is None:
                return out
            if msg[1] != CMD_KEEPALIVE:
                out.append(msg)

    # ---- CTAP2 over the channel -------------------------------------------
    def make_credential_request(self) -> bytes:
        args = {1: os.urandom(32), 2: {"id": RP_ID, "name": "Example"},
                3: {"id": b"u-" + os.urandom(4), "name": "u", "displayName": "U"},
                4: [{"type": "public-key", "alg": -7}]}
        return b"\x01" + cbor.encode(args)

    def start_mc(self):
        self.send(CMD_CBOR, self.make_credential_request())

    def cancel(self):
        self.send(CMD_CANCEL)

    def get_info(self, timeout: float = 3):
        self.send(CMD_CBOR, b"\x04")
        return self.reply(timeout)


def assert_cbor_status(msg, status: int):
    assert msg is not None, "no reply"
    cid, cmd, data = msg
    assert cmd == CMD_CBOR, f"unexpected command 0x{cmd:02x}, data {data.hex()}"
    assert len(data) >= 1 and data[0] == status, f"status {data[:1].hex()} instead of 0x{status:02x} (data {data.hex()})"


def info_core(info: dict) -> dict:
    """The stable part of a getInfo answer (versions, extensions, aaguid, options) plus the set of keys; the rest
    (for example the encrypted identifier) may change between calls."""
    return {"keys": sorted(info), **{k: info[k] for k in (1, 2, 3, 4) if k in info}}


def assert_valid_info(msg, reference: dict | None = None) -> dict:
    """A real getInfo answer: status 0 and a CBOR map that lists the supported versions. Returns its stable part."""
    assert msg is not None, "no reply to getInfo"
    cid, cmd, data = msg
    assert cmd == CMD_CBOR, f"getInfo answered with command 0x{cmd:02x} data {data.hex()}"
    assert data[0] == CTAP2_OK and len(data) > 20, f"empty or failed getInfo reply: {data.hex()}"
    info = cbor.decode(data[1:])
    assert any(v.startswith("FIDO_2") for v in info[1]), info
    core = info_core(info)
    if reference is not None:
        assert core == reference
    return core


@pytest.fixture
def up_dev(emu_up):
    """Factory: emulator with a real UP wait of ``seconds`` plus an open raw channel."""
    opened: list[Raw] = []

    def _open(seconds: int = 20) -> Raw:
        emu_up(seconds)
        raw = Raw()
        opened.append(raw)
        return raw

    yield _open
    for raw in opened:
        try:
            raw.close()
        except OSError:
            pass


# =========================================================================== the wait is real
def test_up_wait_is_real_and_times_out_then_channel_is_usable(up_dev):
    """UP timeout followed by a normal request on the same channel."""
    d = up_dev(2)
    reference = assert_valid_info(d.get_info())
    t0 = time.monotonic()
    d.start_mc()
    msg = d.reply(8)
    assert_cbor_status(msg, CTAP2_ERR_OPERATION_DENIED)
    assert 1.5 <= time.monotonic() - t0 <= 6, "the presence wait did not last about the configured time"
    assert d.drain(0.5) == [], "stray reply after the timeout"
    assert_valid_info(d.get_info(), reference)
    # and the one after that behaves the same way
    d.start_mc()
    assert_cbor_status(d.reply(8), CTAP2_ERR_OPERATION_DENIED)
    assert_valid_info(d.get_info(), reference)


# =========================================================================== cancel during the wait
def test_cancel_during_up_wait_answers_keepalive_cancel_once(up_dev):
    d = up_dev(20)
    d.start_mc()
    time.sleep(0.5)                       # the card thread is inside the presence wait
    t0 = time.monotonic()
    d.cancel()
    assert_cbor_status(d.reply(5), CTAP2_ERR_KEEPALIVE_CANCEL)
    assert time.monotonic() - t0 < 3, "cancel took as long as the presence timeout"
    assert d.drain(1.0) == [], "CTAPHID_CANCEL must be answered exactly once"


def test_cancel_before_the_card_thread_reached_the_wait(up_dev):
    """CANCEL right behind the request: it must not be lost when the wait starts."""
    d = up_dev(20)
    for _ in range(5):
        d.start_mc()
        d.cancel()
        t0 = time.monotonic()
        msgs = []
        while True:
            msg = d.reply(5)
            assert msg is not None, "cancel was lost: the request kept waiting for a touch"
            if msg[1] == CMD_ERROR:
                assert msg[2][0] == CTAP1_ERR_CHANNEL_BUSY
                continue
            msgs.append(msg)
            break
        assert_cbor_status(msgs[0], CTAP2_ERR_KEEPALIVE_CANCEL)
        assert time.monotonic() - t0 < 3
        assert d.drain(0.5) == []


def test_same_channel_reuse_right_after_cancel_returns_real_getinfo(up_dev):
    """The hardware finding: the request after a cancel on the SAME channel must get its own answer."""
    d = up_dev(20)
    reference = assert_valid_info(d.get_info())
    d.start_mc()
    time.sleep(0.5)
    d.cancel()
    assert_cbor_status(d.reply(5), CTAP2_ERR_KEEPALIVE_CANCEL)
    assert_valid_info(d.get_info(), reference)          # not an empty success, not the old request's result
    assert d.drain(0.5) == []
    assert_valid_info(d.get_info(), reference)          # replies stay in step


def test_request_sent_without_waiting_for_the_cancel_answer(up_dev):
    """A host that does not wait for the KEEPALIVE_CANCEL reply gets CHANNEL_BUSY at worst, never a stale or shifted
    reply: after the one cancel answer the channel serves requests normally."""
    d = up_dev(20)
    reference = assert_valid_info(d.get_info())
    for _ in range(3):
        d.start_mc()
        time.sleep(0.3)
        d.cancel()
        d.send(CMD_CBOR, b"\x04")                       # getInfo immediately
        replies = []
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            msg = d.reply(0.7)
            if msg is None:
                break
            replies.append(msg)
        cancelled = [m for m in replies if m[1] == CMD_CBOR and m[2][:1] == bytes([CTAP2_ERR_KEEPALIVE_CANCEL])]
        busy = [m for m in replies if m[1] == CMD_ERROR]
        infos = [m for m in replies if m[1] == CMD_CBOR and m[2][:1] == b"\x00"]
        assert len(cancelled) == 1, replies
        assert all(m[2][0] == CTAP1_ERR_CHANNEL_BUSY for m in busy), replies
        assert len(infos) <= 1 and len(replies) == len(cancelled) + len(busy) + len(infos), replies
        for m in infos:
            assert_valid_info(m, reference)
        if not infos:                                    # it was refused as busy: ask again
            assert_valid_info(d.get_info(), reference)


def test_repeated_cancels_in_a_row(up_dev):
    d = up_dev(20)
    reference = assert_valid_info(d.get_info())
    for i in range(3):
        d.start_mc()
        time.sleep(0.3 + 0.1 * i)
        d.cancel()
        assert_cbor_status(d.reply(5), CTAP2_ERR_KEEPALIVE_CANCEL)
        assert d.drain(0.4) == []
    assert_valid_info(d.get_info(), reference)


def test_second_cancel_and_idle_cancel_are_silent(up_dev):
    d = up_dev(20)
    reference = assert_valid_info(d.get_info())
    d.cancel()                                           # nothing running: no answer at all
    assert d.drain(0.6) == []
    d.start_mc()
    time.sleep(0.3)
    d.cancel()
    d.cancel()                                           # a second cancel for the same request: still one answer
    assert_cbor_status(d.reply(5), CTAP2_ERR_KEEPALIVE_CANCEL)
    assert d.drain(0.8) == []
    assert_valid_info(d.get_info(), reference)


def test_next_request_after_cancel_waits_for_its_own_presence(up_dev):
    """The stale completion used to answer the next request at once. B must wait for a touch like A did, and only
    its own cancel ends it."""
    d = up_dev(20)
    d.start_mc()
    time.sleep(0.4)
    d.cancel()
    assert_cbor_status(d.reply(5), CTAP2_ERR_KEEPALIVE_CANCEL)
    d.start_mc()                                         # request B
    assert d.reply(2.0) is None, "request B was answered although nobody touched the key (stale completion)"
    d.cancel()
    assert_cbor_status(d.reply(5), CTAP2_ERR_KEEPALIVE_CANCEL)
    assert d.drain(0.6) == []


def test_python_fido2_cancel_event_then_reuse_same_channel(up_dev):
    """The same flow through python-fido2 (what tools/ctap_cancel_probe.py does on the board)."""
    d = up_dev(20)
    ctap = Ctap2(d.session.dev)
    out = {}

    def request(event):
        try:
            ctap.make_credential(os.urandom(32), {"id": RP_ID, "name": "Example"},
                                 {"id": b"u", "name": "u", "displayName": "U"},
                                 [{"type": "public-key", "alg": -7}], event=event)
            out["r"] = "success"
        except CtapError as e:
            out["r"] = e.code

    ev = threading.Event()
    th = threading.Thread(target=request, args=(ev,), daemon=True)
    th.start()
    time.sleep(0.6)
    ev.set()
    th.join(8)
    assert out.get("r") == CtapError.ERR.KEEPALIVE_CANCEL, out
    info = ctap.get_info()
    assert any(v.startswith("FIDO_2") for v in info.versions)
    # request B on the same channel waits for presence instead of ending with an empty success
    out.clear()
    ev2 = threading.Event()
    th = threading.Thread(target=request, args=(ev2,), daemon=True)
    th.start()
    time.sleep(1.0)
    assert th.is_alive() and not out, f"second request ended early: {out}"
    ev2.set()
    th.join(8)
    assert out.get("r") == CtapError.ERR.KEEPALIVE_CANCEL, out


# =========================================================================== channels and INIT
def test_new_channel_after_cancel(up_dev):
    d = up_dev(20)
    reference = assert_valid_info(d.get_info())
    d.start_mc()
    time.sleep(0.4)
    d.cancel()
    assert_cbor_status(d.reply(5), CTAP2_ERR_KEEPALIVE_CANCEL)
    nonce = os.urandom(8)
    d.send(CMD_INIT, nonce, cid=CID_BROADCAST)
    msg = d.reply(3)
    assert msg is not None and msg[1] == CMD_INIT and msg[2][:8] == nonce, msg
    new_cid = struct.unpack(">I", msg[2][8:12])[0]
    assert new_cid not in (0, CID_BROADCAST, d.cid)
    d.send(CMD_CBOR, b"\x04", cid=new_cid)
    reply = d.reply(3)
    assert reply is not None and reply[0] == new_cid
    assert_valid_info(reply, reference)
    # the old channel number keeps working as well
    assert_valid_info(d.get_info(), reference)


def test_init_during_presence_wait_aborts_it(up_dev):
    """CTAPHID_INIT while a presence wait runs (a host that re-opens the channel instead of cancelling). Upstream
    dropped the card thread's EXIT request inside the wait, so the INIT blocked the device for the whole timeout."""
    d = up_dev(20)
    reference = assert_valid_info(d.get_info())
    d.start_mc()
    time.sleep(0.5)
    t0 = time.monotonic()
    nonce = os.urandom(8)
    d.send(CMD_INIT, nonce)                               # re-synchronise the existing channel
    msg = d.reply(5)
    assert msg is not None and msg[1] == CMD_INIT and msg[2][:8] == nonce, msg
    assert time.monotonic() - t0 < 3, "INIT was blocked by the presence wait"
    assert d.drain(0.8) == [], "the aborted request produced a reply"
    assert_valid_info(d.get_info(), reference)
    # a fresh request works and waits again for presence
    d.start_mc()
    assert d.reply(1.5) is None
    d.cancel()
    assert_cbor_status(d.reply(5), CTAP2_ERR_KEEPALIVE_CANCEL)
    assert_valid_info(d.get_info(), reference)


def test_cancel_for_another_channel_does_not_cancel_the_running_request(up_dev):
    """CANCEL carries the channel of the transaction it ends; a CANCEL on any other channel number is ignored."""
    d = up_dev(20)
    d.start_mc()
    time.sleep(0.4)
    d.send(CMD_CANCEL, cid=d.cid + 7)
    assert d.reply(1.0) is None, "a cancel on a foreign channel ended the request"
    d.cancel()
    assert_cbor_status(d.reply(5), CTAP2_ERR_KEEPALIVE_CANCEL)
