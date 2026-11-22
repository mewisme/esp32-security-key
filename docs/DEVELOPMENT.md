# Development

## Toolchain

- ESP-IDF **v5.5.6**: `git clone --depth 1 --branch v5.5.6 --recurse-submodules --shallow-submodules https://github.com/espressif/esp-idf.git`
  then `install.ps1 esp32s3` (Windows) / `./install.sh esp32s3`, and activate with `export.ps1` / `. ./export.sh`.
- Python 3.9+, Rust (stable) for `host/`.

## Build

```
git clone --recurse-submodules https://github.com/mewisme/esp32-security-key
python tools/build.py dev --ci-pins     # compile check, image unusable (no pins)
python tools/build.py dev               # real build, needs sdkconfig.board (see HARDWARE.md)
python tools/build.py prod
```

Build outputs: `build-dev/`, `build-prod/` (git-ignored). Upstream fetches mbedTLS and tinycbor at configure time,
so the first configure needs network access.

## Upstream changes

Do not edit submodules. Put changes in `patches/<submodule>/NNNN-name.patch`, applied by `tools/apply_patches.py`.
