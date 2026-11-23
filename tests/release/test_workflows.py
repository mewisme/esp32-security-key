"""Publishing invariants of .github/workflows: only release.yml -> release may write or publish; caches are never
restored for a tagged release and never written from anything but main."""
import json
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
# Mutating release commands and third-party release actions (`gh release view` in meta is read-only).
PUBLISHERS = re.compile(r"gh release (create|upload|edit|delete)|softprops|ncipollo")
CACHE_ACTIONS = ("actions/cache", "Swatinem/rust-cache")


def load(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    # PyYAML (YAML 1.1) reads the bare key `on` as True.
    if True in data:
        data["on"] = data.pop(True)
    return data


def steps_using(flow: dict, prefix: tuple):
    for job_id, job in flow["jobs"].items():
        for step in job.get("steps", []):
            if str(step.get("uses", "")).startswith(prefix):
                yield job_id, step


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

    def test_tag_builds_do_not_restore_caches(self):
        release = self.flows["release.yml"]
        found = []
        for job_id, step in steps_using({"jobs": {j: release["jobs"][j] for j in ("build", "firmware")}},
                                        CACHE_ACTIONS):
            found.append((job_id, step["uses"].split("@")[0]))
            self.assertIn("is_release != 'true'", str(step.get("if", "")), (job_id, step["uses"]))
        self.assertIn(("build", "Swatinem/rust-cache"), found)
        self.assertIn(("firmware", "actions/cache/restore"), found)
        self.assertIn(("firmware", "actions/cache/save"), found)

    def test_caches_saved_only_from_main(self):
        saves = rust = 0
        for name, wf in self.flows.items():
            for job_id, step in steps_using(wf, ("actions/cache/save",)):
                saves += 1
                self.assertIn("refs/heads/main", str(step.get("if", "")), (name, job_id))
            for job_id, step in steps_using(wf, ("Swatinem/rust-cache",)):
                rust += 1
                self.assertIn("refs/heads/main", str((step.get("with") or {}).get("save-if", "")), (name, job_id))
        self.assertGreaterEqual(saves, 2)  # ci.yml and release.yml firmware jobs
        self.assertGreaterEqual(rust, 2)  # ci.yml host and release.yml build

    def test_release_assets_cover_release_profiles(self):
        policy = json.loads((ROOT / "tools" / "flash_policy.json").read_text(encoding="utf-8"))
        release_profiles = [p["id"] for p in policy["profiles"] if p.get("release")]
        self.assertTrue(release_profiles)
        assemble = self.flows["release.yml"]["jobs"]["assemble"]
        expected = next(s["run"] for s in assemble["steps"] if "expected=" in str(s.get("run", "")))
        for hw in release_profiles:
            for image in ("fido", "openpgp"):
                self.assertIn(f"-{hw}-{image}-dev.zip", expected, (hw, image))
        matrix = self.flows["release.yml"]["jobs"]["firmware"]["strategy"]["matrix"]
        self.assertEqual(sorted(matrix["hw"]), sorted(release_profiles))
        self.assertEqual(sorted(matrix["app"]), ["fido", "openpgp"])
        # 3 host archives + firmware-manifest.json + one zip per image and release profile + SHA256SUMS
        release_job = self.flows["release.yml"]["jobs"]["release"]
        count = next(s["run"] for s in release_job["steps"] if "ls -1" in str(s.get("run", "")))
        self.assertIn(f"-eq {3 + 1 + 2 * len(release_profiles) + 1}", count)


if __name__ == "__main__":
    unittest.main()
