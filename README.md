# ESP32-S3 MultiKey

Open-source USB security key firmware for the ESP32-S3 (target board: generic **ESP32-S3 N16R8** devkit, 16 MB flash,
native USB OTG), plus Rust host tools.

> **Status: early development. Nothing here has been run on real hardware.** Firmware images build (ESP-IDF v5.5.6) and
> the host tools pass unit tests against a mock device. See [docs/ROADMAP.md](docs/ROADMAP.md) for the per-feature status
> matrix. Do not use it to protect real accounts. The ESP32-S3 is not a secure element ([docs/SECURITY.md](docs/SECURITY.md)).

## What it is

Two firmware images, built from one tree on top of the AGPL-3.0 [Pico Keys](https://github.com/polhenarejos) projects:

| Image (`--app`) | Provides | Status |
|---|---|---|
| `fido` | FIDO2/CTAP2 + U2F over USB HID (upstream pico-fido v8.2), OATH/OTP applets, **MKAUTH** custom challenge-response applet over CCID | Build verified; not hardware verified |
| `openpgp` | OpenPGP card + PIV over CCID (upstream pico-openpgp main `9b23276`) | Build verified; not hardware verified |

A single merged FIDO+OpenPGP image is **Blocked** ([ADR-0002](docs/ADR-0002-separate-images.md)).

Host side ([host/](host/README.md)): Rust crates `multikey-proto`, `multikey-host`, `multikey-cli` (enroll / auth / revoke via
PC/SC) and a Linux PAM module `multikey-pam` ([docs/LINUX_PAM.md](docs/LINUX_PAM.md)). Windows: see
[docs/WINDOWS.md](docs/WINDOWS.md) (Credential Provider not implemented).

SSH `*-sk` keys and Git SSH signing use the FIDO2 function and need no extra firmware; test procedures are in
[docs/PROTOCOLS.md](docs/PROTOCOLS.md) and [docs/TESTING.md](docs/TESTING.md) (pending hardware).

No CTAP 2.1 or FIDO certification claim is made. Attestation is development-only.

## Hardware

No GPIO is assumed. Set `CONFIG_MULTIKEY_BUTTON_GPIO` and `CONFIG_MULTIKEY_LED_GPIO` in `sdkconfig.board`
([docs/HARDWARE.md](docs/HARDWARE.md)); the build fails while they are unset. The default USB VID/PID is a development
placeholder and must not be used for distribution.

## Build

Prerequisite: ESP-IDF v5.5.6 activated (`idf.py` on PATH), see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```
git clone --recurse-submodules https://github.com/mewisme/esp32-security-key
cd esp32-security-key
python tools/build.py dev --ci-pins          # compile check; the image refuses to be usable
python tools/build.py dev                    # real build, needs sdkconfig.board with your GPIOs
python tools/build.py prod --app openpgp
cd host && cargo test
```

Flashing and every eFuse operation are manual, see [docs/PROVISIONING.md](docs/PROVISIONING.md). The firmware does **not**
burn eFuses on first boot (unlike upstream); that behaviour is opt-in.

## Documentation

[ARCHITECTURE](docs/ARCHITECTURE.md) · [HARDWARE](docs/HARDWARE.md) · [SECURITY](docs/SECURITY.md) ·
[PROTOCOLS](docs/PROTOCOLS.md) · [DEVELOPMENT](docs/DEVELOPMENT.md) · [TESTING](docs/TESTING.md) ·
[PROVISIONING](docs/PROVISIONING.md) · [ROADMAP](docs/ROADMAP.md) · [LINUX_PAM](docs/LINUX_PAM.md) ·
[WINDOWS](docs/WINDOWS.md) · [DEPENDENCIES](docs/DEPENDENCIES.md) · [ADR-0001](docs/ADR-0001-foundation.md) ·
[ADR-0002](docs/ADR-0002-separate-images.md)

## License

AGPL-3.0-or-later (see `LICENSE`). The firmware builds on AGPL-3.0 projects by Pol Henarejos; their copyrights and
licences remain with their authors. If you distribute binaries, provide the corresponding source.
