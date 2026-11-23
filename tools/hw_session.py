#!/usr/bin/env python3
"""One interactive hardware test session for the MultiKeys key, meant to run in its own visible (elevated) window.

  tools\\run_hw_session.ps1                 # opens the elevated window for you and runs everything
  .\\.venv\\Scripts\\python tools\\hw_session.py [--phases A B C D] [--name "Mew Key Test 2"]

Phases (each one waits for Enter, or 's' + Enter to skip):
  A  no button needed   USB strings on the bus, MKAUTH name validation on the device, GetInfo/UV options
  B  rename flow        2 presses + 1 unplug/replug: rename -> re-enumerate -> replug -> restore default name
  C  FIDO touches       4 touches (UV discouraged/preferred), 16 s idle timeout check, cancel check
  D  more touches       credential survival (2 touches) and the stale-press test (1 timed touch)

Every moment you must act is announced with a big banner and a beep: "PRESS BOOT", "UNPLUG", "DO NOTHING".
Nothing is erased, no PIN is set, no reset, no eFuse. Results are summarised at the end and saved to hw-session.log.
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

try:
    import winsound
except ImportError:  # not Windows
    winsound = None

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
MK = str(ROOT / "host/target/debug/multikey.exe")
LOG = ROOT / "hw-session.log"
summary = []

if sys.platform == "win32":
    import os
    os.system("")  # enable ANSI colours in the console


def c(code, s):
    return f"\033[{code}m{s}\033[0m"


def log(s=""):
    with LOG.open("a", encoding="utf-8") as f:
        f.write(s + "\n")


def say(s="", colour=None):
    print(c(colour, s) if colour else s, flush=True)
    log(s)


def beep(n=1):
    if winsound:
        for _ in range(n):
            winsound.Beep(1200, 250)
            time.sleep(0.1)


def banner(text, colour="1;97;44"):
    bar = " " * 78
    print("\n" + c(colour, bar) + "\n" + c(colour, f"  {text:<74}") + "\n" + c(colour, bar), flush=True)
    log(f"\n##### {text}")
    beep(2)


def stream(label, cmd):
    """Run a test script, show its output live, beep on every line that asks for an action."""
    say(f"\n--- {label}: {' '.join(Path(x).name if '\\' in x else x for x in cmd)}", "36")
    p = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
                         encoding="utf-8", errors="replace")
    for line in p.stdout:
        line = line.rstrip("\n")
        if ">>>" in line:
            banner(line.replace(">>>", "").replace("<<<", "").strip(), "1;30;43")
        elif line.lstrip().startswith("PASS"):
            say(line, "32")
        elif line.lstrip().startswith("FAIL"):
            say(line, "1;31")
        elif "do NOT touch" in line or "do not touch" in line.lower():
            banner("DO NOTHING: do not touch the board for ~16 s", "1;97;41")
        else:
            say(line)
    rc = p.wait()
    summary.append((label, rc))
    say(f"--- {label}: exit code {rc} ({'OK' if rc == 0 else 'SOMETHING FAILED'})", "32" if rc == 0 else "1;31")
    return rc


def gate(title, detail):
    banner(f"PHASE {title}")
    say(detail)
    ans = input(c("1", "Press Enter to start this phase, or type s + Enter to skip: ")).strip().lower()
    return ans != "s"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--phases", nargs="+", default=list("ABCD"), choices=list("ABCD"))
    ap.add_argument("--name", default="Mew Key Test 2")
    ap.add_argument("--default-name", default="MultiKeys Security Key")
    args = ap.parse_args()
    LOG.write_text("", encoding="utf-8")
    say(c("1", "MultiKeys hardware session"))
    say("Keep this window in front. The board should be plugged in and running the firmware (not in download mode).")
    if not Path(MK).exists():
        sys.exit(f"missing {MK}: run `cd host && cargo build`")
    stream("device state", [MK, "device", "show"])

    if "A" in args.phases and gate("A: checks without any button press (about 30 s)",
                                   "Nothing to do for you. Just watch the PASS/FAIL lines."):
        stream("USB strings on the bus", [PY, "-u", "tools/usb_identity.py"])
        stream("MKAUTH name validation (device side)", [PY, "-u", "tools/mkauth_name_test.py"])
        stream("GetInfo and UV options", [PY, "-u", "tools/ctap_uv_test.py", "--only", "info", "raw", "--yes"])

    if "B" in args.phases and gate("B: rename flow (2 presses + 1 unplug/replug, about 2 minutes)",
                                   "You will be asked to: press BOOT once, UNPLUG/REPLUG the cable, press BOOT once more.\n"
                                   "Each prompt waits up to 2 minutes, there is no hurry."):
        stream("rename flow", [PY, "-u", "tools/name_flow_test.py", "--name", args.name, "--default", args.default_name])

    if "C" in args.phases and gate("C: FIDO touch test (4 touches, then a 16 s wait where you must NOT touch)",
                                   "Press BOOT only when the banner says PRESS BOOT. Each touch window is 15 s."):
        stream("FIDO UV/UP policy", [PY, "-u", "tools/ctap_uv_test.py", "--only", "nopin", "timeout", "cancel", "--yes"])

    if "D" in args.phases and gate("D: credential survival (2 touches) and stale-press test (1 timed touch)",
                                   "Survival: press BOOT at each PRESS BOOT banner.\n"
                                   "Stale press: when told, press BOOT once, then do NOTHING for ~16 s."):
        stream("credentials survive update + rename", [PY, "-u", "tools/ctap_survival.py", "verify", "--yes"])
        stream("stale press must not count", [PY, "-u", "tools/ctap_uv_test.py", "--only", "stale", "--yes"])

    banner("SUMMARY", "1;97;45")
    for label, rc in summary:
        say(f"  {'PASS' if rc == 0 else 'FAIL'}  {label}", "32" if rc == 0 else "1;31")
    say(f"\nFull log: {LOG}")
    input("\nPress Enter to close this window... ")
    return 0 if all(rc == 0 for _, rc in summary) else 1


if __name__ == "__main__":
    sys.exit(main())
