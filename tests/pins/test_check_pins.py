"""tools/check_pins.py: the real tree is pinned, and each kind of mutable reference is rejected."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import check_pins  # noqa: E402

SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1"
DIGEST = "sha256:" + "a" * 64
DEPS_OK = "".join(f'set(PICOKEYS_{n}_REF "{SHA}") # v1\n' for n in ("A", "B"))


def make_tree(root: Path, workflow="", requirements="fido2==2.2.1\n", deps=DEPS_OK, cmake="", lock=True) -> None:
    (root / ".github" / "workflows").mkdir(parents=True)
    (root / ".github" / "workflows" / "w.yml").write_text(workflow, encoding="utf-8")
    (root / "tools").mkdir()
    (root / "tools" / "requirements.txt").write_text(requirements, encoding="utf-8")
    (root / "pico-keys-sdk" / "cmake").mkdir(parents=True)
    (root / "pico-keys-sdk" / "cmake" / "deps.cmake").write_text(deps, encoding="utf-8")
    (root / "CMakeLists.txt").write_text(cmake, encoding="utf-8")
    (root / "host").mkdir()
    if lock:
        (root / "host" / "Cargo.lock").write_text("", encoding="utf-8")


class CheckPins(unittest.TestCase):
    def errors(self, **kw):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        make_tree(tmp, **kw)
        return check_pins.check(tmp)

    def test_real_tree_is_pinned(self):
        self.assertEqual(check_pins.check(ROOT), [])

    def test_clean_fixture_passes(self):
        wf = (f"jobs:\n  a:\n    container: espressif/idf:v5@{DIGEST}\n    steps:\n"
              f"      - uses: actions/checkout@{SHA} # v7\n      - run: cargo test --locked\n"
              "      - run: pip install pyyaml==6.0.2\n")
        self.assertEqual(self.errors(workflow=wf), [])

    def test_action_tag_rejected(self):
        self.assertEqual(len(self.errors(workflow="      - uses: actions/checkout@v4\n")), 1)

    def test_action_branch_rejected(self):
        self.assertEqual(len(self.errors(workflow="      - uses: owner/repo@main\n")), 1)

    def test_action_sha_without_version_comment_rejected(self):
        self.assertEqual(len(self.errors(workflow=f"      - uses: actions/checkout@{SHA}\n")), 1)

    def test_container_without_digest_rejected(self):
        self.assertEqual(len(self.errors(workflow="    container: espressif/idf:v5.5.6\n")), 1)

    def test_cargo_without_locked_rejected(self):
        self.assertEqual(len(self.errors(workflow="      - run: cargo build --release\n")), 1)

    def test_unpinned_pip_rejected(self):
        self.assertEqual(len(self.errors(workflow="      - run: pip install pyyaml\n")), 1)

    def test_requirements_ranges_rejected(self):
        self.assertEqual(len(self.errors(requirements="fido2>=2.0,<3\nesptool==5.6.0\n-e .\n")), 2)

    def test_sdk_branch_or_tag_ref_rejected(self):
        deps = f'set(PICOKEYS_A_REF "main")\nset(PICOKEYS_B_REF "v1.2.0")\nset(PICOKEYS_C_REF "{SHA}")\n'
        self.assertEqual(len(self.errors(deps=deps)), 2)

    def test_cmake_git_tag_rejected(self):
        self.assertEqual(len(self.errors(cmake="FetchContent_Declare(x GIT_REPOSITORY u GIT_TAG master)\n")), 1)
        self.assertEqual(self.errors(cmake=f"FetchContent_Declare(x GIT_REPOSITORY u GIT_TAG {SHA})\n"), [])

    def test_missing_cargo_lock_rejected(self):
        self.assertEqual(len(self.errors(lock=False)), 1)


if __name__ == "__main__":
    unittest.main()
