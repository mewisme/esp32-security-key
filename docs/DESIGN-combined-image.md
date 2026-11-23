# Design: one MultiKeys image with FIDO2 and OpenPGP/PIV

Status: **Blocked, not implemented.** The decision of [ADR-0002](ADR-0002-separate-images.md) stands: two images, `fido`
and `openpgp`. This page records what was investigated for the request to combine them, the exact blockers, and the design
that would unblock it. No combined image was built, flashed or released.

## What was checked (2026-11-23)

The two application components were built from the pinned sources (`MULTIKEY_APP=fido`, `MULTIKEY_APP=openpgp`, dev
profile, 16 MB) and the global symbols each one defines were compared with `xtensa-esp32s3-elf-nm --defined-only -g` on
the objects of `__idf_fido` and `__idf_openpgp` (215 and 178 symbols). Linking both into one ELF fails on these **11
duplicate definitions**:

| Symbol | Where it comes from | Why it matters |
|---|---|---|
| `man_aid`, `man_get_config`, `cap_supported`, `is_gpg` | each tree's `management.c` | Both register an applet on the same AID `A000000527471117` (YubiKey management), each answering with its own version and capability bitmap (`cap_supported` reads `EF_DEV_CONF`). `is_gpg` is a mode flag: the OpenPGP select sets it, the management select clears it, and `cmd_get_data.c` changes its behaviour with it. One applet must own the capability bitmap of the whole device and the flag must become per-applet state. |
| `file_entries`, `file_last`, `MF` | each tree's `files.c` | Each app defines the complete file table of the card (`MF` at `0x3F00` and every EF below it). A merged image needs one table, with the two ID ranges proven disjoint (FIDO uses `0xCC00`, `0xCE00`-`0xCE03`, resident-credential and OATH/OTP ranges; OpenPGP uses `0x1081`-`0x10C3`, DO ranges and the PIV ranges). |
| `cmd_version` | `cmd_version.c` of each tree | Same name, different applet commands. Harmless once the applets are separate objects with their own dispatch tables, but it is a link error today. |
| `PICO_PRODUCT`, `PICO_VERSION_MAJOR`, `PICO_VERSION_MINOR` | each tree's `defs.c` / `version.h` | The USB product string and the reported firmware version come from the app. One value has to be chosen. |

Not a link error but a design conflict: both apps wrap stored objects with a `file_object_crypto_provider_t` built in
their own `object_provider.c` (`static` there, so they link). They agree on one thing, the record's `key_domain`:
the FIDO provider accepts `key_domain == 0`, the OpenPGP provider accepts `0` for OpenPGP objects and `1` for PIV. Two
providers that both claim domain `0` over the same flash partition (`part0`) would each try to decrypt the other's records.
Their roots also differ: FIDO derives its root from the device key and the FIDO PIN state, OpenPGP loads a data
encryption key (`load_dek`) that the user PIN unwraps.

Also different today:

- MKAUTH (`multikey_auth`, vendor commands on CCID, BUILD_INFO, device name) is compiled only into the fido image
  (`CMakeLists.txt`, `list(APPEND COMPONENTS ... multikey_auth)`).
- The USB composition differs: `fido` = HID + CCID + WebUSB/WCID, `openpgp` = CCID + WCID (no HID).
- The flash policy, the web installer and the packaged zips describe each image by its `project_name`; the web installer
  decides "switch image" from it ([FLASHING_ADVANCED.md](FLASHING_ADVANCED.md)).

## Why not merge now

Linking both would need edits inside security-critical upstream code (management applet, file table, key-wrapping
roots), without upstream review and without a hardware test bed. A silently wrong merge would show up as unreadable
credentials or keys rather than as a build error. That is the kind of change that must not be made by renaming symbols
until the link succeeds.

## Proposed design

1. **One MultiKeys management applet** (new component `multikey_management`, replaces both `management.c`): it owns
   `man_aid`, the capability bitmap (`CAP_FIDO2 | CAP_U2F | CAP_OPENPGP | CAP_PIV` as compiled in) and the `is_gpg`
   mode flag becomes per-applet state. Both trees' `management.c` are excluded from the build by a patch to the
   source lists, not edited.
2. **One file table.** Generate `file_entries` from both trees' tables at build time and fail the build if any `fid`
   appears twice. Reserve ranges in a table checked into `docs/` and enforced by a unit test.
3. **Separate key domains.** Give OpenPGP/PIV and FIDO distinct `key_domain` values (FIDO 0, OpenPGP 2, PIV 3, plus the
   existing OATH/OTP domains) with a one-time, explicit, offline-tested migration of the existing FIDO records,
   because today FIDO records on devices in the field carry domain 0 and the OpenPGP provider also accepts 0.
4. **Two roots, never shared.** The FIDO root stays derived as today; the OpenPGP DEK stays unwrapped by the OpenPGP PIN.
   No code path derives one from the other. Resetting one application must not touch the other's records
   (`authenticatorReset` and OpenPGP `TERMINATE DF`/factory reset operate on their own domain only).
5. **USB composite descriptor**: HID + CCID + WCID, one BOS, one product string; CCID exposes the applets FIDO
   (OATH/OTP/MKAUTH), management, OpenPGP and PIV. Check the descriptor with `tools/check_usb_descriptors.py` and the
   Windows driver matrix (WinUSB for WCID, the built-in CCID driver).
6. **Packaging.** A third image `combined` with its own `project_name` (`multikey-combined`). `install-mode.ts` already
   treats a different `project_name` as "switch image". A switch between `fido`/`openpgp` and `combined` stays a
   typed confirmation. No automatic migration between images, ever: the migration tool is opt-in, offline, and
   exports before it imports.
7. **Release gate.** The combined image ships only as Experimental and build-verified until every item below passes on
   real hardware.

## What would have to be verified (none of it has been run)

| Check | How |
|---|---|
| Linking with no duplicate symbols | Rebuild and repeat the `nm` comparison above on the merged component set |
| File IDs disjoint | Unit test over the generated table |
| FIDO regression | `tools/ctap_smoke.py`, `tools/ctap_up_test.py`, `tools/ctap_survival.py` on the combined image (credential survives reboot and is not readable through OpenPGP) |
| OpenPGP regression | `tools/gpg_smoke.sh --destructive ...` and `tools/piv_smoke.sh --destructive ...` on the combined image, then FIDO again (reset of one app leaves the other's data) |
| Migration | Image `fido` with credentials, flash `combined`, credentials still usable; opposite direction refused without export |
| USB | `tools/check_usb_descriptors.py --live`, Windows and Linux enumeration, `gpg --card-status` and a passkey on one device at once |
| Flash and RAM | App size within the `factory` partition (`0x1E0000`); heap headroom with both applets loaded |

## Status in this repository

| Item | Status |
|---|---|
| Separate `openpgp` image (OpenPGP + PIV) | Build verified (4/8/16 MB), Experimental, not Hardware verified |
| Combined image | Blocked: 11 duplicate global definitions, two management applets, overlapping key domains |
| This design | Documented, not reviewed upstream |
