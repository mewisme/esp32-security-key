#!/usr/bin/env python3
"""Fail when a dependency reference is mutable. Checks, relative to the repository root:

  * .github/workflows/*.yml: every `uses:` of a remote action is `owner/repo[/path]@<40-hex SHA>`; every `container:` /
    `image:` carries an `@sha256:<64-hex>` digest; every `cargo build|test|clippy|run|install` has `--locked`;
    every `pip install` of a package is `==`-pinned (or reads a requirements file).
  * tools/requirements.txt: every line is `name==version` (no ranges, no options, no URLs).
  * CMake fetch references: `GIT_TAG` values in CMakeLists.txt, *.cmake and components/** and every `*_REF` variable in
    pico-keys-sdk/cmake/deps.cmake (as patched by patches/pico-keys-sdk) are 40-hex commit SHAs, never a tag,
    `main`, `master` or `HEAD`.
  * host/Cargo.lock exists.

  python tools/check_pins.py          # exit 1 and list every violation
  python tools/check_pins.py --root DIR   # check another tree (used by the self-test)

Run `python tools/apply_patches.py` first so that pico-keys-sdk/cmake/deps.cmake carries our pins.
"""
import argparse
import re
import sys
from pathlib import Path

SHA = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"@sha256:[0-9a-f]{64}$")
USES = re.compile(r"^\s*-?\s*uses:\s*(\S+)")
CONTAINER = re.compile(r"^\s*(?:container|image):\s*(\S+)\s*$")
CARGO = re.compile(r"\bcargo\s+(build|test|clippy|run|install|check)\b")
PIP = re.compile(r"\bpip3?\s+install\s+(.*)")
REQ_LINE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?==[A-Za-z0-9][A-Za-z0-9._+!-]*$")
GIT_TAG = re.compile(r"\bGIT_TAG\s+([^\s)]+)")
SDK_REF = re.compile(r'^\s*set\(\s*(PICOKEYS_\w*_REF)\s+"([^"]*)"')
SKIP_DIRS = {"node_modules", "managed_components", ".venv", "target", "third-party", ".git", "web"}


def strip_comment(line: str) -> str:
    return re.sub(r"\s+#.*$", "", line)


def check_workflows(root: Path, errs: list[str]) -> None:
    for wf in sorted((root / ".github" / "workflows").glob("*.y*ml")):
        for n, raw in enumerate(wf.read_text(encoding="utf-8").splitlines(), 1):
            where = f"{wf.relative_to(root).as_posix()}:{n}"
            line = strip_comment(raw)
            m = USES.match(line)
            if m:
                ref = m.group(1).strip("'\"")
                if ref.startswith("./"):
                    continue
                if ref.startswith("docker://"):
                    if not DIGEST.search(ref):
                        errs.append(f"{where}: docker action without @sha256 digest: {ref}")
                    continue
                if "@" not in ref or not SHA.fullmatch(ref.rsplit("@", 1)[1]):
                    errs.append(f"{where}: action not pinned to a 40-hex commit SHA: {ref}")
                elif "#" not in raw:
                    errs.append(f"{where}: pinned action needs a trailing '# vX.Y.Z' comment: {ref}")
            m = CONTAINER.match(line)
            if m and not DIGEST.search(m.group(1).strip("'\"")):
                errs.append(f"{where}: container image without @sha256 digest: {m.group(1)}")
            m = CARGO.search(line)
            if m and "--locked" not in line:
                errs.append(f"{where}: cargo {m.group(1)} without --locked")
            m = PIP.search(line)
            if m:
                args = m.group(1).split()
                pkgs = [a for a in args if not a.startswith("-")]
                if "-r" in args or "--requirement" in args:
                    continue
                for pkg in pkgs:
                    if "==" not in pkg:
                        errs.append(f"{where}: pip package not pinned with ==: {pkg}")


def check_requirements(root: Path, errs: list[str]) -> None:
    req = root / "tools" / "requirements.txt"
    if not req.exists():
        errs.append("tools/requirements.txt is missing")
        return
    for n, raw in enumerate(req.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if line and not line.startswith("#") and not REQ_LINE.match(line):
            errs.append(f"tools/requirements.txt:{n}: not an exact name==version pin: {line}")


def cmake_files(root: Path):
    for pattern in ("CMakeLists.txt", "components/**/CMakeLists.txt", "components/**/*.cmake", "*.cmake", "boards/**/*.cmake"):
        for p in root.glob(pattern):
            if not SKIP_DIRS & set(p.relative_to(root).parts):
                yield p


def check_cmake(root: Path, errs: list[str]) -> None:
    for p in sorted(set(cmake_files(root))):
        for n, raw in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            m = GIT_TAG.search(strip_comment(raw))
            if m and not SHA.fullmatch(m.group(1).strip("\"'")):
                errs.append(f"{p.relative_to(root).as_posix()}:{n}: GIT_TAG is not a 40-hex commit SHA: {m.group(1)}")
    deps = root / "pico-keys-sdk" / "cmake" / "deps.cmake"
    if not deps.exists():
        errs.append("pico-keys-sdk/cmake/deps.cmake not found: check out submodules and run tools/apply_patches.py")
        return
    seen = 0
    for n, raw in enumerate(deps.read_text(encoding="utf-8").splitlines(), 1):
        m = SDK_REF.match(raw)
        if m:
            seen += 1
            if not SHA.fullmatch(m.group(2)):
                errs.append(f"pico-keys-sdk/cmake/deps.cmake:{n}: {m.group(1)} is not a 40-hex commit SHA "
                            f"({m.group(2)!r}); run tools/apply_patches.py to apply patches/pico-keys-sdk/0006")
    if seen == 0:
        errs.append("pico-keys-sdk/cmake/deps.cmake: no *_REF variables found (file layout changed?)")


def check_cargo(root: Path, errs: list[str]) -> None:
    if not (root / "host" / "Cargo.lock").exists():
        errs.append("host/Cargo.lock is missing (it must be committed)")


def check(root: Path) -> list[str]:
    errs: list[str] = []
    check_workflows(root, errs)
    check_requirements(root, errs)
    check_cmake(root, errs)
    check_cargo(root, errs)
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    errs = check(ap.parse_args().root.resolve())
    for e in errs:
        print(f"UNPINNED: {e}", file=sys.stderr)
    if errs:
        return 1
    print("check_pins: all references are pinned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
