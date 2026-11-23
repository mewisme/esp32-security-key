# Hardware profiles (4, 8 and 16 MB flash)

A **hardware profile** is one supported flash size of the ESP32-S3. It is defined once, in `tools/flash_policy.json`
(`schema_version` 2), and read by `tools/flash_dev.py`, `tools/build.py`, `tools/package_firmware.py` and the web installer
(`web/src/lib/firmware/policy.ts`). Nothing else decides which flash sizes exist.

| Profile id | Flash | Header mode / frequency | Interface | PSRAM required | Board file | Verification | In a release |
|---|---|---|---|---|---|---|---|
| `esp32s3-16mb` (default) | 16 MB | dio / 80m | quad | no | `boards/esp32s3-boot-button.board` | **Hardware verified**, ESP32-S3 N16R8, one board | yes |
| `esp32s3-8mb` | 8 MB | dio / 80m | quad | no | `boards/esp32s3-boot-button.board` | **Build verified, not hardware tested** | yes |
| `esp32s3-4mb` | 4 MB | dio / 80m | quad | no | `boards/esp32s3-boot-button.board` | **Build verified, not hardware tested** | yes |

Profile fields: `id`, `label`, `flash_size`, `flash_mode` (what the image header says), `config_flash_mode` (the sdkconfig
choice, `qio`), `flash_freq`, `flash_interface` (`quad`), `psram_required` (`false`), `board`, `verification`
(`hardware-verified` | `build-verified`), `verified_hardware` (`[{label, chip_feature}]`, empty for 4/8 MB) and `release`
(`true`: the release workflow must publish a FIDO2 build for it). `legacy_builds` maps the schema-1 build ids of v0.2.0
(`esp32s3-n16r8-fido-dev`, `esp32s3-n16r8-openpgp-dev`) to `esp32s3-16mb`.

Nothing here claims a 4 MB or 8 MB board was ever run. Those profiles are built, packaged and checked
(headers, layout, partition table); the first person to flash one is the first test.

## One partition table for every size

`partitions.csv` ends at `0x300000` (`part0` = `0x200000` + 1 MiB), below 4 MiB, so the same table fits all three flash
sizes. The pico-keys file system takes its size from the `part0` partition, not from the chip's flash size
(`pico-keys-sdk/src/fs/low_flash.c`, `FLASH_SIZE_BYTES = part0->size` in the `ESP_PLATFORM` branch), so the credential store has
the same size and offset on every profile. Consequences:

- `layout_id` (`mk16-...`) and `partition_schema` are the same for all profiles. The `mk16-` prefix is historical (the layout was
  first defined on a 16 MB board); it is kept so a v0.2.0 install and a new 16 MB build compare as the same layout.
- An update never moves `nvs`, `phy_init` or `part0`.
- A 2 MB flash cannot hold the layout (it ends at 3 MiB); it is unsupported, not a fourth profile.

`tests/flash/test_policy_profiles.py` asserts that every partition of `partitions.csv` ends inside every profile's flash size.

## What distinguishes the builds

Only the flash size and the image headers differ. `tools/build.py dev --hw <profile>` writes `build-<tag>-flash.defaults`
(`CONFIG_ESPTOOLPY_FLASHSIZE_<N>MB=y`, the other sizes unset, `CONFIG_ESPTOOLPY_FLASHMODE_QIO=y`) and layers it right after
`sdkconfig.<profile>`; each profile builds in its own directory and generated sdkconfig:

| Profile | Build directory | Generated sdkconfig |
|---|---|---|
| `esp32s3-16mb` | `build-fido-dev` | `sdkconfig.fido-dev.generated` |
| `esp32s3-8mb` | `build-fido-dev-8mb` | `sdkconfig.fido-dev-8mb.generated` |
| `esp32s3-4mb` | `build-fido-dev-4mb` | `sdkconfig.fido-dev-4mb.generated` |

`build.py` refuses (exit 2) a generated sdkconfig that selects another flash size (rerun with `--clean`) and, after a build,
checks that the sdkconfig and `flasher_args.json` say the profile's size (exit 1 otherwise).

### Image header bytes

An esp image starts `E9 <segments> <mode> <size|frequency>`: byte 2 is the flash mode (qio 0, qout 1, dio 2, dout 3), byte 3
holds the flash size in its high nibble (4 MB = 2, 8 MB = 3, 16 MB = 4) and the frequency in its low nibble (80 MHz = `F`).
`flash_dev.check_image_header` compares these with the profile, and `package_firmware.py package` runs it on the bootloader and the
app. Observed on the three local builds of this commit (`0.2.0-dev`):

| Profile | `bootloader.bin` first bytes | `multikey-fido.bin` first bytes |
|---|---|---|
| 4 MB | `e9 03 02 2f` | `e9 06 02 2f` |
| 8 MB | `e9 03 02 3f` | `e9 06 02 3f` |
| 16 MB | `e9 03 02 4f` | `e9 06 02 4f` |

The headers say `dio` while the sdkconfig selects QIO: `flasher_args.json` reports `flash_mode dio`, and the generated sdkconfig has
`CONFIG_ESPTOOLPY_FLASHMODE_QIO=y` together with `CONFIG_ESPTOOLPY_FLASHMODE="dio"` (ESP-IDF stamps `dio` into the headers and its
bootloader enables QIO at run time). `flash_mode` in the policy is the header value, `config_flash_mode` the sdkconfig choice.

## PSRAM is not used

`sdkconfig.defaults` has `# CONFIG_SPIRAM is not set`, and a search of `components/`, `pico-keys-sdk/src`, `pico-fido/src` and
`pico-openpgp/src` for `heap_caps`, `MALLOC_CAP_SPIRAM`, `EXT_RAM` and `esp_psram` finds nothing. The N16R8 runs the firmware with
PSRAM disabled, so a board without PSRAM (N4, N8, N16) has everything the firmware needs. `psram_required` is `false` for every
profile; the web installer prints the PSRAM it reads (`8 MB, not used` / `None — not required`) and does not act on it.

## Quad versus octal flash

Only quad-SPI flash is supported. Modules with octal flash (ESP32-S3-WROOM-2, e.g. N16R8V, N32R8V) use eight data lines and a
different flash configuration from the one built here, so they are refused. The web installer reads this electronically: on an ESP32-S3,
`EFUSE_RD_REPEAT_DATA3_REG` (`0x6000703C`) bit 9 is `FLASH_TYPE` (1 = eight data lines); esptool's own `flash_type()` reads the
same bit (`targets/esp32s3.py`). A set bit is `unsupported-flash-mode`; a register that cannot be read leaves the type unknown and
the decision to the flash size. This is a read-only register read.

## Choosing the build for a board

The web installer never picks a build by binary size. `selectProfile` (`web/src/lib/compatibility/profiles.ts`) takes the chip
and flash size esptool reports and applies, in order: chip must be ESP32-S3; flash must not be octal; flash size must be known;
a profile must exist for exactly that size (else `wrong-flash-size`, which lists 4MB, 8MB, 16MB); the release must contain a
build for that profile and image (else `profile-not-in-release`). The support level then follows from the build's `verification`
and the profile's `verified_hardware`: a `chip_feature` string is matched as a prefix of esptool's chip features
(`Embedded PSRAM 8MB` matches `Embedded PSRAM 8MB (AP_3v3)`, which the tested N16R8 reports). A hardware-verified 16 MB build on a
board without that feature is **expected compatible**; everything else is **build verified**. Any level other than hardware
verified adds the `untested-hardware` acknowledgement to the install.

`tools/flash_dev.py` is stricter still: `check_flash_id` requires the chip's flash size to equal the chosen profile's size
(`flash-dev.ps1 -Hw esp32s3-4mb|esp32s3-8mb|esp32s3-16mb`, default 16 MB) before anything is written.

## Adding a profile

1. Add an entry to `profiles` in `tools/flash_policy.json` (and `SIZE_CODES` in `tools/flash_dev.py` if it is a new size).
2. `python -m unittest discover tests/flash` (partition fit, invariants) and `tests/release`.
3. Add the profile to `matrix.ts` and `HARDWARE.md` if it changes what is supported; `release.yml` builds every profile in the
   `firmware` matrix and `--require-release-profiles` fails the release when a `release: true` profile has no build.
