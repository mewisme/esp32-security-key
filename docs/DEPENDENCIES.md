# Dependencies and pinned versions

| Component | Version / ref | Pin | Licence |
|---|---|---|---|
| pico-keys-sdk | `v3.2-773-g50699e5` (pico-fido v8.2's pin) | `50699e53e8ada214c27f6c9b66ea3b6f127fc655` | AGPL-3.0 |
| pico-fido | `v8.2` | `15b848d821b4995eb1b29a5c2a4c24c25d1a768e` | AGPL-3.0 |
| pico-openpgp | upstream main (`nightly-main`, v5.0 + 48 commits); v5.0 does not build against the SDK pin above | `9b232765dc32859ff5ba59856aa13562be18e51c` | AGPL-3.0 |
| ESP-IDF | `v5.5.6` | tag | Apache-2.0 |
| mbedTLS (fetched by pico-keys-sdk `cmake/deps.cmake`) | `v3.6.7-eddsa` fork (adds EdDSA; `v3.6.7` upstream when EdDSA is off) | `fc39404125e93ee00e6758605e6c6f2c8db440f1` (fork) / `068ff080b369adfac81509f9b57b2afabaf82dc5` (upstream, peeled tag) | Apache-2.0 |
| tinycbor | `v0.6.1` | `c0aad2fb2137a31b9845fbaae3653540c410f215` (peeled tag) | MIT |
| cJSON (only with `USB_ITF_LWIP`, not used by our images) | `v1.7.19` | `c859b25da02955fef659d658b8f324b5cde87be3` | MIT |
| mlkem-native / mldsa-native (only with `ENABLE_PQC`, not used by our images) | `v1.2.0` / `v1.0.0-beta2` | `0ba906cb14b1c241476134d7403a811b382ca498` / `9b0ee84f4cf399043eca59eca4e5f8531ca1d61b` | Apache-2.0 / MIT / ISC |
| libcvc (openpgp image only) | was branch `main`; now the commit `main` pointed to on 2026-11-23 | `54562afc4d620c8bdb118183c0db49048baa0b2c` | see upstream |
| ctap-hid-fido2 (host `multikey-fido`) | `=3.6.1` (exact), `Cargo.lock` tracked | crates.io | MIT (pulls hidapi, ring) |
| Rust toolchain (host) | `rust-version = 1.89`; CI uses `stable` (moving; **not** pinned, see "Not pinned") | `rust-toolchain` action pinned by SHA | n/a |
| ESP-IDF build container (CI, release) | `espressif/idf:v5.5.6` | `@sha256:bf72fe7a15c22849a9a94147301165a545fb8905d97c176cf748e3e4614cac84` (multi-arch index digest) | Apache-2.0 |
| GitHub Actions | see the `# vX.Y.Z` comment on each `uses:` | full 40-hex commit SHA in `ci.yml`, `release.yml`, `web.yml` | n/a |
| Python tools (`tools/requirements.txt`) | exact versions, direct and transitive | `==` pins | various |
| Python CI helper (`pyyaml`) | `6.0.2` | `==` pin in the workflow step | MIT |
| espressif/esp_tinyusb, zorxx/neopixel (IDF component manager) | see `dependencies.lock` | locked | Apache-2.0 / MIT |

Submodule pins come from the gitlinks (`git submodule status`). `pico-keys-sdk/cmake/deps.cmake` fetches mbedTLS, tinycbor, libcvc
(and, when enabled, cJSON, mlkem-native, mldsa-native) into `pico-keys-sdk/third-party` at configure time. Upstream pointed at tags
and the `main` branch; `patches/pico-keys-sdk/0006-multikey-pin-third-party-deps.patch` replaces every `PICOKEYS_*_REF` with a full
commit SHA (the old tag or branch stays in a trailing comment) and makes `picokeys_sync_dep` fail, and delete the checkout, when
`git rev-parse HEAD` is not exactly that SHA. A tag that resolves to an annotated tag object is pinned to the commit it peels to.
A `third-party` directory fetched before this patch has the old ref in its `.picokeys_dep_source` marker and is re-fetched on the next
configure. `pico-keys-sdk` shows as modified after `tools/apply_patches.py` runs (our patches, see `patches/`); this is expected.

Host release builds use `--locked` against the tracked `host/Cargo.lock` (every `cargo build|test|clippy` in the workflows has
`--locked`); `tools/gen_notices.py` writes the third-party license inventory shipped in every archive. The IDF component manager
inputs (`esp_tinyusb`, `tinyusb`, `neopixel`) are locked with content hashes in the tracked `dependencies.lock`.

## Enforcement

`python tools/check_pins.py` (CI job `pins` in `ci.yml`, after `tools/apply_patches.py`) fails on: an action `uses:` that is not
`owner/repo@<40-hex>` with a trailing version comment; a `container:`/`image:` without `@sha256:`; `cargo build|test|clippy|run|install`
without `--locked`; a `pip install` of an unpinned package; a `tools/requirements.txt` line that is not `name==version`; a `GIT_TAG`
that is not a 40-hex SHA in the repository's CMake files; a `PICOKEYS_*_REF` in `deps.cmake` that is not a 40-hex SHA; a missing
`host/Cargo.lock`. Its self-test is `python -m unittest discover tests/pins`.

## How to update a pin

1. Resolve the new ref to a commit: `git ls-remote https://github.com/<owner>/<repo>.git 'refs/tags/<tag>*'` and take the
   peeled `^{}` line when there is one (otherwise the plain line); for a branch use `refs/heads/<branch>`.
2. Action: edit the SHA and the `# vX.Y.Z` comment on every `uses:` of it (`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`).
3. Container: `docker buildx imagetools inspect espressif/idf:<tag>` (digest of the index), put it after `@`, and change the ESP-IDF
   version everywhere together (`docs/DEVELOPMENT.md`, `build.py`).
4. `deps.cmake` refs: edit patch 0006 by hand-editing `pico-keys-sdk/cmake/deps.cmake`, then regenerate it as described in
   `tools/apply_patches.py` (stage the baseline with `git -C pico-keys-sdk add -A`, diff, restore) so the tree and the patch stay
   identical; run `python tools/apply_patches.py --check`.
5. Python: change the line in `tools/requirements.txt` and re-resolve the transitive closure in a fresh venv (`pip freeze`).
6. Cargo: `cargo update -p <crate> --precise <version>` in `host/`, commit `Cargo.lock`.
7. Run `python tools/check_pins.py`, then update this document.

## Not pinned (known)

- **Rust toolchain**: CI uses `toolchain: stable` through the SHA-pinned `rust-toolchain` action, so the compiler version moves with
  upstream. `Cargo.lock` still fixes every crate. Pinning needs a deliberate choice of version (`rust-version` is 1.89).
- **Runner images and apt packages**: `ubuntu-latest`, `windows-latest`, `ubuntu-22.04/24.04` and the `apt-get install` lists
  (libpcsclite, libudev, libpam, ccache, ...) come from the runner/distribution at run time.
- **Transitive git submodules of fetched repos** (for example mbedTLS's `framework`) are not initialised by `picokeys_sync_dep`; if
  upstream ever requires them the build fails instead of fetching an unpinned tree.
- **Upstream RP2040 helpers** under the submodules (`pico_sdk_import.cmake` with `PICO_SDK_FETCH_FROM_GIT_TAG`, Dockerfiles) are
  not used by the ESP32 build and are not checked.
- Hash-locked pip installs (`--require-hashes`) are not used; versions are exact but file hashes are not verified.
- The `web/` dependencies are locked by `web/pnpm-lock.yaml` and installed with `--frozen-lockfile`.
