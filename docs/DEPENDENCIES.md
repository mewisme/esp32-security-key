# Dependencies and pinned versions

| Component | Version / ref | Pin | Licence |
|---|---|---|---|
| pico-keys-sdk | `v3.2-773-g50699e5` (pico-fido v8.2's pin) | `50699e53e8ada214c27f6c9b66ea3b6f127fc655` | AGPL-3.0 |
| pico-fido | `v8.2` | `15b848d821b4995eb1b29a5c2a4c24c25d1a768e` | AGPL-3.0 |
| pico-openpgp | upstream main (`nightly-main`, v5.0 + 48 commits); v5.0 does not build against the SDK pin above | `9b232765dc32859ff5ba59856aa13562be18e51c` | AGPL-3.0 |
| ESP-IDF | `v5.5.6` | tag | Apache-2.0 |
| mbedTLS (fetched by pico-keys-sdk `cmake/deps.cmake`) | `v3.6.7-eddsa` fork (adds EdDSA) | tag in deps.cmake | Apache-2.0 |
| tinycbor | `v0.6.1` | tag in deps.cmake | MIT |
| libcvc (openpgp image only) | `main` | branch in deps.cmake | see upstream |
| espressif/esp_tinyusb, zorxx/neopixel (IDF component manager) | see `dependencies.lock` | locked | Apache-2.0 / MIT |

Pins come from the submodule gitlinks (`git submodule status`). Upstream fetches mbedTLS/tinycbor/libcvc at configure time
into `pico-keys-sdk/third-party` from refs in `pico-keys-sdk/cmake/deps.cmake`. Those are tags or a branch, **not SHAs**, so
the build is not fully reproducible; a release build should vendor or hash-check them (open item, ROADMAP).
`pico-keys-sdk` shows as modified after `tools/apply_patches.py` runs (our patches, see `patches/`); this is expected.
