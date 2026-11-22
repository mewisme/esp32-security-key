#!/usr/bin/env python3
"""Apply patches/<submodule>/*.patch to the matching submodule working tree. Idempotent.

A patch that is already applied (reverse-applies cleanly) is skipped. A patch that neither applies nor
reverse-applies is an error: the pinned submodule SHA and the patch have diverged.

  python tools/apply_patches.py            # apply
  python tools/apply_patches.py --check    # exit 1 if any patch is not applied
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def git(repo: Path, *args: str) -> int:
    return subprocess.call(["git", "-C", str(repo), *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    rc = 0
    for sub in sorted(p for p in (ROOT / "patches").glob("*") if p.is_dir()):
        repo = ROOT / sub.name
        if not (repo / ".git").exists():
            print(f"missing submodule {sub.name}: run git submodule update --init", file=sys.stderr)
            return 2
        for patch in sorted(sub.glob("*.patch")):
            if git(repo, "apply", "--check", "-R", str(patch)) == 0:
                print(f"already applied: {sub.name}/{patch.name}")
            elif args.check:
                print(f"NOT applied: {sub.name}/{patch.name}", file=sys.stderr)
                rc = 1
            elif git(repo, "apply", "--check", str(patch)) == 0:
                git(repo, "apply", str(patch))
                print(f"applied: {sub.name}/{patch.name}")
            else:
                print(f"CONFLICT: {sub.name}/{patch.name} does not apply to the pinned submodule", file=sys.stderr)
                rc = 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
