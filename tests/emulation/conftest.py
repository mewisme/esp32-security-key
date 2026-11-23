"""Fixtures for the hardware-free MultiKeys FIDO2 UV tests.

The emulator (pico-fido built with ENABLE_EMULATION=1) is started by tools/run_emulation_tests.sh,
which exports EMU_BIN (binary) and EMU_RUNDIR (cwd; the flash image is ``memory.flash`` in there).
This module owns the process so a test can power-cycle it: every test gets a factory-fresh device
(``memory.flash`` deleted) unless it asks for ``emu.restart()``.

The CTAP HID transport is python-fido2's emulation backend, installed into the venv the upstream way
(pico-fido/tests/docker/fido2/* copied over fido2/hid/).
"""
from __future__ import annotations

import hashlib
import os
import signal
import socket
import subprocess
import time

import pytest
from fido2.client import (
    ClientError,
    DefaultClientDataCollector,
    Fido2Client,
    UserInteraction,
)
from fido2.ctap import CtapError
from fido2.ctap1 import Ctap1
from fido2.ctap2 import Ctap2
from fido2.ctap2.pin import ClientPin, PinProtocolV2
from fido2.hid import CtapHidDevice

HOST, PORT = "127.0.0.1", 35962
RP_ID = "example.com"
ORIGIN = "https://example.com"
PIN = "123456"
EXPECTED_AAGUID = bytes.fromhex(os.environ.get("EMU_AAGUID_HEX", "0a63b9948ba65e749e5a0f894cc35c4d"))
UPSTREAM_AAGUID = bytes.fromhex("89fb94b706c936739b7e30526d968145")

FLAG_UP = 0x01
FLAG_UV = 0x04
FLAG_AT = 0x40


class Emulator:
    """Owns the pico-fido emulator process."""

    def __init__(self, binary: str, rundir: str):
        self.binary = binary
        self.rundir = rundir
        self.proc: subprocess.Popen | None = None
        self.log = None
        self.extra_env: dict[str, str] = {}

    @property
    def flash(self) -> str:
        return os.path.join(self.rundir, "memory.flash")

    def start(self, fresh: bool = True) -> None:
        assert self.proc is None
        os.makedirs(self.rundir, exist_ok=True)
        if fresh and os.path.exists(self.flash):
            os.remove(self.flash)
        env = dict(os.environ, PICOKEYS_EMULATION_DISABLE_CCID="1", **self.extra_env)
        self.log = open(os.path.join(self.rundir, "emulator.log"), "ab")
        self.proc = subprocess.Popen([self.binary], cwd=self.rundir, env=env,
                                     stdout=self.log, stderr=subprocess.STDOUT)
        deadline = time.time() + 15
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"emulator exited early ({self.proc.returncode})")
            s = socket.socket()
            s.settimeout(0.2)
            try:
                s.connect((HOST, PORT))
                s.close()
                time.sleep(0.2)  # let the main loop settle after the accept-probe
                return
            except OSError:
                s.close()
                time.sleep(0.1)
        raise RuntimeError("emulator did not open its HID port")

    def stop(self) -> None:
        if self.proc is None:
            return
        self.proc.send_signal(signal.SIGTERM)
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        self.proc = None
        if self.log:
            self.log.close()

    def restart(self) -> None:
        """Power-cycle: keep the flash image."""
        self.stop()
        self.start(fresh=False)


@pytest.fixture(scope="session")
def _emu_session():
    binary, rundir = os.environ.get("EMU_BIN"), os.environ.get("EMU_RUNDIR")
    if not binary or not rundir:
        pytest.exit("EMU_BIN / EMU_RUNDIR not set: run tools/run_emulation_tests.sh", returncode=2)
    emu = Emulator(binary, rundir)
    yield emu
    emu.stop()


@pytest.fixture
def emu(_emu_session):
    """A factory-fresh emulator (no PIN, no credentials) for every test."""
    _emu_session.stop()
    _emu_session.extra_env = {}
    _emu_session.start(fresh=True)
    yield _emu_session
    _emu_session.stop()


@pytest.fixture
def emu_up(_emu_session):
    """Factory: a factory-fresh emulator whose user-presence wait is real. The virtual button is never pressed,
    so a presence check lasts ``seconds`` and then fails, unless the host cancels or resets it first.
    Uses PICOKEYS_EMULATION_UP_TIMEOUT (see pico-keys-sdk button.c); the default emulator satisfies UP at once."""
    def _start(seconds: int) -> Emulator:
        _emu_session.stop()
        _emu_session.extra_env = {"PICOKEYS_EMULATION_UP_TIMEOUT": str(seconds)}
        _emu_session.start(fresh=True)
        return _emu_session

    yield _start
    _emu_session.stop()
    _emu_session.extra_env = {}


class Session:
    """One open CTAP HID connection plus the helpers the tests share."""

    def __init__(self):
        self.dev = next(CtapHidDevice.list_devices())
        self.ctap = Ctap2(self.dev)

    def close(self):
        self.dev.close()

    # ---- raw CTAP2 helpers -------------------------------------------------
    def info(self):
        return self.ctap.get_info()

    @property
    def pin(self) -> ClientPin:
        return ClientPin(self.ctap, PinProtocolV2())

    def token(self, perms, rp_id=None, pin=PIN):
        cp = self.pin
        return cp, cp.get_pin_token(pin, perms, rp_id)

    @staticmethod
    def cdh(label: bytes = b"x") -> bytes:
        return hashlib.sha256(label + os.urandom(8)).digest()

    def mc(self, *, rk=False, uv=None, auth_perm=None, rp_id=RP_ID, pin=PIN, pin_param=True):
        """Raw makeCredential. ``auth_perm`` (a ClientPin.PERMISSION) adds a pinUvAuthParam from a PIN token;
        ``uv`` is the CTAP ``uv`` option (None = absent)."""
        cdh = self.cdh()
        opts = {}
        if rk:
            opts["rk"] = True
        if uv is not None:
            opts["uv"] = uv
        param = proto = None
        if auth_perm is not None:
            cp, tok = self.token(auth_perm, rp_id, pin)
            param, proto = cp.protocol.authenticate(tok, cdh), cp.protocol.VERSION
        att = self.ctap.make_credential(
            cdh, {"id": rp_id, "name": "Example"},
            {"id": b"user-" + os.urandom(4), "name": "u", "displayName": "U"},
            [{"type": "public-key", "alg": -7}],
            options=opts or None, pin_uv_param=param, pin_uv_protocol=proto)
        return cdh, att

    def ga(self, cred_id, *, uv=None, auth_perm=None, rp_id=RP_ID, pin=PIN):
        cdh = self.cdh()
        opts = {"uv": uv} if uv is not None else None
        param = proto = None
        if auth_perm is not None:
            cp, tok = self.token(auth_perm, rp_id, pin)
            param, proto = cp.protocol.authenticate(tok, cdh), cp.protocol.VERSION
        asr = self.ctap.get_assertion(
            rp_id, cdh, [{"type": "public-key", "id": cred_id}],
            options=opts, pin_uv_param=param, pin_uv_protocol=proto)
        return cdh, asr


@pytest.fixture
def session(emu):
    s = Session()
    yield s
    s.close()


@pytest.fixture
def reopen(emu):
    """Factory for extra connections (e.g. after emu.restart())."""
    opened = []

    def _open():
        s = Session()
        opened.append(s)
        return s

    yield _open
    for s in opened:
        try:
            s.close()
        except OSError:
            pass


# ---- the "browser": python-fido2 Fido2Client with a scripted UserInteraction -----------------
class ScriptedUI(UserInteraction):
    """Answers like a browser: supplies a PIN if (and only if) one was configured; records prompts."""

    def __init__(self, pin: str | None = None):
        self.pin = pin
        self.pin_requests = 0
        self.up_prompts = 0
        self.uv_requests = 0

    def prompt_up(self):
        self.up_prompts += 1

    def request_pin(self, permissions, rp_id):
        self.pin_requests += 1
        return self.pin

    def request_uv(self, permissions, rp_id):
        self.uv_requests += 1
        return False  # this device has no built-in UV


def make_client(dev, ui: ScriptedUI) -> Fido2Client:
    return Fido2Client(
        dev,
        client_data_collector=DefaultClientDataCollector(ORIGIN, verify=lambda rp, origin: True),
        user_interaction=ui,
    )


@pytest.fixture
def browser(session):
    def _make(pin: str | None = None):
        ui = ScriptedUI(pin)
        return make_client(session.dev, ui), ui

    return _make


__all__ = [
    "ClientError", "CtapError", "Ctap1", "ClientPin", "PinProtocolV2", "FLAG_UP", "FLAG_UV", "FLAG_AT",
    "EXPECTED_AAGUID", "UPSTREAM_AAGUID", "RP_ID", "ORIGIN", "PIN",
]
