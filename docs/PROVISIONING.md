# Provisioning

Everything here is manual. No script in this repository burns eFuses or enables Secure Boot (the development flashers `tools/flash-dev.ps1` and the web installer write only the bootloader, partition table and app, after a typed confirmation).
Commands that change hardware permanently are marked **[IRREVERSIBLE – operator confirms]**.

## 1. Development unit

```
cp <your pins> sdkconfig.board      # see docs/HARDWARE.md
python tools/build.py dev           # or --app openpgp
idf.py -B build-fido-dev -p COMx flash monitor   # or tools/flash-dev.ps1 (docs/FLASHING_ADVANCED.md)
```

State after this: eFuses untouched (patch 0002), secrets obfuscated only, JTAG/download open.
`python tools/provision_check.py --port COMx` reports the fuse state (read-only).

## 2. Production unit: decisions to make BEFORE anything is flashed

1. **Signing key.** Generate a Secure Boot v2 RSA-3072 key: `espsecure.py generate_signing_key --version 2 --scheme rsa3072 sb_key.pem`.
   Store it offline with at least two backups. If it is lost the board can never receive another signed image.
   `*.pem` is git-ignored; never commit it.
2. **Rehearse on a sacrificial board** (not your only board): the steps below cannot be undone.
3. **MKEK in eFuse (optional).** Setting `CONFIG_MULTIKEY_ALLOW_EFUSE_PROVISIONING=y` in `sdkconfig.board` makes the firmware
   burn a random master key at first boot **[IRREVERSIBLE – operator confirms]**. Without it, flash encryption is the only
   at-rest protection. Both KEY3 and KEY4 are used, so they must be free; flash encryption and Secure Boot digests use
   other key blocks.
4. **USB VID/PID.** The default `0x303A:0x4002` is a development placeholder. Do not distribute devices with it.

## 3. Build the hardened image (build only)

```
python tools/build.py prod --harden --release --board esp32s3-boot-button --signing-key sb_key.pem --i-understand-irreversible
```

Output directory `build-fido-prod-hardened/`. Verified to build with a throwaway key; never booted on hardware.

## 4. Flash and fuse (manual) **[IRREVERSIBLE – operator confirms]**

The hardened image makes the second-stage bootloader burn, on first boot of a blank chip: the Secure Boot v2 key digest,
the flash-encryption key (Release mode) and the associated read/write protections and JTAG disabling. Follow Espressif's
documentation for ESP32-S3 (Secure Boot v2, Flash Encryption Release mode) for the exact `esptool` commands for your
board; `idf.py -B ... build` prints the flash command for the bootloader, partition table and app.
This repository has not executed these steps, so no command line is given here that we have not run.

Do not interrupt power during the first boot.

## 5. Verify (read-only)

`python tools/provision_check.py --port COMx` classifies the unit as development, partially hardened or hardened using the
fuse fields it reads. Then run the smoke tests in `docs/TESTING.md` and file a report in `docs/hw-reports/`.

## Recovery and failure notes

- A blocked MKAUTH applet (PIN tries exhausted) cannot be reset by FIDO reset; on a development unit erase the key-storage
  partition (`esptool.py erase_region` for `part0`, offset `0x200000`, size `0x100000`). On a hardened unit the partition is
  encrypted and re-provisioning requires the secure download path.
- A hardened unit with a lost signing key or a wrongly flashed image can be permanently unusable.
- Pulling power while the key store is being written is handled by upstream's journalled flash driver; this has not been
  power-cut tested on hardware (see TESTING.md).
