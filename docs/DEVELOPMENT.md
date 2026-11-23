# Development

## Toolchain

- ESP-IDF **v5.5.6**: `git clone --depth 1 --branch v5.5.6 --recurse-submodules --shallow-submodules https://github.com/espressif/esp-idf.git`
  then `install.ps1 esp32s3` (Windows) / `./install.sh esp32s3`, and activate with `export.ps1` / `. ./export.sh`.
  On Windows `tools/build.py` converts `IDF_PATH` to forward slashes because upstream CMake interpolates it into strings.
- Python 3.9+, Rust stable for `host/` (Linux additionally needs `libpcsclite-dev`; the PAM crate needs `libpam0g-dev`).
- First configure needs network access: upstream `pico-keys-sdk/cmake/deps.cmake` fetches mbedTLS (EdDSA fork), tinycbor and
  (openpgp) libcvc into `pico-keys-sdk/third-party`; the IDF component manager fetches `esp_tinyusb` and `neopixel`.

## Layout

| Path | Contents |
|---|---|
| `pico-keys-sdk/`, `pico-fido/`, `pico-openpgp/` | pinned upstream submodules (never edit; see DEPENDENCIES.md) |
| `patches/<submodule>/NNNN-*.patch` | our changes to upstream, applied by `tools/apply_patches.py` (idempotent) |
| `components/multikey_platform` | Kconfig (pins, LED type, VID/PID, timeouts, irreversible-operation gates) |
| `components/multikey_auth` | MKAUTH applet (fido image) |
| `CMakeLists.txt` | selects `MULTIKEY_APP=fido|openpgp` and `MULTIKEY_PROFILE=dev|prod`, lists upstream sources |
| `host/` | Rust workspace (see `host/README.md`) |
| `tools/` | build, patching, smoke tests, read-only provisioning check |

## Build

```
python tools/build.py dev --ci-pins                       # compile check, pins unset, image unusable
python tools/build.py dev                                 # needs sdkconfig.board
python tools/build.py prod --app openpgp
python tools/build.py prod --harden --signing-key K.pem --i-understand-irreversible   # see PROVISIONING.md
```

Build directories: `build-<app>-<profile>[-hardened]/`; generated sdkconfig: `sdkconfig.<app>-<profile>.generated`
(all git-ignored). `build.py` applies the patches first; the `pico-keys-sdk` submodule then shows as modified, which is expected.

## Changing upstream code

Never commit inside a submodule. Patches are **stacked** (applied in filename order; a later patch may touch lines an
earlier one changed). To add one, stage the current patched state as the baseline so the diff contains only your change:

```
python tools/apply_patches.py                      # all existing patches applied
git -C pico-keys-sdk add -A                        # index = baseline (index only, no commit)
# ... edit files in the submodule ...
git -C pico-keys-sdk diff --src-prefix=a/ --dst-prefix=b/ > patches/pico-keys-sdk/000N-name.patch
git -C pico-keys-sdk reset -q                      # drop the baseline, keep the working tree
python tools/apply_patches.py --check              # must report every patch "already applied"
```

`apply_patches.py` decides how many patches of a stack are applied by reverse-applying them in reverse order on a scratch copy
of the touched files, then applies the remaining ones in order. To start from a pristine tree use
`git -C <submodule> checkout -- .` and run `python tools/apply_patches.py` again.

Current stacks: `pico-keys-sdk` 0001 (board/LED/VID-PID/user presence/USB strings), 0002 (no automatic eFuse writes), 0003 (USB
identity: Kconfig strings, stored device name); `pico-fido` 0001 (enforce user presence), 0002 (project AAGUID, attestation
subject), 0003 (makeCredUvNotRqd default).

## Changing the MKAUTH protocol

Update `docs/PROTOCOLS.md`, `components/multikey_auth/multikey_auth.c` and `host/multikey-proto` together, with the test
vectors in `host/multikey-proto/tests/vectors.json`.

## Tests

`cd host && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` (+ `cargo test -p multikey-pam`).
`tools/run_emulation_tests.sh` (WSL/Linux) runs the FIDO UV-policy suite against the patched pico-fido emulation build.
The firmware itself has no on-target unit tests; hardware procedures are in TESTING.md.

### Current stacked patches

`patches/pico-keys-sdk/0001-0004` (board/LED/VID-PID/user presence, no automatic eFuse writes, USB identity, WebUSB landing page) and
`patches/pico-fido/0001-0003` (user presence, project AAGUID, makeCredUvNotRqd default). A new patch is generated from the submodule after
`git -C <sub> add -A` as the baseline (the diff then contains only the new edits), then `git -C <sub> reset -q`.

## Script and packaging tests (no hardware)

```
python -m unittest discover tests/flash      # flash_dev.py safety logic, USB descriptor tool
python -m unittest discover tests/release    # archives, notices, PE import checker
```
