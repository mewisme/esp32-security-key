# ESP32-S3 MultiKey

Open-source USB security key firmware for the ESP32-S3 (target board: generic **ESP32-S3 N16R8** devkit,
16 MB flash, native USB OTG), plus Rust host tools.

> **Status: early development.** Nothing here has been run on real hardware yet. See
> [docs/ROADMAP.md](docs/ROADMAP.md) for the per-feature status matrix. Do not use it to protect real accounts.

## Features and honest status

| Feature | Source | Status |
|---|---|---|
| FIDO2 / CTAP2 + U2F over USB HID | upstream [pico-fido](https://github.com/polhenarejos/pico-fido) v8.2 | Integration in progress |
| SSH `ecdsa-sk` / `ed25519-sk`, Git SSH signing | via FIDO2, no extra firmware | Not tested (needs hardware) |
| OpenPGP card over CCID | upstream [pico-openpgp](https://github.com/polhenarejos/pico-openpgp) v5.0 | Not integrated yet |
| Custom challenge-response applet ("MKAUTH") + Rust host tools | this repo | Not implemented |
| Linux PAM module, Windows path | this repo | Not implemented |
| Button user-presence, status LED | Kconfig-configurable GPIOs | Implemented partially, not hardware verified |
| Separate dev / prod configs | `sdkconfig.dev`, `sdkconfig.prod` | Implemented (prod hardening pending) |

No CTAP 2.1 or FIDO certification claim is made. Attestation is development-only.

## Hardware

No pin is assumed. Set `CONFIG_MULTIKEY_BUTTON_GPIO` and `CONFIG_MULTIKEY_LED_GPIO` yourself
(`sdkconfig.board`, see [docs/HARDWARE.md](docs/HARDWARE.md)). The ESP32-S3 is **not** a secure element.

## Build

Prerequisite: ESP-IDF v5.5.6 activated (`idf.py` on PATH). See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```
git clone --recurse-submodules https://github.com/mewisme/esp32-security-key
cd esp32-security-key
python tools/build.py dev          # needs sdkconfig.board with your GPIOs
python tools/build.py dev --ci-pins  # compile check only, image refuses to be usable
```

Flashing and eFuse operations are manual and documented in [docs/PROVISIONING.md](docs/PROVISIONING.md).

## Documentation

[ARCHITECTURE](docs/ARCHITECTURE.md) · [HARDWARE](docs/HARDWARE.md) · [SECURITY](docs/SECURITY.md) ·
[PROTOCOLS](docs/PROTOCOLS.md) · [DEVELOPMENT](docs/DEVELOPMENT.md) · [TESTING](docs/TESTING.md) ·
[PROVISIONING](docs/PROVISIONING.md) · [ROADMAP](docs/ROADMAP.md) · [ADR-0001](docs/ADR-0001-foundation.md) ·
[DEPENDENCIES](docs/DEPENDENCIES.md)

## License

AGPL-3.0-or-later (see `LICENSE`). The firmware builds on the AGPL-3.0 Pico Keys projects by Pol Henarejos;
their copyright and licenses remain with their authors.
