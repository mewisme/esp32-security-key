#!/usr/bin/env python3
"""Writes tests/vectors/partition_tables.json: partition-table byte vectors with the verdict BOTH implementations must
reach (tools/flash_dev.py judge_device_table and web/src/lib/flashing/partition-table.ts parsePartitionTable).

The verdicts below are written by hand from the safety rules, not computed from either implementation, so the two
cannot drift together unnoticed. Run `python tests/vectors/gen_partition_vectors.py` after editing a case.

Table bytes are stored without the 0xFF padding; the readers pad them to `pad_to` (the size the installer reads).
"""
import hashlib
import json
from pathlib import Path

PAD_TO = 0xC00
FLASH_SIZE = "16MB"

# Same entries as partitions.csv; type/subtype as the release manifest publishes them.
LAYOUT = [
    {"name": "nvs", "type": "data", "subtype": "nvs", "offset": 0x11000, "size": 0x6000},
    {"name": "phy_init", "type": "data", "subtype": "phy", "offset": 0x17000, "size": 0x1000},
    {"name": "factory", "type": "app", "subtype": "factory", "offset": 0x20000, "size": 0x1E0000},
    {"name": "part0", "type": "0x40", "subtype": "0x1", "offset": 0x200000, "size": 0x100000},
]


def entry(label, typ, sub, off, size):
    return (b"\xaa\x50" + bytes([typ, sub]) + off.to_bytes(4, "little") + size.to_bytes(4, "little")
            + label.encode().ljust(16, b"\0") + (0).to_bytes(4, "little"))


NVS = ("nvs", 1, 2, 0x11000, 0x6000)
PHY = ("phy_init", 1, 1, 0x17000, 0x1000)
FACTORY = ("factory", 0, 0, 0x20000, 0x1E0000)
PART0 = ("part0", 0x40, 1, 0x200000, 0x100000)


def table(rows, end="md5"):
    body = b"".join(entry(*r) for r in rows)
    if end == "md5":
        body += b"\xeb\xeb" + b"\xff" * 14 + hashlib.md5(body).digest()
    elif end == "bad-md5":
        body += b"\xeb\xeb" + b"\xff" * 14 + hashlib.md5(body + b"x").digest()
    return body


def case(cid, why, blob, status, exact=None, pad=True):
    c = {"id": cid, "why": why, "table_hex": blob.hex(), "pad": pad, "status": status}
    if exact is not None:
        c["exact"] = exact
    return c


GOOD = [NVS, PHY, FACTORY, PART0]
junk = bytearray(table(GOOD).ljust(PAD_TO, b"\xff"))
junk[0x400] = 0x01
unterminated = b"".join(entry(f"x{i}", 1, 1, 0x300000 + i * 0x1000, 0x1000) for i in range(PAD_TO // 32))

CASES = [
    case("blank", "all 0xFF", b"", "blank"),
    case("no-data", "nothing was read", b"", "garbage", pad=False),
    case("exact-with-checksum", "the release layout with ESP-IDF's MD5 end entry", table(GOOD), "match", True),
    case("exact-without-checksum", "the release layout ending in 0xFF instead of a checksum entry", table(GOOD, "ff"), "match", True),
    case("bad-checksum", "MD5 entry does not match the entries", table(GOOD, "bad-md5"), "garbage"),
    case("duplicate-name", "two partitions called nvs", table([NVS, PHY, FACTORY, PART0, ("nvs", 1, 2, 0x300000, 0x1000)]), "garbage"),
    case("overlap", "an extra partition overlaps factory", table([NVS, PHY, FACTORY, PART0, ("extra", 1, 6, 0x100000, 0x1000)]), "garbage"),
    case("zero-size", "an extra partition of size 0", table([NVS, PHY, FACTORY, PART0, ("extra", 1, 6, 0x300000, 0)]), "garbage"),
    case("beyond-flash", "an extra partition ends past 16 MB", table([NVS, PHY, FACTORY, PART0, ("extra", 1, 6, 0xFF8000, 0x10000)]), "garbage"),
    case("inside-partition-table", "an extra partition starts at 0x1000, inside the bootloader/table area", table([("boot", 1, 6, 0x1000, 0x1000), NVS, PHY, FACTORY, PART0]), "garbage"),
    case("junk-after-end", "a stray byte after the end marker", bytes(junk), "garbage"),
    case("unterminated", "valid-looking entries up to the end of the read, no end marker", unterminated, "garbage"),
    case("not-a-table", "bytes that are not entries", bytes(range(256)) * 12, "garbage"),
    case("extra-partition", "protected partitions match, one more partition than the release", table([NVS, PHY, FACTORY, PART0, ("extra", 1, 6, 0x300000, 0x1000)]), "match", False),
    case("missing-factory", "protected partitions match, no app partition", table([NVS, PHY, PART0]), "match", False),
    case("factory-wrong-type", "factory is a data partition", table([NVS, PHY, ("factory", 1, 0, 0x20000, 0x1E0000), PART0]), "match", False),
    case("factory-smaller", "factory is 1 MB instead of 0x1E0000", table([NVS, PHY, ("factory", 0, 0, 0x20000, 0x100000), PART0]), "match", False),
    case("part0-moved", "credential partition at another offset", table([NVS, PHY, FACTORY, ("part0", 0x40, 1, 0x300000, 0x100000)]), "mismatch"),
    case("nvs-smaller", "nvs is 0x5000 instead of 0x6000", table([("nvs", 1, 2, 0x11000, 0x5000), PHY, FACTORY, PART0]), "mismatch"),
    case("part0-wrong-type", "part0 is a plain data partition", table([NVS, PHY, FACTORY, ("part0", 1, 1, 0x200000, 0x100000)]), "mismatch"),
    case("nvs-missing", "no nvs partition", table([PHY, FACTORY, PART0]), "mismatch"),
]

out = {"pad_to": PAD_TO, "flash_size": FLASH_SIZE, "layout": LAYOUT, "cases": CASES}
path = Path(__file__).with_name("partition_tables.json")
path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
print(f"wrote {len(CASES)} cases to {path}")
