#!/usr/bin/env python3
"""Build one firmware image (app x profile) into its own build directory.

This script only builds. It never flashes, never touches eFuses and never enables Secure Boot.
Requires an activated ESP-IDF v5.5.x environment (idf.py on PATH).

  python tools/build.py dev                       # FIDO2 image, dev profile, needs sdkconfig.board
  python tools/build.py prod --app openpgp
  python tools/build.py dev --ci-pins             # compile check without pins; image is unusable
  python tools/build.py dev --release             # firmware version without the -dev suffix (release packaging)
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
    ap.add_argument("--release", action="store_true",
                    help="stamp the plain host/Cargo.toml version (no -dev suffix) into the app descriptor")
    ap.add_argument("--harden", action="store_true",
                    help="prod only: apply sdkconfig.hardening (Secure Boot v2 + flash encryption). BUILD ONLY.")
    ap.add_argument("--signing-key", help="Secure Boot v2 RSA-3072 PEM key (with --harden)")
    ap.add_argument("--i-understand-irreversible", action="store_true",
                    help="acknowledge that a hardened image burns eFuses when booted on a blank chip")
    args = ap.parse_args()

    idf = shutil.which("idf.py")
    if not idf:
        print("idf.py not found: activate ESP-IDF v5.5.x first (export.ps1 / export.sh)", file=sys.stderr)
        return 2

    rc = subprocess.call([sys.executable, str(ROOT / "tools" / "apply_patches.py")])
    if rc:
        return rc

    if args.release and args.ci_pins:
        print("--release cannot be combined with --ci-pins", file=sys.stderr)
        return 2
    if args.harden:
        if args.profile != "prod":
            print("--harden is only valid with the prod profile", file=sys.stderr)
            return 2
        if not args.i_understand_irreversible or not args.signing_key:
            print("--harden needs --signing-key PATH and --i-understand-irreversible "
                  "(read docs/PROVISIONING.md: the resulting image burns eFuses when booted on a blank chip)",
                  file=sys.stderr)
            return 2
        if not Path(args.signing_key).is_file():
            print(f"signing key not found: {args.signing_key}", file=sys.stderr)
            return 2

    tag = f"{args.app}-{args.profile}" + ("-hardened" if args.harden else "")
    build_dir = ROOT / f"build-{tag}"
    sdkconfig = ROOT / f"sdkconfig.{tag}.generated"
    if args.clean and build_dir.exists():
        shutil.rmtree(build_dir)

    defaults = ["sdkconfig.defaults", f"sdkconfig.{args.profile}"]
    if args.harden:
        defaults.append("sdkconfig.hardening")
        key = ROOT / f"build-{tag}-signing.defaults"
        key.write_text(f'CONFIG_SECURE_BOOT_SIGNING_KEY="{Path(args.signing_key).resolve().as_posix()}"\n')
        defaults.append(key.name)
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
              f"-DMULTIKEY_PROFILE={args.profile}", f"-DMULTIKEY_APP={args.app}",
              f"-DMULTIKEY_RELEASE_BUILD={1 if args.release else 0}"]
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
