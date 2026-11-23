#!/usr/bin/env python3
"""List the DLLs a Windows PE file imports (stdlib only) and fail when a forbidden one is present.

  python tools/check_pe_imports.py multikey.exe [--forbid REGEX]

Used by the release workflow to prove that multikey.exe is statically linked against the C runtime: the default
pattern rejects the Visual C++ runtime and the Universal CRT DLLs, so no redistributable is needed.
"""
from __future__ import annotations

import argparse
import re
import struct
import sys
from pathlib import Path

DEFAULT_FORBID = r"^(vcruntime|msvcp|concrt|vcomp|ucrtbase|api-ms-win-crt-)"


def imports(data: bytes) -> list:
    """Imported DLL names (normal and delay-load imports) of a PE32/PE32+ image."""
    if data[:2] != b"MZ":
        raise ValueError("not a PE file (no MZ header)")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("not a PE file (no PE signature)")
    nsec = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    opt = pe + 24
    magic = struct.unpack_from("<H", data, opt)[0]
    dd = opt + (112 if magic == 0x20B else 96)
    if magic not in (0x10B, 0x20B):
        raise ValueError("unknown optional header magic")
    sections = []
    sec = opt + opt_size
    for i in range(nsec):
        vsize, va, rsize, raw = struct.unpack_from("<IIII", data, sec + 40 * i + 8)
        sections.append((va, max(vsize, rsize), raw))

    def off(rva: int) -> int:
        for va, size, raw in sections:
            if va <= rva < va + size:
                return rva - va + raw
        raise ValueError(f"RVA {rva:#x} is outside every section")

    def cstr(rva: int) -> str:
        o = off(rva)
        return data[o:data.index(b"\0", o)].decode("ascii", "replace")

    names = []
    imp_rva = struct.unpack_from("<I", data, dd + 8)[0]
    if imp_rva:
        o = off(imp_rva)
        while True:
            fields = struct.unpack_from("<IIIII", data, o)
            if fields[3] == 0:  # Name RVA of the terminating descriptor
                break
            names.append(cstr(fields[3]))
            o += 20
    delay_rva = struct.unpack_from("<I", data, dd + 13 * 8)[0]
    if delay_rva:
        o = off(delay_rva)
        while True:
            fields = struct.unpack_from("<IIIIIIII", data, o)
            if fields[1] == 0:
                break
            names.append(cstr(fields[1]))
            o += 32
    return names


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("exe")
    ap.add_argument("--forbid", default=DEFAULT_FORBID)
    a = ap.parse_args()
    try:
        names = imports(Path(a.exe).read_bytes())
    except (ValueError, OSError, struct.error) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    for n in sorted(set(names), key=str.lower):
        print(n)
    bad = [n for n in names if re.search(a.forbid, n, re.I)]
    if bad:
        print(f"FAIL: forbidden imports: {sorted(set(bad))}", file=sys.stderr)
        return 1
    print("PASS: no forbidden imports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
