# Releases

One GitHub Release per version carries **both** the host tools and, from v0.2.0, prebuilt development firmware for the
supported board plus a machine-readable firmware manifest. v0.1.0 contained host tools only.

The published firmware is the FIDO2 development image for an ESP32-S3 N16R8 board with the BOOT button (GPIO0) as the touch
button and no LED (`boards/esp32s3-n16r8-boot-button.board`). It uses the development USB VID:PID `303A:4002` and the
development AAGUID ([USB_IDENTITY](USB_IDENTITY.md)); publishing it requires the maintainer's explicit acceptance of that. The
OpenPGP image and other boards are built from source ([FLASHING_ADVANCED](FLASHING_ADVANCED.md)).

## Assets (v0.2.0 as the example)

| File | Contents |
|---|---|
| `multikey-v0.2.0-windows-x86_64.zip` | `multikey.exe` (static CRT), `LICENSE`, `THIRD_PARTY_LICENSES.txt`, `README.txt` |
| `multikey-v0.2.0-linux-x86_64.tar.gz` | `multikey`, same companions; built on Ubuntu 22.04 |
| `multikey-pam-v0.2.0-linux-x86_64.tar.gz` | `pam_multikey.so` (built as `libpam_multikey.so`, renamed), same companions |
| `multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev.zip` | `bootloader.bin`, `partition-table.bin`, `multikey-fido.bin`, `firmware.json`, `SHA256SUMS`, `LICENSE`, `NOTICE.txt`, `README.txt` |
| `firmware-manifest.json` | one entry per firmware build: offsets, sizes and SHA-256 of each image and of the zip, partition layout, USB identity, data-compatibility range |
| `SHA256SUMS` | SHA-256 of the five files above |

Each archive has one root directory and exactly the listed members (asserted at packaging time). Archives are deterministic:
sorted entries, `SOURCE_DATE_EPOCH` = the commit's time, zero owner ids.

### Firmware manifest (`schema_version` 1)

Written by `tools/package_firmware.py manifest`, validated again by the web installer (`web/src/lib/firmware/manifest.ts`).
Top level: `schema` (`multikeys-firmware-manifest`), `schema_version`, `version`, `tag`, `source_commit`, `repository`,
`builds[]`. Each build: `id`, `image`, `project_name`, `version`, `title`, `board`, `chip`, `flash_size`, `flash_mode`,
`flash_freq`, `security_profile` (`development`), `idf_version`, `user_presence`, `led`, `usb {vid, pid, webusb_landing_url}`,
`package {name, size, sha256}`, `images[] {role, file, offset, size, sha256}`, `partitions[]` (all rows of `partitions.csv`),
`layout_id`, `protected_partitions`, `repurpose_fill`, `update.data_preserving_from`, `install_modes`, `verification`.
`firmware.json` inside the zip is the same build entry without `package`.

`update.data_preserving_from` (0.2.0 for now) is the oldest installed version whose stored data this firmware declares it can
use; the web installer treats anything else as an unverified update and asks for an acknowledgement.

## Verify a download

```powershell
Get-FileHash -Algorithm SHA256 .\multikey-v0.2.0-windows-x86_64.zip   # compare with SHA256SUMS
```
```sh
sha256sum -c SHA256SUMS --ignore-missing
unzip multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev.zip && (cd multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev && sha256sum -c SHA256SUMS)
```

No signature is published; the checksum file and the manifest live next to the assets in the same release and therefore
protect against corruption, not against a compromised repository or release.

## Cutting a release

1. Bump `[workspace.package].version` in `host/Cargo.toml` (all crates and the firmware share it), update `host/Cargo.lock`
   (`cargo build --locked` must pass).
2. Add `docs/releases/vX.Y.Z.md` (the release notes; the workflow refuses a tag without it).
3. Commit and push to `main`. The `release` workflow runs on `main` (build, package and verify everything, **no publishing**);
   wait for it to be green. `gh workflow run release.yml --ref main` runs it on demand.
4. `git tag -a vX.Y.Z -m "MultiKeys X.Y.Z"` and `git push origin vX.Y.Z`. **Only with the maintainer's explicit approval.**
   The tag push is what publishes.

A `-suffix` in the version (`0.3.0-rc.1`) publishes a pre-release.

## What the workflow checks (`.github/workflows/release.yml`)

| Job | Gate |
|---|---|
| `meta` | release script tests (packaging, firmware packaging, workflow invariants); all five host crates share one version; for a tag: it is `vMAJOR.MINOR.PATCH[-suffix]`, equals that version, `docs/releases/v<version>.md` exists, and no release for it exists yet |
| `build` (3 legs: Windows x86_64, Linux x86_64, PAM Linux x86_64) | `cargo fmt --check`, `clippy -D warnings`, tests, `--locked --release` build, packaging, then **the extracted archive** is exercised: `--version`, `--help` of every group, Windows: no Visual C++/UCRT DLL imports; Linux: `ldd` resolves; PAM: symbols, dependencies, `dlopen`, fail-closed `pamtester` run |
| `firmware` (ESP-IDF v5.5.6 container) | patches apply; FIDO2 dev image built with the BOOT-button board profile and `--release` (descriptor version = release version); `check_no_irreversible.py`; `check_usb_descriptors.py`; `package_firmware.py package` refuses CI-pin images, wrong chip/flash size, Secure Boot/flash encryption/eFuse provisioning, any image touching nvs/phy_init/part0, a partition table that differs from `partitions.csv`, a wrong app project/version and a landing URL other than `https://multikeys.mewis.me` |
| `assemble` | needs `build` and `firmware`; writes `firmware-manifest.json`, re-verifies the firmware zip against it, requires exactly the five expected files, writes and checks `SHA256SUMS`, uploads the `release-bundle` artifact; read-only, publishes nothing |
| `release` | only for `v*` tags and only if `assemble` succeeded; the only job with `contents: write` (asserted by `tests/release/test_workflows.py`); downloads `release-bundle`, checks `SHA256SUMS`, then `gh release create --verify-tag` (never `--clobber`, never an upload to an existing release) |

Pull requests, pushes to `main` and manual runs never reach `release`. CI (`ci.yml`) also packages and verifies a `-dev`
firmware on every push.

Third-party actions are pinned by commit SHA in `release.yml`, `web.yml` and the `flash-script` CI job. Unpinned (open item):
`actions/checkout@v4` and `dtolnay/rust-toolchain@stable` in the older `ci.yml` jobs.

## Status

v0.1.0 (host tools) and v0.2.0 (host tools + FIDO2 development firmware + manifest) are published. For v0.2.0 the tag run
passed every job; the downloaded assets pass `sha256sum -c SHA256SUMS` and `package_firmware.py verify`.
