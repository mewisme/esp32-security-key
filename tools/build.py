#!/usr/bin/env python3
"""Build one firmware image (app x profile) into its own build directory.

This script only builds. It never flashes, never touches eFuses and never enables Secure Boot.
Requires an activated ESP-IDF v5.5.x environment (idf.py on PATH).

  python tools/build.py dev                       # FIDO2 image, dev profile, 16 MB flash, needs sdkconfig.board
  python tools/build.py prod --board esp32s3-boot-button   # prod/release/hardened builds never use the implicit sdkconfig.board
  python tools/build.py dev --hw esp32s3-4mb --board esp32s3-boot-button --clean   # 4 MB flash profile
  python tools/build.py prod --app openpgp
  python tools/build.py dev --ci-pins             # compile check without pins; image is unusable
  python tools/build.py dev --release --board esp32s3-boot-button   # version without the -dev suffix (release packaging)
  python tools/build.py prod --harden --release --board B --signing-key K.pem --i-understand-irreversible

Every (app, security profile, hardware profile) gets its own build-<tag>/ directory and sdkconfig.<tag>.generated: the
tag is e.g. fido-dev for the default 16 MB profile and fido-dev-4mb / fido-dev-8mb for the others (flash_dev.build_tag).
The hardware profile (--hw, tools/flash_policy.json) selects the flash size; the built image is checked against it.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import flash_dev as fd  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("profile", choices=["dev", "prod"])
    ap.add_argument("--app", choices=["fido", "openpgp"], default="fido")
    ap.add_argument("--hw", choices=sorted(fd.PROFILES), default=fd.DEFAULT_PROFILE,
                    help="hardware profile (flash size); each profile builds into its own directory")
    ap.add_argument("--board", metavar="NAME",
                    help="layer boards/NAME.board (button, LED) instead of the root sdkconfig.board")
    ap.add_argument("--ci-pins", action="store_true",
                    help="allow unset GPIOs (compile check only; never flash the result)")
    ap.add_argument("--clean", action="store_true",
                    help="remove the build directory and its generated sdkconfig first")
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
    if args.release and not args.board:
        print("--release requires --board NAME (a release image never takes the implicit root sdkconfig.board)",
              file=sys.stderr)
        return 2
    if args.harden and args.ci_pins:
        print("--harden cannot be combined with --ci-pins (a hardened image with unset pins is unusable and burns eFuses)",
              file=sys.stderr)
        return 2
    if args.harden and not (args.release and args.board):
        print("--harden requires --release and --board NAME", file=sys.stderr)
        return 2
    if args.profile == "prod" and not (args.board or args.ci_pins):
        print("prod needs --board NAME (real pins) or --ci-pins (compile check); the implicit sdkconfig.board is dev only",
              file=sys.stderr)
        return 2
    if args.board and args.ci_pins:
        print("--board cannot be combined with --ci-pins", file=sys.stderr)
        return 2
    if args.board and not (ROOT / "boards" / f"{args.board}.board").is_file():
        print(f"unknown board {args.board} (boards/{args.board}.board missing)", file=sys.stderr)
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

    tag = fd.build_tag(args.app, args.profile, args.hw, args.harden)
    build_dir = ROOT / f"build-{tag}"
    sdkconfig = ROOT / f"sdkconfig.{tag}.generated"
    if args.clean:
        if build_dir.exists():
            shutil.rmtree(build_dir)
        sdkconfig.unlink(missing_ok=True)

    size_line = f"CONFIG_ESPTOOLPY_FLASHSIZE_{fd.profile(args.hw)['flash_size']}=y"
    if sdkconfig.exists() and size_line not in sdkconfig.read_text(encoding="utf-8").splitlines():
        print(f"{sdkconfig.name} was generated for another flash size; rerun with --clean", file=sys.stderr)
        return 2

    flash_defaults = ROOT / f"build-{tag}-flash.defaults"
    flash_defaults.write_text(fd.flash_fragment(args.hw))
    defaults = ["sdkconfig.defaults", f"sdkconfig.{args.profile}", flash_defaults.name]
    if args.profile == "prod":
        defaults.append("sdkconfig.release-hardening")
    if args.harden:
        defaults.append("sdkconfig.hardening")
        key = ROOT / f"build-{tag}-signing.defaults"
        key.write_text(f'CONFIG_SECURE_BOOT_SIGNING_KEY="{Path(args.signing_key).resolve().as_posix()}"\n')
        defaults.append(key.name)
    if args.ci_pins:
        ci = ROOT / f"build-{tag}-ci-pins.defaults"
        ci.write_text("CONFIG_MULTIKEY_ALLOW_UNSET_PINS_FOR_CI=y\n")
        defaults.append(ci.name)
    elif args.board:
        defaults.append(f"boards/{args.board}.board")
    elif args.profile == "dev" and (ROOT / "sdkconfig.board").exists():
        # Implicit local board file: development builds only (never prod, release or hardened images).
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
    # The image must really be for the selected flash size (a stale or hand-edited configuration would not be).
    if size_line not in sdkconfig.read_text(encoding="utf-8").splitlines():
        print(f"{sdkconfig.name} does not select {size_line}; rerun with --clean", file=sys.stderr)
        return 1
    try:
        built = json.loads((build_dir / "flasher_args.json").read_text(encoding="utf-8"))["flash_settings"]["flash_size"]
    except (OSError, ValueError, KeyError) as e:
        print(f"cannot read the flash size from {build_dir.name}/flasher_args.json: {e}", file=sys.stderr)
        return 1
    want = fd.profile(args.hw)["flash_size"]
    if built != want:
        print(f"{build_dir.name} was built for {built} flash, profile {args.hw} needs {want}; rerun with --clean",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
