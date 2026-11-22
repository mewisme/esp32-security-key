#!/usr/bin/env python3
"""Build one firmware image (app x profile) into its own build directory.

This script only builds. It never flashes, never touches eFuses and never enables Secure Boot.
Requires an activated ESP-IDF v5.5.x environment (idf.py on PATH).

  python tools/build.py dev                       # FIDO2 image, dev profile, needs sdkconfig.board
  python tools/build.py prod --app openpgp
  python tools/build.py dev --ci-pins             # compile check without pins; image is unusable
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("profile", choices=["dev", "prod"])
    ap.add_argument("--app", choices=["fido", "openpgp"], default="fido")
    ap.add_argument("--ci-pins", action="store_true",
                    help="allow unset GPIOs (compile check only; never flash the result)")
    ap.add_argument("--clean", action="store_true", help="remove the build directory first")
    args = ap.parse_args()

    idf = shutil.which("idf.py")
    if not idf:
        print("idf.py not found: activate ESP-IDF v5.5.x first (export.ps1 / export.sh)", file=sys.stderr)
        return 2

    rc = subprocess.call([sys.executable, str(ROOT / "tools" / "apply_patches.py")])
    if rc:
        return rc

    tag = f"{args.app}-{args.profile}"
    build_dir = ROOT / f"build-{tag}"
    sdkconfig = ROOT / f"sdkconfig.{tag}.generated"
    if args.clean and build_dir.exists():
        shutil.rmtree(build_dir)

    defaults = ["sdkconfig.defaults", f"sdkconfig.{args.profile}"]
    if args.ci_pins:
        ci = ROOT / f"build-{tag}-ci-pins.defaults"
        ci.write_text("CONFIG_MULTIKEY_ALLOW_UNSET_PINS_FOR_CI=y\n")
        defaults.append(ci.name)
    elif (ROOT / "sdkconfig.board").exists():
        defaults.append("sdkconfig.board")

    env = os.environ.copy()
    if "IDF_PATH" in env:
        # Upstream CMake interpolates $ENV{IDF_PATH} into strings; backslashes break CMake parsing.
        env["IDF_PATH"] = env["IDF_PATH"].replace("\\", "/")
    env["SDKCONFIG_DEFAULTS"] = ";".join(defaults)
    common = [idf, "-B", build_dir.as_posix(), f"-DSDKCONFIG={sdkconfig.as_posix()}",
              f"-DMULTIKEY_PROFILE={args.profile}", f"-DMULTIKEY_APP={args.app}"]
    steps = [common + ["build"]]
    if not (build_dir / "CMakeCache.txt").exists():
        steps.insert(0, common + ["set-target", "esp32s3"])
    for step in steps:
        print("+", " ".join(step), flush=True)
        rc = subprocess.call(step, cwd=ROOT, env=env)
        if rc:
            return rc
    return 0


if __name__ == "__main__":
    sys.exit(main())
