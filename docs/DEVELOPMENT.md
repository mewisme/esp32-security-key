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

Never commit inside a submodule. Edit the file in the submodule, then:

```
git -C pico-keys-sdk diff -- <path> > patches/pico-keys-sdk/000N-name.patch
git -C pico-keys-sdk checkout -- .
python tools/apply_patches.py && python tools/apply_patches.py --check
```

## Changing the MKAUTH protocol

Update `docs/PROTOCOLS.md`, `components/multikey_auth/multikey_auth.c` and `host/multikey-proto` together, with the test
vectors in `host/multikey-proto/tests/vectors.json`.

## Tests

`cd host && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` (+ `cargo test -p multikey-pam`).
Firmware has no automated tests; hardware procedures are in TESTING.md.
