"""The shared partition-table vectors (tests/vectors/partition_tables.json), judged by tools/flash_dev.py.
web/tests/unit/partition-table.test.ts runs the same file against the TypeScript parser."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import flash_dev as fd  # noqa: E402

VECTORS = json.loads((ROOT / "tests" / "vectors" / "partition_tables.json").read_text(encoding="utf-8"))
PARTS = {p["name"]: {k: p[k] for k in ("type", "subtype", "offset", "size")} for p in VECTORS["layout"]}


class SharedVectors(unittest.TestCase):
    def test_every_case(self):
        for c in VECTORS["cases"]:
            with self.subTest(c["id"]):
                blob = bytes.fromhex(c["table_hex"])
                if c["pad"]:
                    blob = blob.ljust(VECTORS["pad_to"], b"\xff")
                status, detail, exact, layout = fd.judge_device_table(blob, PARTS, VECTORS["flash_size"])
                self.assertEqual(status, c["status"], f"{c['why']}: {detail}")
                if "exact" in c:
                    self.assertEqual(exact, c["exact"], f"{c['why']}: {layout}")
                    self.assertEqual(layout is None, c["exact"])

    def test_layout_matches_the_repo_csv(self):
        csv = fd.parse_partitions_csv((ROOT / "partitions.csv").read_text())
        self.assertEqual(csv, PARTS)


if __name__ == "__main__":
    unittest.main()
