"""Compile and run the host test of the LED feedback state machine (needs gcc/cc and applied patches)."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HEADER = HERE.parent.parent / "pico-keys-sdk" / "src" / "led" / "led_status.h"
CC = shutil.which("gcc") or shutil.which("cc")


class LedStatusTest(unittest.TestCase):
    @unittest.skipUnless(HEADER.exists(), "apply patches first: python tools/apply_patches.py")
    @unittest.skipUnless(CC, "no C compiler")
    def test_state_machine(self):
        with tempfile.TemporaryDirectory() as tmp:
            exe = Path(tmp) / "led_status_test.exe"
            subprocess.run([CC, "-std=c11", "-Wall", "-Wextra", "-Werror", "-Wswitch-enum",
                            str(HERE / "led_status_test.c"), "-o", str(exe)], check=True)
            run = subprocess.run([str(exe)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == "__main__":
    unittest.main()
