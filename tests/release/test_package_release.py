import hashlib
import io
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import gen_notices  # noqa: E402
import check_pe_imports as pe  # noqa: E402
import package_release as pr  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.files = {}
        for role, content in (("binary", b"\x7fELF-not-really"), ("license", b"AGPL"),
                              ("notices", b"notices"), ("readme", b"readme")):
            p = self.dir / f"src-{role}"
            p.write_bytes(content)
            self.files[role] = p

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, kind, os_name, out="out", epoch=1700000000, files=None, version="0.1.0"):
        return pr.build_archive(self.dir / out, kind, version, os_name, "x86_64", files or self.files, epoch)


class AssetNames(unittest.TestCase):
    def test_exact_names(self):
        self.assertEqual(pr.asset_name("cli", "0.1.0", "windows", "x86_64"), "multikey-v0.1.0-windows-x86_64.zip")
        self.assertEqual(pr.asset_name("cli", "0.1.0", "linux", "x86_64"), "multikey-v0.1.0-linux-x86_64.tar.gz")
        self.assertEqual(pr.asset_name("pam", "0.1.0", "linux", "x86_64"), "multikey-pam-v0.1.0-linux-x86_64.tar.gz")

    def test_pam_is_linux_only(self):
        with self.assertRaises(pr.PackageError):
            pr.asset_name("pam", "0.1.0", "windows", "x86_64")


class Archives(Base):
    def test_windows_zip_members_modes_and_mtime(self):
        p = self.build("cli", "windows")
        self.assertEqual(p.name, "multikey-v0.1.0-windows-x86_64.zip")
        with zipfile.ZipFile(p) as z:
            names = sorted(z.namelist())
            self.assertEqual(names, sorted(f"multikey-v0.1.0-windows-x86_64/{n}" for n in
                                           ("LICENSE", "README.txt", "THIRD_PARTY_LICENSES.txt", "multikey.exe")))
            for i in z.infolist():
                self.assertEqual(i.date_time[:3], (2023, 11, 14))

    def test_linux_tar_members_modes_and_owner(self):
        p = self.build("cli", "linux")
        with tarfile.open(p, "r:gz") as t:
            by = {m.name: m for m in t.getmembers() if not m.isdir()}
            root = "multikey-v0.1.0-linux-x86_64"
            self.assertEqual(set(by), {f"{root}/{n}" for n in ("LICENSE", "README.txt", "THIRD_PARTY_LICENSES.txt", "multikey")})
            self.assertEqual(by[f"{root}/multikey"].mode, 0o755)
            self.assertEqual(by[f"{root}/LICENSE"].mode, 0o644)
            for m in by.values():
                self.assertEqual((m.uid, m.gid, m.mtime), (0, 0, 1700000000))

    def test_pam_renames_library(self):
        p = self.build("pam", "linux")
        with tarfile.open(p, "r:gz") as t:
            names = {m.name for m in t.getmembers() if not m.isdir()}
        self.assertIn("multikey-pam-v0.1.0-linux-x86_64/pam_multikey.so", names)
        self.assertFalse(any("libpam" in n for n in names))
        with tarfile.open(p, "r:gz") as t:
            self.assertEqual(t.getmember("multikey-pam-v0.1.0-linux-x86_64/pam_multikey.so").mode, 0o644)

    def test_deterministic(self):
        for kind, os_name in (("cli", "windows"), ("cli", "linux"), ("pam", "linux")):
            a = self.build(kind, os_name, out="a")
            b = self.build(kind, os_name, out="b")
            self.assertEqual(hashlib.sha256(a.read_bytes()).hexdigest(), hashlib.sha256(b.read_bytes()).hexdigest(),
                             f"{kind}/{os_name}")

    def test_different_epoch_changes_bytes(self):
        a = self.build("cli", "linux", out="a", epoch=1)
        b = self.build("cli", "linux", out="b", epoch=2)
        self.assertNotEqual(a.read_bytes(), b.read_bytes())

    def test_missing_input_rejected(self):
        files = {**self.files, "binary": self.dir / "nope"}
        with self.assertRaises(pr.PackageError):
            self.build("cli", "linux", files=files)

    def test_bad_version_rejected(self):
        with self.assertRaises(pr.PackageError):
            self.build("cli", "linux", version="v0.1")

    def test_extra_member_is_detected(self):
        p = self.build("cli", "linux")
        raw = io.BytesIO()
        with tarfile.open(p, "r:gz") as src, tarfile.open(fileobj=raw, mode="w") as dst:
            for m in src.getmembers():
                dst.addfile(m, src.extractfile(m) if m.isfile() else None)
            extra = tarfile.TarInfo("multikey-v0.1.0-linux-x86_64/id_rsa.pem")
            extra.size = 1
            dst.addfile(extra, io.BytesIO(b"x"))
        bad = self.dir / "bad.tar.gz"
        import gzip
        bad.write_bytes(gzip.compress(raw.getvalue()))
        with self.assertRaises(pr.PackageError):
            pr.verify_archive(bad, "cli", "linux", "multikey-v0.1.0-linux-x86_64")

    def test_forbidden_name_pattern(self):
        for n in ("a.pem", "a.key", "debug.log", "fw.bin", "app.elf", "config.toml", "sdkconfig.defaults"):
            self.assertTrue(pr.FORBIDDEN.search(n), n)
        for n in ("multikey.exe", "pam_multikey.so", "LICENSE", "README.txt", "THIRD_PARTY_LICENSES.txt"):
            self.assertFalse(pr.FORBIDDEN.search(n), n)


class Notices(unittest.TestCase):
    def test_excludes_workspace_and_sorts(self):
        md = {"workspace_members": ["w 0.1.0 (path+file:///w)"],
              "packages": [
                  {"id": "w 0.1.0 (path+file:///w)", "name": "w", "version": "0.1.0", "license": "AGPL-3.0-or-later"},
                  {"id": "b", "name": "beta", "version": "1.0.0", "license": "MIT", "repository": "https://x/b"},
                  {"id": "a", "name": "Alpha", "version": "2.0.0", "license": "Apache-2.0 OR MIT"},
                  {"id": "c", "name": "weird", "version": "0.1.0", "license": None, "license_file": "COPYING"}]}
        text = gen_notices.render_notices(md)
        self.assertNotIn("w 0.1.0", text.split("(name, version, license, repository)")[1])
        self.assertLess(text.index("Alpha 2.0.0"), text.index("beta 1.0.0"))
        self.assertIn("license: see COPYING", text)
        self.assertIn("license: Apache-2.0 OR MIT", text)


class PeImports(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "win32", "needs a Windows PE file")
    def test_reads_imports_of_a_real_exe(self):
        names = [n.lower() for n in pe.imports(Path(sys.executable).read_bytes())]
        self.assertIn("kernel32.dll", names)

    def test_rejects_non_pe(self):
        with self.assertRaises(ValueError):
            pe.imports(b"not an exe at all")

    def test_default_pattern_flags_the_vc_runtime_only(self):
        import re
        for bad in ("VCRUNTIME140.dll", "MSVCP140.dll", "ucrtbase.dll", "api-ms-win-crt-runtime-l1-1-0.dll"):
            self.assertTrue(re.search(pe.DEFAULT_FORBID, bad, re.I), bad)
        for good in ("KERNEL32.dll", "WinSCard.dll", "api-ms-win-core-synch-l1-2-0.dll", "bcrypt.dll"):
            self.assertFalse(re.search(pe.DEFAULT_FORBID, good, re.I), good)


if __name__ == "__main__":
    unittest.main()
