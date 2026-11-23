"""Hardware-free checks of tools/gpg_smoke.*, tools/piv_smoke.sh and tools/fake_pinentry.py.

The scripts' card-facing steps need a MultiKeys openpgp board and cannot run in CI; what runs here is everything that does
not: argument guards, the parsing of saved `gpg --card-status` / `yubico-piv-tool -a status` text, and the Assuan answers of
the fake pinentry (which may only ever produce factory PINs).
"""
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
TOOLS = ROOT / "tools"
FIX = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import fake_pinentry  # noqa: E402

SH = shutil.which("sh")
POWERSHELL = shutil.which("pwsh") or shutil.which("powershell")


def sh(script, *args):
    return subprocess.run([SH, str(TOOLS / script), *args], capture_output=True, text=True, timeout=60)


@unittest.skipUnless(SH, "needs a POSIX sh")
class ShellScripts(unittest.TestCase):
    def test_gpg_card_status_parsing(self):
        for name, code in [("ok", 0), ("no_reset_code", 0), ("keys", 0), ("blocked", 1), ("not_openpgp", 1)]:
            with self.subTest(name):
                r = sh("gpg_smoke.sh", "--parse-only", str(FIX / f"card_status_{name}.txt"))
                self.assertEqual(r.returncode, code, r.stdout)

    def test_gpg_blocked_and_foreign_cards_are_named(self):
        self.assertIn("blocked", sh("gpg_smoke.sh", "--parse-only", str(FIX / "card_status_blocked.txt")).stdout)
        self.assertIn("not an OpenPGP card", sh("gpg_smoke.sh", "--parse-only", str(FIX / "card_status_not_openpgp.txt")).stdout)

    def test_piv_status_parsing(self):
        for name, code in [("ok", 0), ("blocked", 1), ("no_ccc", 1)]:
            with self.subTest(name):
                r = sh("piv_smoke.sh", "--parse-only", str(FIX / f"piv_status_{name}.txt"))
                self.assertEqual(r.returncode, code, r.stdout)

    def test_destructive_mode_needs_both_flags(self):
        for script, confirm in [("gpg_smoke.sh", "--i-understand-this-resets-the-card"),
                                ("piv_smoke.sh", "--i-understand-this-changes-the-card")]:
            with self.subTest(script):
                self.assertEqual(sh(script, "--destructive").returncode, 2)
                self.assertEqual(sh(script, confirm).returncode, 2)
                self.assertEqual(sh(script, "--bogus").returncode, 2)

    def test_help_exits_zero_and_mentions_the_flags(self):
        self.assertIn("--destructive", sh("gpg_smoke.sh", "--help").stdout)
        self.assertEqual(sh("gpg_smoke.sh", "--help").returncode, 0)
        self.assertIn("--destructive", sh("piv_smoke.sh", "--help").stdout)
        self.assertEqual(sh("piv_smoke.sh", "--help").returncode, 0)


@unittest.skipUnless(POWERSHELL, "needs PowerShell")
class PowerShellScript(unittest.TestCase):
    def run_ps(self, *args):
        env = {k: v for k, v in os.environ.items() if k != "PSModulePath"}  # Windows PowerShell 5.1 inherits PS7 module dirs
        return subprocess.run([POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(TOOLS / "gpg_smoke.ps1"), *args],
                              capture_output=True, text=True, timeout=120, env=env)

    def test_parsing_matches_the_shell_script(self):
        for name, code in [("ok", 0), ("no_reset_code", 0), ("blocked", 1), ("not_openpgp", 1)]:
            with self.subTest(name):
                self.assertEqual(self.run_ps("-ParseOnly", str(FIX / f"card_status_{name}.txt")).returncode, code)

    def test_destructive_needs_both_switches(self):
        self.assertEqual(self.run_ps("-Destructive").returncode, 2)
        self.assertEqual(self.run_ps("-IUnderstandThisResetsTheCard").returncode, 2)


class FakePinentry(unittest.TestCase):
    def session(self, lines, wrong=False):
        state, out = {}, []
        for line in lines:
            reply = fake_pinentry.handle(line, state, wrong)
            if reply is None:
                break
            out.extend(reply)
        return out

    def test_answers_only_factory_pins(self):
        user = self.session(["SETDESC Please%20enter%20the%20PIN", "GETPIN"])
        admin = self.session(["SETDESC Please%20enter%20the%20Admin%20PIN", "GETPIN"])
        self.assertEqual(user, ["OK", "D 123456", "OK"])
        self.assertEqual(admin, ["OK", "D 12345678", "OK"])

    def test_wrong_mode_never_sends_a_real_pin(self):
        self.assertEqual(self.session(["SETDESC PIN", "GETPIN"], wrong=True)[-2], "D 000000")
        self.assertEqual(self.session(["SETDESC Admin%20PIN", "GETPIN"], wrong=True)[-2], "D 00000000")

    def test_unknown_commands_are_acknowledged_and_bye_ends(self):
        self.assertEqual(self.session(["OPTION ttyname=/dev/null", "CONFIRM", "BYE", "GETPIN"]), ["OK", "OK"])

    def test_process_speaks_assuan_over_stdin_stdout(self):
        r = subprocess.run([sys.executable, str(TOOLS / "fake_pinentry.py")], input="SETDESC Admin%20PIN\nGETPIN\nBYE\n",
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.stdout.splitlines(), ["OK Pleased to meet you", "OK", "D 12345678", "OK", "OK closing connection"])


if __name__ == "__main__":
    unittest.main()
