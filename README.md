# MultiKeys

## What is MultiKeys?

MultiKeys turns a cheap ESP32-S3 development board into a USB security key. Websites that support passkeys or security keys
(FIDO2 / WebAuthn) can use it for sign-in and two-step verification: when a site asks you to touch your key, you press the
board's BOOT button. It is open source and builds on the [Pico Keys](https://github.com/polhenarejos) projects.

## Supported hardware

- An **ESP32-S3 board with 16 MB flash**. The metal module on the board is usually marked **N16R8** (N16 = 16 MB flash).
- A USB connector wired to the chip itself, usually labelled **USB** or **OTG**. Many boards have a second connector labelled
  UART or COM; that one can install firmware but the finished key does not work on it.
- A **BOOT** button. It becomes the key's touch button. The firmware has no status light.
- A USB cable that carries data (many cables only carry power).

Tested board types and what is not supported: see the compatibility section on
[multikeys.mewis.me](https://multikeys.mewis.me/#compatibility).

## Read this first

> **Experimental development firmware — not suitable for protecting important accounts.**
> It has been tested on one board type, is not FIDO certified, uses a development USB identity, and an ESP32-S3 is not a secure
> chip: anyone with the board in hand can read what is stored on it. Try it with test accounts.
> Details: [docs/SECURITY.md](docs/SECURITY.md).

## Install MultiKeys

### Easiest: in your browser

**[Install MultiKeys → multikeys.mewis.me](https://multikeys.mewis.me)** — web installer for desktop Chrome/Edge — launching
soon (the site is not live yet). Tested once on real hardware: one board, Windows/Chrome, updating an existing install
([report](docs/hw-reports/2026-11-23-web-installer.md)). It checks your board, downloads the firmware from the official
release, verifies it, and shows exactly what it will write before writing anything.

### Developer: PowerShell (the verified method)

One-time prerequisites: [ESP-IDF v5.5.6 for Windows](https://docs.espressif.com/projects/esp-idf/en/v5.5.6/esp32s3/get-started/windows-setup.html),
Python 3.9+ and Git. The script never downloads or installs anything.

```powershell
git clone --recurse-submodules https://github.com/mewisme/esp32-security-key
cd esp32-security-key
.\tools\flash-dev.ps1
```

Existing checkout: `git submodule update --init`, then `.\tools\flash-dev.ps1`.

1. Connect the board's **USB/OTG** connector (not UART/COM).
2. Run `.\tools\flash-dev.ps1` and follow the prompts: hold BOOT while plugging in when asked, then type `FLASH`.
   `-DryRun` does everything except the write.
3. Check: `python tools\usb_identity.py` or `multikey device info`. You should see the name `MultiKeys Security Key`.

The script builds the firmware, identifies the board, checks that the storage layout on the board matches (so stored keys are
kept), shows exactly what it will write and asks for a typed confirmation. It never erases the whole flash, resets the key,
sets a PIN or changes permanent chip settings.

### Advanced: manual ESP-IDF

Manual commands, Linux/macOS, the OpenPGP image and recovering a board that has other firmware on it:
[docs/FLASHING_ADVANCED.md](docs/FLASHING_ADVANCED.md).

## First use

- After installing, the board's serial (COM) port disappears and a security key appears instead. That is expected.
- When a site or your browser asks you to touch the key, press **BOOT**.
- Add the key to an account first (usually under Security → Passkeys or Two-step verification), then use it to sign in.
- Some sites ask for a PIN. Setting a PIN is permanent unless you reset the key, which deletes everything on it; read
  [docs/FIDO_UV.md](docs/FIDO_UV.md) first.
- More: [multikeys.mewis.me/first-use](https://multikeys.mewis.me/first-use).

## Troubleshooting

- **The board doesn't show up**: use the USB/OTG connector and a cable that carries data; hold BOOT while plugging in (or hold
  BOOT and press RST). In download mode Windows shows a `USB Serial Device (COMn)`.
- **Wrong connector**: the UART/COM connector (chips like CP210x or CH340) can install firmware, but the key only works on the
  USB/OTG connector.
- **Drivers**: none to install on Windows 10/11.
- **The COM port vanished after installing**: expected. If the key doesn't appear within 15 seconds, unplug and replug it.
- **`multikey fido ...` can't see the key on Windows**: Windows only lets programs running as Administrator use security keys
  directly. Run it from an Administrator terminal.
- Every error the web installer can show, with fixes: [multikeys.mewis.me/help](https://multikeys.mewis.me/help).

## Downloads and releases

[GitHub Releases](https://github.com/mewisme/esp32-security-key/releases):

- **v0.1.0**: host tools only (`multikey` for Windows and Linux, the Linux PAM module). No firmware.
- **From v0.2.0** (once published): the same host tools plus prebuilt FIDO2 firmware for ESP32-S3 N16R8 boards and a
  `firmware-manifest.json` with checksums, used by the web installer.

Asset list, checksums and how releases are built: [docs/RELEASES.md](docs/RELEASES.md).

## Developer documentation

<details>
<summary>Firmware images, build, host tool, hardware configuration</summary>

### Firmware images

Two images, built from one tree on top of the AGPL-3.0 Pico Keys projects:

| Image (`--app`) | Provides | Status |
|---|---|---|
| `fido` | FIDO2/CTAP2 + U2F over USB HID (upstream pico-fido v8.2), OATH/OTP applets, **MKAUTH** challenge-response applet over CCID | Basic FIDO2 flow and user presence hardware verified on one board (Windows 11); MKAUTH SELECT/GET_INFO verified; everything else untested |
| `openpgp` | OpenPGP card + PIV over CCID (upstream pico-openpgp main `9b23276`) | Build verified; not hardware verified; not published as a prebuilt image |

A single merged FIDO+OpenPGP image is **Blocked** ([ADR-0002](docs/ADR-0002-separate-images.md)). No CTAP 2.1 or FIDO
certification claim is made; attestation is development-only. SSH `*-sk` keys and Git SSH signing use the FIDO2 function
([docs/PROTOCOLS.md](docs/PROTOCOLS.md), [docs/TESTING.md](docs/TESTING.md)).

### Build

Prerequisite: ESP-IDF v5.5.6 activated (`idf.py` on PATH), see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```
python tools/build.py dev --ci-pins          # compile check; the image refuses to be usable
python tools/build.py dev                    # real build, needs sdkconfig.board with your GPIOs
python tools/build.py dev --release          # firmware version without the -dev suffix (release packaging)
python tools/build.py prod --app openpgp
cd host && cargo test --locked
cd web && pnpm install && pnpm dev           # web installer (web/README.md)
```

Every eFuse operation is manual ([docs/PROVISIONING.md](docs/PROVISIONING.md)); the firmware does not burn eFuses on first
boot (unlike upstream).

### Host tool

`multikey` (prebuilt archives in [GitHub Releases](https://github.com/mewisme/esp32-security-key/releases), or
`cd host && cargo build --release`):

```
multikey device list | info | status | version      # inventory and identity, add --json for scripts
multikey fido info | pin status                      # read-only
multikey fido pin set | change                       # FIDO PIN (set is irreversible without authenticatorReset)
multikey fido credentials list | delete --id HEX
multikey mkauth status | enroll | auth | list | revoke
multikey device rename "My Key"
```

Reference, exit codes and the Windows elevation rule: [docs/CLI.md](docs/CLI.md). Linux PAM module:
[docs/LINUX_PAM.md](docs/LINUX_PAM.md). Windows notes: [docs/WINDOWS.md](docs/WINDOWS.md).

### Hardware configuration

No GPIO is assumed by the firmware sources. The BOOT-button board profile is `boards/esp32s3-n16r8-boot-button.board` (copied to
`sdkconfig.board` by the flash script); other boards set `CONFIG_MULTIKEY_BUTTON_GPIO` and `CONFIG_MULTIKEY_LED_GPIO`
([docs/HARDWARE.md](docs/HARDWARE.md)); the build fails while they are unset. The default USB VID/PID is a development
placeholder. USB names and the development AAGUID: [docs/USB_IDENTITY.md](docs/USB_IDENTITY.md). First manual hardware run:
[docs/FIRST_RUN_WINDOWS.md](docs/FIRST_RUN_WINDOWS.md).

</details>

## Architecture and security

[ARCHITECTURE](docs/ARCHITECTURE.md) · [SECURITY](docs/SECURITY.md) · [HARDWARE](docs/HARDWARE.md) ·
[PROTOCOLS](docs/PROTOCOLS.md) · [DEVELOPMENT](docs/DEVELOPMENT.md) · [TESTING](docs/TESTING.md) ·
[PROVISIONING](docs/PROVISIONING.md) · [ROADMAP](docs/ROADMAP.md) · [RELEASES](docs/RELEASES.md) ·
[FLASHING_ADVANCED](docs/FLASHING_ADVANCED.md) · [BEGINNER_UX_AUDIT](docs/BEGINNER_UX_AUDIT.md) ·
[DEPENDENCIES](docs/DEPENDENCIES.md) · [ADR-0001](docs/ADR-0001-foundation.md) · [ADR-0002](docs/ADR-0002-separate-images.md)

Status matrix of every feature: [docs/ROADMAP.md](docs/ROADMAP.md). Hardware test reports: [docs/hw-reports/](docs/hw-reports/).

## License

AGPL-3.0-or-later (see `LICENSE`). The firmware builds on AGPL-3.0 projects by Pol Henarejos; their copyrights and licences
remain with their authors. If you distribute binaries, provide the corresponding source.
