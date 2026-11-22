# Dependencies and pinned versions

| Component | Version / ref | Pin | Licence |
|---|---|---|---|
| pico-keys-sdk | `v3.2-773-g50699e5` (pico-fido v8.2's pin) | `50699e53e8ada214c27f6c9b66ea3b6f127fc655` | AGPL-3.0 |
| pico-fido | `v8.2` | `15b848d821b4995eb1b29a5c2a4c24c25d1a768e` | AGPL-3.0 |
| pico-openpgp | `v5.0` | `c4869b583fae346fb1f6bd6fef7b7fb833c12c43` (its own SDK pin is `b35df81`, differs) | AGPL-3.0 |
| ESP-IDF | `v5.5.6` | tag | Apache-2.0 |
| mbedTLS (fetched by pico-keys-sdk `cmake/deps.cmake`) | `v3.6.7` (`v3.6.7-eddsa` fork with EdDSA) | refs in deps.cmake | Apache-2.0 |
| tinycbor | `v0.6.1` | ref in deps.cmake | MIT |

Pins come from the submodule gitlinks (`git submodule status`). Upstream fetches mbedTLS/tinycbor at configure time
into `pico-keys-sdk/third-party` from refs in `pico-keys-sdk/cmake/deps.cmake`; those are tags, not SHAs, so a
reproducible release build should vendor or hash-check them (tracked in ROADMAP).
