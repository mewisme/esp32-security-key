#!/usr/bin/env python3
"""Raw-APDU hardware tests of the MKAUTH device-name command (INS 06). Needs the board; NO button press and NO PIN is
needed for the default groups, nothing is written to the device by them.

  .\\.venv\\Scripts\\python tools\\mkauth_name_test.py                 # malformed requests must be rejected, nothing changes
  .\\.venv\\Scripts\\python tools\\mkauth_name_test.py --nobutton      # a valid SET without a press must fail after ~15 s

The Rust CLI refuses bad names before they reach the device, so the device-side validation (which must not depend on
the host being well behaved) is exercised here with hand-built APDUs. Requires `pip install pyscard` and a PC/SC reader.
Works on the PIN-less (unenrolled) device state; the enrolled-with-PIN path is covered by the Rust mock tests only.
"""
import argparse
import sys
import time

from smartcard.System import readers

AID = bytes([0xF0, 0x4D, 0x4B, 0x41, 0x55, 0x54, 0x48, 0x01])
results = []


def record(name, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}{': ' + detail if detail else ''}", flush=True)


def connect(match):
    for r in readers():
        if match.lower() in str(r).lower():
            c = r.createConnection()
            c.connect()
            return c, str(r)
    sys.exit(f"no PC/SC reader containing {match!r}: {[str(r) for r in readers()]}")


def tx(c, apdu):
    data, sw1, sw2 = c.transmit(list(apdu))
    return bytes(data), (sw1 << 8) | sw2


def name_apdu(p1, p2, pin, name):
    body = bytes([len(pin)]) + pin + name
    return bytes([0x80, 0x06, p1, p2, len(body)]) + body + b"\x00"


def get_name(c):
    data, sw = tx(c, bytes([0x80, 0x06, 0, 0, 0]))
    return sw, (data[0] if data else None), data[1:].decode("ascii", "replace")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reader", default="multikey")
    ap.add_argument("--nobutton", action="store_true", help="also test a VALID SET without pressing (takes ~15 s)")
    args = ap.parse_args()
    c, rname = connect(args.reader)
    print("reader:", rname)
    _, sw = tx(c, bytes([0x00, 0xA4, 0x04, 0x00, len(AID)]) + AID)
    record("SELECT MKAUTH", sw == 0x9000, hex(sw))
    sw0, flags0, name0 = get_name(c)
    record("GET works without authorization", sw0 == 0x9000 and flags0 is not None, f"flags={flags0:#04x} name={name0!r}")
    enrolled = tx(c, bytes([0x80, 0x01, 0, 0, 0]))[0][1] == 1
    print(f"      enrolled={enrolled}; stored custom name present={bool(flags0 & 1)}")
    if enrolled:
        print("      note: device is enrolled; PIN-less malformed requests are still expected to be rejected")

    # (label, expected status word, APDU). Invalid names and PIN fields: 6A80; bad lengths: 6700; bad P1/P2: 6A86.
    bad = [
        ("non-ASCII (UTF-8 'o' with acute)", 0x6A80, name_apdu(1, 0, b"", "Kh\u00f3a".encode())),
        ("control character TAB", 0x6A80, name_apdu(1, 0, b"", b"a\tb")),
        ("DEL 0x7F", 0x6A80, name_apdu(1, 0, b"", b"a\x7fb")),
        ("leading space", 0x6A80, name_apdu(1, 0, b"", b" lead")),
        ("trailing space", 0x6A80, name_apdu(1, 0, b"", b"trail ")),
        ("empty name", 0x6A80, name_apdu(1, 0, b"", b"")),
        ("32 characters (one too many)", 0x6A80, name_apdu(1, 0, b"", b"x" * 32)),
        ("pin_len beyond the data", 0x6700, bytes([0x80, 0x06, 1, 0, 3, 9, 0x41, 0x42, 0])),
        ("unknown P1", 0x6A86, bytes([0x80, 0x06, 9, 0, 1, 0, 0])),
        ("P2 out of range", 0x6A86, name_apdu(1, 2, b"", b"ok")),
    ]
    if not enrolled:
        bad.append(("PIN supplied while no PIN exists", 0x6A80, name_apdu(1, 0, b"123456", b"valid name")))
    for label, want, apdu in bad:
        t0 = time.monotonic()
        _, sw = tx(c, apdu)
        dt = time.monotonic() - t0
        # A rejected request must come back at once: it must not wait for a button press (15 s).
        record(f"rejected immediately with {want:04X}: {label}", sw == want and dt < 3, f"SW={sw:04X} in {dt:.2f}s")
    sw1, flags1, name1 = get_name(c)
    record("nothing changed after the malformed requests", (sw1, flags1, name1) == (sw0, flags0, name0),
           f"flags={flags1:#04x} name={name1!r}")

    if args.nobutton:
        print("      do NOT touch the key for ~16 s (valid SET without a press)")
        t0 = time.monotonic()
        _, sw = tx(c, name_apdu(1, 0, b"", b"NoPress Name"))
        dt = time.monotonic() - t0
        record("valid SET without a button press is refused after the timeout", sw == 0x6300 and 13 <= dt <= 20,
               f"SW={sw:04X} after {dt:.1f}s")
        sw2, flags2, name2 = get_name(c)
        record("name unchanged after the refused SET", (sw2, flags2, name2) == (sw0, flags0, name0), name2)
    print(f"\n{sum(results)}/{len(results)} checks passed")
    return 0 if results and all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
