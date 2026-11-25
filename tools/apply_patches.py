#!/usr/bin/env python3
"""Apply patches/<submodule>/*.patch (in filename order) to the matching submodule working tree. Idempotent.

Patches are STACKED: a later patch may touch the same lines as an earlier one, so "already applied" cannot be
decided per patch against the final tree. The tool finds how many patches are applied (largest m such that
patch m reverse-applies, and patches m..1 then reverse-apply in turn on a scratch copy of the touched files)
and applies the remaining ones in order. A submodule that matches neither state is an error: the pinned
submodule SHA and the patch set have diverged.

  python tools/apply_patches.py            # apply
  python tools/apply_patches.py --check    # exit 1 if any patch is not applied
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def git(repo: Path, *args: str) -> int:
    return subprocess.call(["git", "-C", str(repo), *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def out(repo: Path, *args: str) -> str | None:
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def pinned_sha(name: str) -> str | None:
    """The commit recorded for submodule `name` in the superproject's HEAD (gitlink)."""
    line = out(ROOT, "ls-tree", "HEAD", name)
    return line.split()[2] if line and len(line.split()) >= 3 and line.split()[1] == "commit" else None


def touched_files(patches: list[Path]) -> list[str]:
    files: list[str] = []
    for p in patches:
        for m in re.finditer(r"^diff --git a/(\S+) b/", p.read_text(encoding="utf-8"), re.M):
            if m.group(1) not in files:
                files.append(m.group(1))
    return files


def applied_count(repo: Path, patches: list[Path]) -> int | None:
    """Number of leading patches that are applied in `repo`, or None if the tree is inconsistent."""
    with tempfile.TemporaryDirectory() as tmp:
        scratch = Path(tmp)
        for rel in touched_files(patches):
            src = repo / rel
            if src.exists():
                (scratch / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, scratch / rel)
        top = 0
        for k in range(len(patches), 0, -1):
            if git(scratch, "apply", "-R", "--check", str(patches[k - 1])) == 0:
                top = k
                break
        for k in range(top, 0, -1):
            if git(scratch, "apply", "-R", str(patches[k - 1])) != 0:
                return None
        return top


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
        pinned, head = pinned_sha(sub.name), out(repo, "rev-parse", "HEAD")
        if pinned is None or head != pinned:
            print(f"CONFLICT: {sub.name} HEAD {head} is not the commit recorded in the superproject ({pinned}); "
                  f"run git submodule update --init {sub.name}", file=sys.stderr)
            rc = 1
            continue
        patches = sorted(sub.glob("*.patch"))
        done = applied_count(repo, patches)
        if done is None:
            print(f"CONFLICT: {sub.name}: patch stack is partially applied or modified by hand", file=sys.stderr)
            rc = 1
            continue
        for patch in patches[:done]:
            print(f"already applied: {sub.name}/{patch.name}")
        for patch in patches[done:]:
            if args.check:
                print(f"NOT applied: {sub.name}/{patch.name}", file=sys.stderr)
                rc = 1
            elif git(repo, "apply", "--check", str(patch)) == 0:
                if git(repo, "apply", str(patch)) != 0:
                    print(f"CONFLICT: {sub.name}/{patch.name} failed to apply", file=sys.stderr)
                    rc = 1
                    break
                print(f"applied: {sub.name}/{patch.name}")
            else:
                print(f"CONFLICT: {sub.name}/{patch.name} does not apply to the pinned submodule", file=sys.stderr)
                rc = 1
                break
    return rc


if __name__ == "__main__":
    sys.exit(main())
