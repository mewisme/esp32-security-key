"""install.sh and install.ps1 against a local fake release.

The installers are the consumers of the release contract in docs/RELEASES.md: asset names, one root directory per archive
and the SHA256SUMS file. Every test builds a release with the real tools/package_release.py around a throw-away binary,
serves it from 127.0.0.1 and runs the installer against it with every directory redirected into a temp dir, so nothing
outside the temp dir (home, PATH, /etc/pam.d) is read or changed. The lookup of the latest release goes to GitHub and is
not covered here."""
import hashlib
import http.server
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import package_release as pr  # noqa: E402

VERSION = "9.9.9"
TAG = f"v{VERSION}"
FAKE_LINUX_CLI = b"#!/bin/sh\necho 'multikey 9.9.9'\n"


class FakeRelease(unittest.TestCase):
    """A release directory (<tag>/<asset>) served over HTTP, plus helpers that build and break it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.work = Path(self.tmp.name)
        self.site = self.work / "site"
        self.release = self.site / TAG
        self.release.mkdir(parents=True)
        self.requests = []

        site, requests = self.site, self.requests

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(site), **kwargs)

            def log_request(self, code="-", size="-"):
                requests.append(self.path)

            def log_error(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

        self.install_dir = self.work / "bin"
        self.share_dir = self.work / "share"
        self.pam_dir = self.work / "pam"
        self.pam_conf_dir = self.work / "pam.d"
        self.pam_dir.mkdir()
        self.pam_conf_dir.mkdir()

    def add_archive(self, kind, os_name, binary):
        src = self.work / f"src-{kind}-{os_name}"
        src.mkdir()
        files = {}
        for role, name, data in (("binary", "binary", binary), ("license", "LICENSE", b"license text\n"),
                                 ("notices", "THIRD_PARTY_LICENSES.txt", b"notices\n"), ("readme", "README.txt", b"readme\n")):
            (src / name).write_bytes(data)
            files[role] = src / name
        return pr.build_archive(self.release, kind, VERSION, os_name, "x86_64", files, 1700000000)

    def write_sums(self, skip=()):
        lines = [f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n"
                 for p in sorted(self.release.iterdir()) if p.name != "SHA256SUMS" and p.name not in skip]
        (self.release / "SHA256SUMS").write_bytes("".join(lines).encode())

    def asked(self):
        return list(self.requests)

    def env(self):
        # PSModulePath: a parent PowerShell 7 session puts its own module directory into the variable, and Windows
        # PowerShell 5.1 started from it then cannot find Get-FileHash; each shell builds its default path without it.
        dropped = ("http_proxy", "https_proxy", "all_proxy", "xdg_data_home", "psmodulepath")
        env = {k: v for k, v in os.environ.items() if not k.startswith("MULTIKEY_") and k.lower() not in dropped}
        env.update(
            HOME=str(self.work / "home"), LOCALAPPDATA=str(self.work / "localappdata"), NO_PROXY="127.0.0.1", no_proxy="127.0.0.1",
            MULTIKEY_BASE_URL=self.base_url, MULTIKEY_INSTALL_DIR=str(self.install_dir), MULTIKEY_SHARE_DIR=str(self.share_dir),
            MULTIKEY_PAM_DIR=str(self.pam_dir), MULTIKEY_PAM_CONF_DIR=str(self.pam_conf_dir), MULTIKEY_NO_MODIFY_PATH="1")
        return env


def tamper(path):
    path.write_bytes(path.read_bytes() + b"x")


@unittest.skipUnless(sys.platform.startswith("linux") and platform.machine() in ("x86_64", "AMD64"),
                     "install.sh installs the Linux x86_64 builds")
@unittest.skipUnless(all(shutil.which(t) for t in ("sh", "curl", "tar", "install", "awk", "mktemp")), "needs the installer's tools")
class InstallSh(FakeRelease):
    def setUp(self):
        super().setUp()
        self.add_archive("cli", "linux", FAKE_LINUX_CLI)
        self.add_archive("pam", "linux", b"\x7fELF fake module")
        self.write_sums()

    def run_installer(self, *args):
        return subprocess.run(["sh", str(ROOT / "install.sh"), *args], env=self.env(), capture_output=True, text=True, timeout=120)

    def test_installs_the_verified_cli_and_nothing_else(self):
        r = self.run_installer("--version", VERSION)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        binary = self.install_dir / "multikey"
        self.assertTrue(os.access(binary, os.X_OK))
        shown = subprocess.run([str(binary), "--version"], capture_output=True, text=True).stdout.strip()
        self.assertEqual(shown, f"multikey {VERSION}")
        self.assertEqual(sorted(p.name for p in self.share_dir.iterdir()), ["LICENSE", "THIRD_PARTY_LICENSES.txt"])
        asked = self.asked()
        self.assertIn(f"/{TAG}/{pr.asset_name('cli', VERSION, 'linux', 'x86_64')}", asked)
        self.assertIn(f"/{TAG}/SHA256SUMS", asked)
        # The PAM module is opt-in: neither downloaded nor written without --pam.
        self.assertFalse([a for a in asked if "multikey-pam" in a])
        self.assertEqual(list(self.pam_dir.iterdir()), [])

    def test_refuses_an_archive_that_does_not_match_sha256sums(self):
        tamper(self.release / pr.asset_name("cli", VERSION, "linux", "x86_64"))
        r = self.run_installer("--version", VERSION)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("checksum verification failed", r.stderr)
        self.assertFalse((self.install_dir / "multikey").exists())

    def test_refuses_an_archive_that_sha256sums_does_not_list(self):
        self.write_sums(skip=(pr.asset_name("cli", VERSION, "linux", "x86_64"),))
        r = self.run_installer("--version", VERSION)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no entry", r.stderr)
        self.assertFalse((self.install_dir / "multikey").exists())

    def test_pam_module_is_installed_but_not_enabled(self):
        r = self.run_installer("--version", VERSION, "--pam")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        module = self.pam_dir / "pam_multikey.so"
        self.assertEqual(module.read_bytes(), b"\x7fELF fake module")
        self.assertEqual(stat.S_IMODE(module.stat().st_mode), 0o644)
        self.assertEqual([p.name for p in self.pam_dir.iterdir()], ["pam_multikey.so"], "no staging file may stay behind")
        self.assertEqual(list(self.pam_conf_dir.iterdir()), [], "the installer must not edit PAM service files")
        self.assertIn(f"/{TAG}/{pr.asset_name('pam', VERSION, 'linux', 'x86_64')}", self.asked())

    def test_uninstall_keeps_the_pam_module_while_a_service_file_uses_it(self):
        self.assertEqual(self.run_installer("--version", VERSION, "--pam").returncode, 0)
        service = self.pam_conf_dir / "multikey-test"
        service.write_text("auth sufficient pam_multikey.so timeout=20\n")
        r = self.run_installer("--uninstall", "--pam")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("multikey-test", r.stderr)
        # A refusal changes nothing: the module and the CLI are both still there.
        self.assertTrue((self.pam_dir / "pam_multikey.so").exists())
        self.assertTrue((self.install_dir / "multikey").exists())

        service.write_text("# auth sufficient pam_multikey.so\nauth required pam_deny.so\n")
        r = self.run_installer("--uninstall", "--pam")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertFalse((self.pam_dir / "pam_multikey.so").exists())
        self.assertFalse((self.install_dir / "multikey").exists())
        self.assertFalse(self.share_dir.exists(), "the notices go with the tool")

    def test_uninstall_without_pam_says_the_module_is_still_there(self):
        self.assertEqual(self.run_installer("--version", VERSION, "--pam").returncode, 0)
        r = self.run_installer("--uninstall")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertFalse((self.install_dir / "multikey").exists())
        self.assertTrue((self.pam_dir / "pam_multikey.so").exists())
        self.assertIn("--pam", r.stdout)

    def test_rejects_a_version_that_is_not_a_release_tag(self):
        for bad in ("foo", "1.2", "1.2.3/../x", "1.2.3;id"):
            with self.subTest(version=bad):
                r = self.run_installer("--version", bad)
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("invalid release tag", r.stderr)
        self.assertEqual(self.asked(), [])


def windows_payload():
    exe = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "tar.exe"
    return exe.read_bytes() if exe.is_file() else None


@unittest.skipUnless(sys.platform == "win32", "install.ps1 installs the Windows build")
class InstallPs1(FakeRelease):
    def setUp(self):
        super().setUp()
        self.shells = [s for s in ("powershell", "pwsh") if shutil.which(s)]
        self.payload = windows_payload()
        if not self.shells or self.payload is None:
            self.skipTest("needs PowerShell and System32\\tar.exe (a stand-in executable whose --version succeeds)")
        self.add_archive("cli", "windows", self.payload)
        self.write_sums()

    def run_installer(self, shell, *args):
        script = str(ROOT / "install.ps1").replace("'", "''")
        command = f"& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '{script}'))) {' '.join(args)}"
        return subprocess.run([shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
                              env=self.env(), capture_output=True, text=True, timeout=180)

    def test_installs_the_verified_exe_and_its_notices(self):
        for shell in self.shells:
            with self.subTest(shell=shell):
                shutil.rmtree(self.install_dir, ignore_errors=True)
                shutil.rmtree(self.share_dir, ignore_errors=True)
                del self.requests[:]
                r = self.run_installer(shell, "--version", VERSION)
                self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
                self.assertEqual((self.install_dir / "multikey.exe").read_bytes(), self.payload)
                self.assertEqual(sorted(p.name for p in self.share_dir.iterdir()), ["LICENSE", "THIRD_PARTY_LICENSES.txt"])
                self.assertIn(f"/{TAG}/{pr.asset_name('cli', VERSION, 'windows', 'x86_64')}", self.asked())
                self.assertIn(f"/{TAG}/SHA256SUMS", self.asked())

    def test_refuses_an_archive_that_does_not_match_sha256sums(self):
        tamper(self.release / pr.asset_name("cli", VERSION, "windows", "x86_64"))
        for shell in self.shells:
            with self.subTest(shell=shell):
                r = self.run_installer(shell, "--version", VERSION)
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("checksum verification failed", r.stdout + r.stderr)
                self.assertFalse((self.install_dir / "multikey.exe").exists())

    def test_uninstall_removes_the_exe_and_the_notices(self):
        shell = self.shells[0]
        self.assertEqual(self.run_installer(shell, "--version", VERSION).returncode, 0)
        r = self.run_installer(shell, "--uninstall")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertFalse(self.install_dir.exists())
        self.assertFalse(self.share_dir.exists())


if __name__ == "__main__":
    unittest.main()
