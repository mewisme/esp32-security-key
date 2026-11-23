#!/usr/bin/env python3
"""Verify that a finished DEVELOPMENT build contains no irreversible provisioning operations.

Read-only: inspects the generated sdkconfig and the linker map of an existing build. Never touches a device.

  python tools/check_no_irreversible.py fido-dev
  python tools/check_no_irreversible.py openpgp-dev

Checks
  1. The generated sdkconfig does not enable Secure Boot, flash encryption, eFuse provisioning or the CI pin override,
     and does not choose a release-mode / eFuse-burning bootloader option.
  2. In the linker map's cross-reference table, no object from this project (pico-keys-sdk, pico-fido,
     pico-openpgp, multikey_*) references an eFuse WRITE / burn API. References from ESP-IDF itself
     (bootloader_support flash_encrypt, efuse component) are listed for information: they are part of the IDF
     and only act when Secure Boot / flash encryption are enabled in sdkconfig (check 1).
Exit code 0 = clean, 1 = finding.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FORBIDDEN_CONFIG = [
    "CONFIG_SECURE_BOOT",
    "CONFIG_SECURE_BOOT_V2_ENABLED",
    "CONFIG_SECURE_FLASH_ENC_ENABLED",
    "CONFIG_SECURE_FLASH_ENCRYPTION_MODE_RELEASE",
    "CONFIG_SECURE_BOOT_FLASH_BOOTLOADER_DEFAULT",
    "CONFIG_SECURE_ENABLE_SECURE_ROM_DL_MODE",
    "CONFIG_SECURE_DISABLE_ROM_DL_MODE",
    "CONFIG_MULTIKEY_ALLOW_EFUSE_PROVISIONING",
    "CONFIG_MULTIKEY_ALLOW_UNSET_PINS_FOR_CI",
]
WRITE_API = re.compile(
    r"^esp_efuse_(write|batch_write|set_(key|keypurpose|digest|write|read|rom)|burn|disable|enable|"
    r"set_[a-z_]*protect)[a-z_0-9]*$"
)
PROJECT_OBJ = re.compile(r"(pico-keys-sdk|pico-fido|pico-openpgp|multikey_)")


def check_config(path: Path) -> list[str]:
    findings = []
    text = path.read_text(encoding="utf-8", errors="ignore")
    enabled = {m.group(1) for m in re.finditer(r"^(CONFIG_[A-Z0-9_]+)=y\s*$", text, re.M)}
    for opt in FORBIDDEN_CONFIG:
        if opt in enabled:
            findings.append(f"sdkconfig enables {opt}")
    return findings


def parse_cref(map_path: Path):
    """Yield (symbol, [objects]) from the GNU ld cross reference table."""
    lines = map_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.startswith("Cross Reference Table")), None)
    if start is None:
        raise SystemExit("map file has no cross reference table (was it linked with -Wl,--cref?)")
    sym, objs = None, []
    for ln in lines[start + 1:]:
        if not ln.strip():
            continue
        if not ln.startswith(" "):
            if sym:
                yield sym, objs
            parts = ln.split(None, 1)
            if len(parts) < 2:
                sym, objs = None, []
                continue
            sym, objs = parts[0], [parts[1].strip()]
        elif sym:
            objs.append(ln.strip())
    if sym:
        yield sym, objs


def main() -> int:
    if len(sys.argv) != 2 or "-" not in sys.argv[1]:
        print(__doc__)
        return 2
    tag = sys.argv[1]
    app = tag.split("-")[0]
    cfg = ROOT / f"sdkconfig.{tag}.generated"
    map_path = ROOT / f"build-{tag}" / f"multikey-{app}.map"
    for p in (cfg, map_path):
        if not p.is_file():
            print(f"missing {p}: build first (python tools/build.py ...)", file=sys.stderr)
            return 2

    findings = check_config(cfg)
    idf_refs = []
    for sym, objs in parse_cref(map_path):
        if not WRITE_API.match(sym):
            continue
        for obj in objs[1:]:  # objs[0] is the defining object
            if PROJECT_OBJ.search(obj):
                findings.append(f"project object references {sym}: {obj}")
            elif "flash_encrypt" in obj or "secure_boot" in obj or "esp_efuse" in obj or "efuse" in obj:
                idf_refs.append((sym, obj))

    print(f"checked {cfg.name} and {map_path.name}")
    if idf_refs:
        print("info: ESP-IDF-internal references to eFuse write APIs (inactive unless Secure Boot / flash")
        print("      encryption are enabled in sdkconfig, which was checked above):")
        for sym, obj in sorted(set(idf_refs))[:12]:
            print(f"  {sym} <- {obj}")
    if findings:
        for f in findings:
            print("FINDING:", f)
        return 1
    print("PASS: no irreversible provisioning option enabled, no project code references eFuse write APIs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
