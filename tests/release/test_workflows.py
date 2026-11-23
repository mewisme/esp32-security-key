"""Publishing invariants of .github/workflows: only release.yml -> release may write or publish."""
import re
import unittest
from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
# Mutating release commands and third-party release actions (`gh release view` in meta is read-only).
PUBLISHERS = re.compile(r"gh release (create|upload|edit|delete)|softprops|ncipollo")


def load(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    # PyYAML (YAML 1.1) reads the bare key `on` as True.
    if True in data:
        data["on"] = data.pop(True)
    return data


class Workflows(unittest.TestCase):
    def setUp(self):
        self.flows = {p.name: load(p) for p in sorted(WORKFLOWS.glob("*.yml"))}
        self.assertIn("release.yml", self.flows)

    def test_only_release_job_can_write_contents(self):
        writers = []
        for name, wf in self.flows.items():
            top = wf.get("permissions") or {}
            self.assertNotEqual(top if isinstance(top, str) else top.get("contents"), "write", name)
            self.assertNotEqual(top, "write-all", name)
            for job_id, job in wf["jobs"].items():
                perms = job.get("permissions") or {}
                if perms == "write-all" or (isinstance(perms, dict) and perms.get("contents") == "write"):
                    writers.append((name, job_id))
        self.assertEqual(writers, [("release.yml", "release")])

    def test_publishing_commands_only_in_release_job(self):
        hits = []
        for name, wf in self.flows.items():
            for job_id, job in wf["jobs"].items():
                text = yaml.safe_dump(job)
                if PUBLISHERS.search(text):
                    hits.append((name, job_id))
        self.assertEqual(hits, [("release.yml", "release")])

    def test_release_runs_behind_assemble_and_tag_gate(self):
        jobs = self.flows["release.yml"]["jobs"]
        self.assertIn("assemble", jobs["release"]["needs"])
        self.assertTrue({"build", "firmware"} <= set(jobs["assemble"]["needs"]))
        self.assertIn("is_release == 'true'", jobs["release"]["if"])

    def test_no_pull_request_target(self):
        for name, wf in self.flows.items():
            on = wf["on"]
            keys = on if isinstance(on, (list, str)) else on.keys()
            self.assertNotIn("pull_request_target", keys, name)


if __name__ == "__main__":
    unittest.main()
