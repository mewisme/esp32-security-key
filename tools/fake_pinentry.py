#!/usr/bin/env python3
"""A pinentry that answers with the public OpenPGP-card FACTORY PINs, for tools/gpg_smoke.* only.

gpg-agent talks to its pinentry program over the Assuan protocol. The smoke scripts (destructive mode) point a
throw-away GNUPGHOME at this program so a factory-reset test card can be exercised without typing. It can only ever
answer with the factory defaults every OpenPGP card ships with (user 123456, admin 12345678) or, in "wrong" mode, with
all-zero PINs to provoke a wrong-PIN error. It reads no environment secret, writes nothing and logs nothing.

MULTIKEY_SMOKE_PIN_MODE=defaults (default) | wrong
"""
from __future__ import annotations

import os
import sys
import urllib.parse

USER_PIN = "123456"
ADMIN_PIN = "12345678"
WRONG_USER_PIN = "000000"
WRONG_ADMIN_PIN = "00000000"


def pin_for(prompt: str, wrong: bool) -> str:
    admin = "admin" in prompt.lower() or "reset code" in prompt.lower()
    if wrong:
        return WRONG_ADMIN_PIN if admin else WRONG_USER_PIN
    return ADMIN_PIN if admin else USER_PIN


def handle(line: str, state: dict, wrong: bool) -> list[str] | None:
    """Answer one Assuan command. None ends the session."""
    cmd, _, arg = line.partition(" ")
    cmd = cmd.upper()
    if cmd == "BYE":
        return None
    if cmd in ("SETDESC", "SETPROMPT", "SETTITLE", "SETERROR"):
        state[cmd] = urllib.parse.unquote(arg)
        return ["OK"]
    if cmd == "GETPIN":
        text = " ".join(state.get(k, "") for k in ("SETTITLE", "SETDESC", "SETPROMPT"))
        return [f"D {pin_for(text, wrong)}", "OK"]
    if cmd == "GETINFO":
        value = {"pid": str(os.getpid()), "flavor": "fake", "version": "1.0"}.get(arg.strip())
        return [f"D {value}", "OK"] if value else ["OK"]
    return ["OK"]  # OPTION, SET*, CONFIRM, MESSAGE, ...


def main() -> int:
    wrong = os.environ.get("MULTIKEY_SMOKE_PIN_MODE", "defaults") == "wrong"
    state: dict = {}
    out = sys.stdout
    out.write("OK Pleased to meet you\n")
    out.flush()
    for raw in sys.stdin:
        reply = handle(raw.rstrip("\r\n"), state, wrong)
        if reply is None:
            out.write("OK closing connection\n")
            out.flush()
            return 0
        out.write("\n".join(reply) + "\n")
        out.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
