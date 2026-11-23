# Releases

One GitHub Release per version carries **both** the host tools and, from v0.2.0, prebuilt development firmware plus a
machine-readable firmware manifest. From v0.3.0 the release carries one firmware zip per flash size (4, 8 and 16 MB,
[HARDWARE_PROFILES](HARDWARE_PROFILES.md)); v0.2.0 has a single 16 MB firmware and v0.1.0 contained host tools only.

The published firmware is the FIDO2 development image for ESP32-S3 boards with 4, 8 or 16 MB quad flash, with the BOOT button
(GPIO0) as the touch button and no LED (`boards/esp32s3-boot-button.board`). Only the 16 MB build is hardware verified (one
N16R8 board); the 4 and 8 MB builds are build verified. It uses the development USB VID:PID `303A:4002` and the
development AAGUID ([USB_IDENTITY](USB_IDENTITY.md)); publishing it requires the maintainer's explicit acceptance of that. The
OpenPGP image and other boards are built from source ([FLASHING_ADVANCED](FLASHING_ADVANCED.md)).

## Assets (a release with firmware for every flash size)

Eight files: three host archives, three firmware zips (one per hardware profile), the manifest and `SHA256SUMS`.

| File | Contents |
|---|---|
| `multikey-vX.Y.Z-windows-x86_64.zip` | `multikey.exe` (static CRT), `LICENSE`, `THIRD_PARTY_LICENSES.txt`, `README.txt` |
| `multikey-vX.Y.Z-linux-x86_64.tar.gz` | `multikey`, same companions; built on Ubuntu 22.04 |
| `multikey-pam-vX.Y.Z-linux-x86_64.tar.gz` | `pam_multikey.so` (built as `libpam_multikey.so`, renamed), same companions |
| `multikey-firmware-vX.Y.Z-esp32s3-16mb-fido-dev.zip` | `bootloader.bin`, `partition-table.bin`, `multikey-fido.bin`, `firmware.json`, `SHA256SUMS`, `LICENSE`, `NOTICE.txt`, `README.txt` (16 MB flash; the hardware-verified profile) |
| `multikey-firmware-vX.Y.Z-esp32s3-8mb-fido-dev.zip` | the same members for 8 MB flash (build verified, not hardware tested) |
| `multikey-firmware-vX.Y.Z-esp32s3-4mb-fido-dev.zip` | the same members for 4 MB flash (build verified, not hardware tested) |
| `firmware-manifest.json` | one entry per firmware build: profile, offsets, sizes and SHA-256 of each image and of the zip, partition layout, USB identity, data-compatibility range |
| `SHA256SUMS` | SHA-256 of the seven files above |

v0.2.0, published before the flash-size profiles, has six files: a single firmware zip named
`multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev.zip` (the 16 MB build) and a schema-1 manifest. The web installer and its Worker keep
accepting that name (`n16r8`) and treat it as the 16 MB profile.

Each archive has one root directory and exactly the listed members (asserted at packaging time). Archives are deterministic:
sorted entries, `SOURCE_DATE_EPOCH` = the commit's time, zero owner ids.

### Firmware manifest (`schema_version` 2)

Written by `tools/package_firmware.py manifest`, validated again by the web installer (`web/src/lib/firmware/manifest.ts`).
Top level: `schema` (`multikeys-firmware-manifest`), `schema_version` (2), `version`, `tag`, `source_commit`, `repository`,
`builds[]`, sorted by `id` (`<profile>-<image>-dev`, e.g. `esp32s3-4mb-fido-dev`). Each build: `id`, `image`, `project_name`,
`version`, `title`, `board` (`esp32s3-boot-button`), `chip`, `profile_id`, `flash_size`, `flash_mode`, `flash_freq`,
`flash_interface` (`quad`), `psram_required` (`false`), `security_profile` (`development`), `idf_version`, `user_presence`,
`led`, `usb {vid, pid, webusb_landing_url, product_name, custom_name}` (the firmware's default USB name and whether renaming is
compiled in), `package {name, size, sha256}`, `images[] {role, file, offset, size, sha256}`, `partitions[]` (all rows of
`partitions.csv`), `layout_id`, `partition_schema` (the same value as `layout_id`), `protected_partitions`, `repurpose_fill`,
`update.data_preserving_from`, `install_modes`, `verified_hardware` (labels), `verification` (`hardware-verified` |
`build-verified`). `firmware.json` inside the zip is the same build entry without `package`.

The validator checks every build against the profile in `tools/flash_policy.json` (`chip`, `flash_size`, `flash_mode`,
`flash_freq`, `flash_interface`, `psram_required`), requires the package name `multikey-firmware-v<version>-<profile id>-<image>-dev.zip`
and rejects two builds of one image for one profile. `usb.product_name` must be a name the key accepts (1-31 printable ASCII,
no leading/trailing space).

**Schema 1** (v0.2.0) is still accepted through an explicit mapping: the build id must be one of `legacy_builds`
(`esp32s3-n16r8-fido-dev`, `esp32s3-n16r8-openpgp-dev`), the flash size `16MB`, the board `esp32s3-n16r8-boot-button` and the asset
name the `n16r8` one; it is then treated as profile `esp32s3-16mb` (`flash_interface` quad, no PSRAM requirement,
`partition_schema` = `layout_id`, no verified hardware, `usb.product_name` `MultiKeys Security Key`, `verification` kept only if it
says `hardware-verified`, else `build-verified`) and marked `legacy` (the installer does not try to rename a key flashed from a
legacy build). `firmware.json` inside a legacy zip is still compared with the entry as it was published.

`update.data_preserving_from` (0.2.0 for now) is the oldest installed version whose stored data this firmware declares it can
use; the web installer treats anything else as an unverified update and asks for an acknowledgement.

## Install script

`install.ps1` (Windows) and `install.sh` (Linux) in the repository root install the host tool from a release. The short URLs
`https://get.mewis.me/esp32-security-key.ps1` and `https://get.mewis.me/esp32-security-key.sh` serve them.

```powershell
irm https://get.mewis.me/esp32-security-key.ps1 | iex
& ([scriptblock]::Create((irm https://get.mewis.me/esp32-security-key.ps1))) --version v0.2.0
& ([scriptblock]::Create((irm https://get.mewis.me/esp32-security-key.ps1))) --uninstall
```
```sh
curl -fsSL https://get.mewis.me/esp32-security-key.sh | sh
curl -fsSL https://get.mewis.me/esp32-security-key.sh | sh -s -- --pam         # also pam_multikey.so (needs root)
curl -fsSL https://get.mewis.me/esp32-security-key.sh | sh -s -- --uninstall   # with --pam: the module too
```

Both take GitHub's *latest* release (pre-releases are skipped; `--version` or `MULTIKEY_VERSION` pins one, 0.1.0 and later),
download its `SHA256SUMS` and the archive for the platform (table above), refuse to install when the archive is not listed or its
SHA-256 differs, copy `multikey` and the notices, and run `multikey --version`. The checksum has the limit stated under *Verify a
download*. They never talk to the key, flash anything or write the trust store.

| | Windows | Linux |
|---|---|---|
| Program | `%LOCALAPPDATA%\Programs\MultiKeys\bin\multikey.exe`, added to the user PATH (`--no-modify-path` skips it; uninstall removes the entry only if the installer added it) | `~/.local/bin/multikey` (`/usr/local/bin` as root); a hint when that is not on PATH |
| `LICENSE`, `THIRD_PARTY_LICENSES.txt` | `%LOCALAPPDATA%\Programs\MultiKeys\share` | `~/.local/share/multikey` (`/usr/local/share/multikey` as root) |
| Needs | Windows x64, Windows PowerShell 5.1 or PowerShell 7 | x86_64, glibc 2.35 or newer (built on Ubuntu 22.04), `curl`, `tar`, `install` |

`--pam` (Linux only) also installs `pam_multikey.so` into the directory that holds `pam_unix.so` (`/lib/x86_64-linux-gnu/security` on
Debian and Ubuntu), through `sudo` when that directory is not writable. The file is staged in that directory and renamed, so replacing a
module that is in use is one step. **The module is not enabled**: `/etc/pam.d` is only read, to decide an uninstall, and never written
([LINUX_PAM](LINUX_PAM.md)). `--uninstall --pam` refuses, and removes nothing, while a service file there still names the module,
because a PAM line without its module can break logins. The trust store (`/etc/multikey/trusted.toml`,
`%ProgramData%\MultiKeys\trusted.toml`) is never removed.

Environment variables: `MULTIKEY_VERSION`, `MULTIKEY_INSTALL_DIR`, `MULTIKEY_SHARE_DIR`, `MULTIKEY_BASE_URL` (download base, default
`https://github.com/mewisme/esp32-security-key/releases/download`; the scripts read `<base>/<tag>/<asset>`), `MULTIKEY_NO_MODIFY_PATH`
(Windows), `MULTIKEY_PAM_DIR` and `MULTIKEY_PAM_CONF_DIR` (Linux; the default is `/etc/pam.d`). `sh -s -- --help` prints the Linux options.

`tests/release/test_install_scripts.py` runs both scripts against a fake release built by `tools/package_release.py` (checksum refusal,
the opt-in PAM module, the uninstall guard); the shell tests need Linux, the PowerShell tests Windows. Outside the suite the scripts were
run against the published v0.1.0, v0.2.0 and v0.3.0 assets on Windows 11 (Windows PowerShell 5.1 and PowerShell 7, PATH entry added and
removed) and on Ubuntu 24.04 in WSL (root and normal user; the `sudo` path through a stub, not a password prompt). Not run: macOS (refused),
other distributions, ARM.

## Verify a download

```powershell
Get-FileHash -Algorithm SHA256 .\multikey-v0.2.0-windows-x86_64.zip   # compare with SHA256SUMS
```
```sh
sha256sum -c SHA256SUMS --ignore-missing
unzip multikey-firmware-v0.3.0-esp32s3-4mb-fido-dev.zip && (cd multikey-firmware-v0.3.0-esp32s3-4mb-fido-dev && sha256sum -c SHA256SUMS)
```

No signature is published; the checksum file and the manifest live next to the assets in the same release and therefore
protect against corruption, not against a compromised repository or release.

## Cutting a release

1. Bump `[workspace.package].version` in `host/Cargo.toml` (all crates and the firmware share it), update `host/Cargo.lock`
   (`cargo build --locked` must pass).
2. Add `docs/releases/vX.Y.Z.md` (the release notes; the workflow refuses a tag without it).
3. Commit and push to `main`. The `release` workflow runs on `main` (build, package and verify everything, **no publishing**);
   wait for it to be green (and `ci` and `web`). `gh workflow run release.yml --ref main` runs it on demand. Its `release-bundle`
   artifact (kept 14 days) holds the assets a tag would publish.
4. `git tag -a vX.Y.Z -m "MultiKeys X.Y.Z"` on that exact commit and `git push origin vX.Y.Z`. **Only with the maintainer's explicit
   approval.** The tag push is what publishes.
5. Verify the published release: `gh release download vX.Y.Z -D build-rel`, `sha256sum -c SHA256SUMS`, and
   `python tools/package_firmware.py verify build-rel/multikey-firmware-vX.Y.Z-*.zip --manifest build-rel/firmware-manifest.json`.
   The web installer's Worker lists a new release by itself (`releases.atom`, cached for 5 minutes); it needs no redeploy.

A `-suffix` in the version (`0.3.0-rc.1`) publishes a pre-release.

## What the workflow checks (`.github/workflows/release.yml`)

| Job | Gate |
|---|---|
| `meta` | release script tests (packaging, firmware packaging, workflow invariants); all five host crates share one version; for a tag: it is `vMAJOR.MINOR.PATCH[-suffix]`, equals that version, `docs/releases/v<version>.md` exists, and no release for it exists yet |
| `build` (3 legs: Windows x86_64, Linux x86_64, PAM Linux x86_64) | for a tag: `cargo fmt --check`, `clippy -D warnings`, tests (on `main` and pull requests `ci.yml` runs them); every run: `--locked --release` build, packaging, then **the extracted archive** is exercised: `--version`, `--help` of every group, Windows: no Visual C++/UCRT DLL imports; Linux: `ldd` resolves; PAM: symbols, dependencies, `dlopen`, fail-closed `pamtester` run |
| `firmware` (ESP-IDF v5.5.6 container, **one leg per hardware profile**: `esp32s3-4mb`, `esp32s3-8mb`, `esp32s3-16mb`) | patches apply; FIDO2 dev image built with `build.py dev --hw <profile> --board esp32s3-boot-button --release` (descriptor version = release version); `check_no_irreversible.py`; `check_usb_descriptors.py`; `package_firmware.py package --hw <profile>` refuses CI-pin images, wrong chip, wrong flash size/mode/frequency (in the config, `flasher_args.json` and the bootloader and app image headers), Secure Boot/flash encryption/eFuse provisioning, any image touching nvs/phy_init/part0, a partition table that differs from `partitions.csv`, a wrong app project/version, an invalid default USB name and a landing URL other than `https://multikeys.mewis.me`; uploads `firmware-<profile>-fido-dev` |
| `assemble` | needs `build` and `firmware`; writes `firmware-manifest.json` with `--require-release-profiles` (fails unless every `release: true` profile of `tools/flash_policy.json` has a FIDO2 build), re-verifies every firmware zip against it, requires exactly the seven expected files, writes and checks `SHA256SUMS`, writes a summary table (profile, verification, zip, size, SHA-256) to the job summary, uploads the `release-bundle` artifact; read-only, publishes nothing |
| `release` | only for `v*` tags and only if `assemble` succeeded; the only job with `contents: write` (asserted by `tests/release/test_workflows.py`); downloads `release-bundle`, checks it holds eight files and `SHA256SUMS`, then `gh release create --verify-tag` (never `--clobber`, never an upload to an existing release) |

Pull requests, pushes to `main` and manual runs never reach `release`. `release.yml` builds, packages and verifies the three
firmware zips on every push to `main` and on firmware-related pull requests; `ci.yml` no longer packages firmware.

**Caches never reach a release.** Pull requests and `main` restore the ESP-IDF ccache and the Rust build cache; only `main`
saves them; a tag run restores nothing and compiles from scratch (asserted by `tests/release/test_workflows.py`: every cache step
in the `build` and `firmware` jobs is skipped when `is_release == 'true'`, every `actions/cache/save` and every
`Swatinem/rust-cache` `save-if` requires `refs/heads/main`). Measurements: [CI_PERFORMANCE.md](CI_PERFORMANCE.md).

Third-party actions are pinned by commit SHA in every workflow.

## Status

v0.1.0 (host tools), v0.2.0 (host tools + FIDO2 development firmware + manifest) and v0.3.0 (host tools + firmware for 4, 8 and 16 MB +
schema-2 manifest) are published. For v0.2.0 the tag run passed every job; the downloaded assets pass `sha256sum -c SHA256SUMS` and
`package_firmware.py verify`.

v0.3.0 (tag on commit `d267592`, `release` run 45146599187, published 2026-11-23 09:27 UTC as Stable and Latest): every job of the tag run
passed. Checked on the published assets: 8 files; `sha256sum -c SHA256SUMS` OK; `package_firmware.py verify` OK for the three zips; in each
zip the image headers (bootloader `e9 03 02 2f|3f|4f`, app `e9 06 02 2f|3f|4f` for 4, 8 and 16 MB), the app descriptor (`0.3.0`,
`multikey-fido`, ESP-IDF v5.5.6) and `firmware.json`; and the web installer's own catalog and download/verification code (`fetchCatalog`,
`downloadBuild`) accepts the manifest and every zip of v0.3.0 and v0.2.0 through the production Worker. Reproducibility: the `main` run of the
same commit (warm caches) and the tag run (cold, no caches) produced byte-identical firmware zips, manifest, Linux archive and PAM archive. The
Windows archive differs: 24 of 2,458,112 bytes of `multikey.exe`, the first being the PE link timestamp (offset 0x118); the others, from
0x20dc94, were not identified. The published firmware zips were not flashed on a board (the hardware runs used a local build of the same
sources, version stamp `0.2.0-dev`).

v0.3.1 (tag on commit `46a4698`, `release` run 45164624117, published 2026-11-23 11:27 UTC as Stable and Latest): every job of the tag run
passed. Checked on the published assets: 8 files; `sha256sum -c SHA256SUMS` OK; `package_firmware.py verify` OK for the three zips; in each
zip the app descriptor says `0.3.1`, the stamped source commit is `46a469886a47` (no `+dirty`: the build container checks out cleanly) and
the SHA-256 of `multikey-fido.bin` equals the manifest's app-image hash. Production (`multikeys.mewis.me`) lists v0.3.1, v0.3.0 and v0.2.0
and returns the v0.3.1 16 MB zip byte for byte. Not done: flashing a published v0.3.1 zip on a board (the hardware run used a local build of
the same sources), and a reproducibility comparison against the `main` run.
