<div align="center">

# MultiKeys

**Turn an ESP32-S3 board into a USB security key (FIDO2 / passkeys).**

[![CI](https://github.com/mewisme/esp32-security-key/actions/workflows/ci.yml/badge.svg)](https://github.com/mewisme/esp32-security-key/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mewisme/esp32-security-key?label=release)](https://github.com/mewisme/esp32-security-key/releases/latest)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)

[Web installer](https://multikeys.mewis.me) · [First use](https://multikeys.mewis.me/first-use) · [Help](https://multikeys.mewis.me/help) · [Docs](docs/) · [Releases](https://github.com/mewisme/esp32-security-key/releases)

</div>

> [!WARNING]
> **Experimental development firmware, not suitable for protecting important accounts.**
> It has been tested on one board type, is not FIDO certified, uses a development USB identity, and an ESP32-S3 is not a secure
> chip: anyone with the board in hand can read what is stored on it. Try it with test accounts. Details: [docs/SECURITY.md](docs/SECURITY.md).

## About

MultiKeys turns a cheap ESP32-S3 development board into a USB security key. Websites that support passkeys or security keys
(FIDO2 / WebAuthn) can use it for sign-in and two-step verification: when a site asks you to touch your key, you press the
board's **BOOT** button. It is open source and builds on the [Pico Keys](https://github.com/polhenarejos) projects.

- **FIDO2 / CTAP2 and U2F** over USB HID, with real user presence enforced.
- **Browser installer**: picks the right firmware for your board, verifies it and shows what it will write before writing.
- **`multikey` command-line tool** for Windows and Linux: inventory, FIDO PIN and credentials, login-key (MKAUTH) enrolment.
- **Linux PAM module** for login keys (installed on request, never enabled automatically).
- **Safe by default**: no automatic eFuse writes, no erasing of the whole flash, no PIN set for you.

## Supported hardware

| You need | Notes |
|---|---|
| ESP32-S3 with **4, 8 or 16 MB quad-SPI flash** | The module is usually marked **N4**, **N8** or **N16** (flash in MB), e.g. **N16R8**. Only the N16R8 has been tested; the 4 and 8 MB builds pass every check but have not run on a board. Octal flash (e.g. N16R8V) is not supported. |
| A USB connector wired to the chip | Labelled **USB** or **OTG**. A second connector labelled UART/COM can install firmware, but the finished key does not work on it. |
| A **BOOT** button | It becomes the touch button. The firmware has no status light. |
| A USB data cable | Many cables only carry power. |

Tested boards and what is not supported: [multikeys.mewis.me](https://multikeys.mewis.me/#hardware) and
[docs/HARDWARE.md](docs/HARDWARE.md).

## Install

| Method | For | How |
|---|---|---|
| **Web installer** | Everyone | Open [multikeys.mewis.me](https://multikeys.mewis.me) in desktop Chrome or Edge |
| **PowerShell script** | Developers on Windows | `.\tools\flash-dev.ps1` (below) |
| **Manual ESP-IDF** | Linux/macOS, OpenPGP image, recovery | [docs/FLASHING_ADVANCED.md](docs/FLASHING_ADVANCED.md) |

### Web installer

[multikeys.mewis.me](https://multikeys.mewis.me) reads your board's chip and flash size, picks the 4, 8 or 16 MB firmware, downloads
it from the official release, verifies it, and shows exactly what it will write before writing anything. You can name your key
beforehand (for example "Mew's Security Key"); the name is applied after the flash is verified, needs a BOOT press, and can be changed
later on the First use page. Tested on real hardware on one board (Windows/Chrome): updating an existing install, naming and renaming
the key ([installer report](docs/hw-reports/2026-11-23-web-installer.md),
[naming report](docs/hw-reports/2026-11-23-profiles-and-personalization.md)). The site is available in English and Vietnamese and
also has a Passkey lab (`/passkeys`) that registers a test passkey on the key; the lab is tested with a virtual authenticator only, not yet on
real hardware.

### PowerShell (developers, the verified method)

Prerequisites, once: [ESP-IDF v5.5.6 for Windows](https://docs.espressif.com/projects/esp-idf/en/v5.5.6/esp32s3/get-started/windows-setup.html),
Python 3.9+ and Git. The script never downloads or installs anything.

```powershell
git clone --recurse-submodules https://github.com/mewisme/esp32-security-key
cd esp32-security-key
.\tools\flash-dev.ps1
```

1. Connect the board's **USB/OTG** connector (not UART/COM).
2. Run the script and follow the prompts: hold BOOT while plugging in when asked, then type `FLASH`. `-DryRun` does everything except the write.
3. Check with `python tools\usb_identity.py` or `multikey device info`: the name should be `MultiKeys Security Key`.

The script builds the firmware, identifies the board, checks that the storage layout matches (so stored keys are kept), shows what it
will write and asks for a typed confirmation. It never erases the whole flash, resets the key, sets a PIN or changes permanent chip
settings. For an existing checkout run `git submodule update --init` first.

## Host tool

Install the prebuilt `multikey` (Windows x64, Linux x86_64). The script takes the latest
[release](https://github.com/mewisme/esp32-security-key/releases), checks it against `SHA256SUMS`, installs it for your user and never
touches the key.

```powershell
irm https://get.mewis.me/esp32-security-key.ps1 | iex
```

```sh
curl -fsSL https://get.mewis.me/esp32-security-key.sh | sh
curl -fsSL https://get.mewis.me/esp32-security-key.sh | sh -s -- --pam   # Linux: also the PAM module (needs root; not enabled)
```

Pinning a version, uninstalling and every option: [docs/RELEASES.md](docs/RELEASES.md#install-script). Or take the archive from GitHub
Releases, or build it with `cd host && cargo build --release`.

```text
multikey device list | info | status | version      # inventory and identity, add --json for scripts
multikey fido info | pin status                      # read-only
multikey fido pin set | change                       # FIDO PIN (set is irreversible without authenticatorReset)
multikey fido credentials list | delete --id HEX
multikey mkauth status | enroll | auth | list | revoke
multikey device show | rename "My Key" | reset-name | reenumerate   # USB name (BOOT press)
multikey readers                                   # PC/SC readers
```

Reference, exit codes and the Windows elevation rule: [docs/CLI.md](docs/CLI.md) · Linux PAM: [docs/LINUX_PAM.md](docs/LINUX_PAM.md) ·
Windows: [docs/WINDOWS.md](docs/WINDOWS.md).

## First use

- After installing, the board's serial (COM) port disappears and a security key appears instead. That is expected.
- When a site or your browser asks you to touch the key, press **BOOT**.
- Add the key to an account first (usually Security → Passkeys or Two-step verification), then use it to sign in.
- Some sites ask for a PIN. Setting a PIN is permanent unless you reset the key, which deletes everything on it; read
  [docs/FIDO_UV.md](docs/FIDO_UV.md) first.
- More: [multikeys.mewis.me/first-use](https://multikeys.mewis.me/first-use).

## Troubleshooting

| Problem | What to do |
|---|---|
| The board doesn't show up | Use the USB/OTG connector and a data cable; hold BOOT while plugging in (or hold BOOT and press RST). In download mode Windows shows a `USB Serial Device (COMn)`. |
| Wrong connector | The UART/COM connector (CP210x, CH340) can install firmware, but the key only works on USB/OTG. |
| Drivers | None to install on Windows 10/11. |
| The COM port vanished after installing | Expected. If the key doesn't appear within 15 seconds, unplug and replug it. |
| `multikey fido ...` can't see the key on Windows | Windows only lets Administrator programs use security keys directly: run it from an Administrator terminal. |
| An installer error | Every error with its fix: [multikeys.mewis.me/help](https://multikeys.mewis.me/help). |

## Releases

[GitHub Releases](https://github.com/mewisme/esp32-security-key/releases) carry the host tools and prebuilt FIDO2 development
firmware; asset list, checksums and how releases are built: [docs/RELEASES.md](docs/RELEASES.md).

| Version | Contents |
|---|---|
| **v0.3.0** | Host tools (no code change) and firmware for 4, 8 and 16 MB boards, one zip per flash size (only 16 MB is hardware verified; the published zips themselves were not flashed), schema-2 `firmware-manifest.json` |
| **v0.2.0** | Host tools, firmware for 16 MB boards (N16R8), `firmware-manifest.json` with checksums |
| **v0.1.0** | Host tools only (`multikey` for Windows and Linux, the Linux PAM module), no firmware |

## Development

<details>
<summary>Firmware images, build, hardware configuration</summary>

### Firmware images

Two images, built from one tree on top of the AGPL-3.0 Pico Keys projects:

| Image (`--app`) | Provides | Status |
|---|---|---|
| `fido` | FIDO2/CTAP2 + U2F over USB HID (upstream pico-fido v8.2), OATH/OTP applets, **MKAUTH** challenge-response applet over CCID | Basic FIDO2 flow and user presence hardware verified on one board (Windows 11); MKAUTH SELECT/GET_INFO verified; everything else untested |
| `openpgp` | OpenPGP card + PIV over CCID (upstream pico-openpgp main `9b23276`) | Build verified; not hardware verified; not published as a prebuilt image |

A single merged FIDO+OpenPGP image is **Blocked** ([ADR-0002](docs/ADR-0002-separate-images.md)). No CTAP 2.1 or FIDO certification
claim is made; attestation is development-only. SSH `*-sk` keys and Git SSH signing use the FIDO2 function
([PROTOCOLS](docs/PROTOCOLS.md), [TESTING](docs/TESTING.md)).

### Build

Prerequisite: ESP-IDF v5.5.6 activated (`idf.py` on PATH), see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```sh
python tools/build.py dev --ci-pins          # compile check; the image refuses to be usable
python tools/build.py dev                    # real build (16 MB flash), needs sdkconfig.board with your GPIOs
python tools/build.py dev --hw esp32s3-4mb --board esp32s3-boot-button --clean   # 4 MB flash (also esp32s3-8mb)
python tools/build.py dev --release          # firmware version without the -dev suffix (release packaging)
python tools/build.py prod --app openpgp
cd host && cargo test --locked
cd web && pnpm install && pnpm dev           # web installer (web/README.md)
```

Every eFuse operation is manual ([docs/PROVISIONING.md](docs/PROVISIONING.md)); the firmware does not burn eFuses on first boot
(unlike upstream).

### Hardware configuration

No GPIO is assumed by the firmware sources. The BOOT-button board profile is `boards/esp32s3-boot-button.board` (copied to
`sdkconfig.board` by the flash script, or layered with `build.py --board esp32s3-boot-button`); other boards set
`CONFIG_MULTIKEY_BUTTON_GPIO` and `CONFIG_MULTIKEY_LED_GPIO` ([docs/HARDWARE.md](docs/HARDWARE.md)); the build fails while they are
unset. The default USB VID/PID is a development placeholder. USB names and the development AAGUID:
[docs/USB_IDENTITY.md](docs/USB_IDENTITY.md). First manual hardware run: [docs/FIRST_RUN_WINDOWS.md](docs/FIRST_RUN_WINDOWS.md).

</details>

## Documentation

| | |
|---|---|
| **Design** | [ARCHITECTURE](docs/ARCHITECTURE.md) · [SECURITY](docs/SECURITY.md) · [PROTOCOLS](docs/PROTOCOLS.md) · [ADR-0001](docs/ADR-0001-foundation.md) · [ADR-0002](docs/ADR-0002-separate-images.md) |
| **Hardware** | [HARDWARE](docs/HARDWARE.md) · [HARDWARE_PROFILES](docs/HARDWARE_PROFILES.md) · [USB_IDENTITY](docs/USB_IDENTITY.md) · [PROVISIONING](docs/PROVISIONING.md) |
| **Using it** | [CLI](docs/CLI.md) · [WINDOWS](docs/WINDOWS.md) · [LINUX_PAM](docs/LINUX_PAM.md) · [FIDO_UV](docs/FIDO_UV.md) · [FLASHING_ADVANCED](docs/FLASHING_ADVANCED.md) |
| **Project** | [DEVELOPMENT](docs/DEVELOPMENT.md) · [TESTING](docs/TESTING.md) · [RELEASES](docs/RELEASES.md) · [CI_PERFORMANCE](docs/CI_PERFORMANCE.md) · [DEPENDENCIES](docs/DEPENDENCIES.md) · [BEGINNER_UX_AUDIT](docs/BEGINNER_UX_AUDIT.md) |
| **Status** | [ROADMAP](docs/ROADMAP.md) (status matrix of every feature) · [hardware test reports](docs/hw-reports/) |

## License

AGPL-3.0-or-later (see [LICENSE](LICENSE)). The firmware builds on AGPL-3.0 projects by Pol Henarejos; their copyrights and licences
remain with their authors. If you distribute binaries, provide the corresponding source.
