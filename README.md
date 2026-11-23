# ESP32-S3 MultiKeys

Open-source USB security key firmware for the ESP32-S3 (target board: generic **ESP32-S3 N16R8** devkit, 16 MB flash,
native USB OTG), plus Rust host tools.

> **Status: early development, tested on one board only.** The fido image runs on an ESP32-S3 N16R8 (Windows 11): it enumerates, passes
> basic CTAP2/U2F checks and enforces a real button press (see [docs/hw-reports/](docs/hw-reports/)). Most features are still
> untested; the host tools otherwise pass unit tests against a mock device. See [docs/ROADMAP.md](docs/ROADMAP.md) for the status
> matrix. Do not use it to protect real accounts. The ESP32-S3 is not a secure element ([docs/SECURITY.md](docs/SECURITY.md)).
>
> Touch-only use, PIN prompts and the PIN trade-off: [docs/FIDO_UV.md](docs/FIDO_UV.md). USB names, renaming
> (`multikey device rename`) and the development AAGUID: [docs/USB_IDENTITY.md](docs/USB_IDENTITY.md).

## What it is

Two firmware images, built from one tree on top of the AGPL-3.0 [Pico Keys](https://github.com/polhenarejos) projects:

| Image (`--app`) | Provides | Status |
|---|---|---|
| `fido` | FIDO2/CTAP2 + U2F over USB HID (upstream pico-fido v8.2), OATH/OTP applets, **MKAUTH** custom challenge-response applet over CCID | Basic FIDO2 flow and user presence hardware verified on one board (Windows 11); MKAUTH SELECT/GET_INFO verified; everything else untested |
| `openpgp` | OpenPGP card + PIV over CCID (upstream pico-openpgp main `9b23276`) | Build verified; not hardware verified |

A single merged FIDO+OpenPGP image is **Blocked** ([ADR-0002](docs/ADR-0002-separate-images.md)).

Host side ([host/](host/README.md)): Rust crates `multikey-proto`, `multikey-host`, `multikey-cli` (enroll / auth / revoke via
PC/SC) and a Linux PAM module `multikey-pam` ([docs/LINUX_PAM.md](docs/LINUX_PAM.md)). Windows: see
[docs/WINDOWS.md](docs/WINDOWS.md) (Credential Provider not implemented).

SSH `*-sk` keys and Git SSH signing use the FIDO2 function and need no extra firmware; test procedures are in
[docs/PROTOCOLS.md](docs/PROTOCOLS.md) and [docs/TESTING.md](docs/TESTING.md) (pending hardware).

No CTAP 2.1 or FIDO certification claim is made. Attestation is development-only.

## Flash in 3 steps (Windows, ESP32-S3 N16R8)

One-time prerequisites: [ESP-IDF v5.5.6 for Windows](https://docs.espressif.com/projects/esp-idf/en/v5.5.6/esp32s3/get-started/windows-setup.html),
Python 3.9+ and Git. The script never downloads or installs anything.

```powershell
git clone --recurse-submodules https://github.com/mewisme/esp32-security-key
cd esp32-security-key
.\tools\flash-dev.ps1
```

Existing checkout: `git submodule update --init`, then `.\tools\flash-dev.ps1`.

1. Connect the board's **native USB** port (the one labelled USB, not UART/COM).
2. Run `.\tools\flash-dev.ps1` and follow the prompts: hold BOOT while plugging in when asked, then type `FLASH`.
   `-DryRun` does everything except the write.
3. Verify: `python tools\usb_identity.py` or `multikey device info`. Expected: HID (FIDO) + CCID + WinUSB interfaces and the name
   `MultiKeys Security Key`.

The script builds the development image, identifies the board, checks that the device's partition table matches
(so the credential store `part0` is preserved), shows exactly what it will write and asks for the typed confirmation. It writes
only the bootloader, partition table and app. It never erases flash, resets the authenticator, sets a PIN or touches eFuses,
and has no switch to skip the confirmation. Details, manual commands and Linux/macOS: [docs/FLASHING_ADVANCED.md](docs/FLASHING_ADVANCED.md).

Troubleshooting:

- *No COM port*: use the native USB port and a data cable; hold BOOT while plugging in (or BOOT+RST). Download mode shows up as
  `USB Serial Device (COMn)` with USB id 303A:1001. The script picks COM numbers itself; pass `-Port COMn` only for a UART bridge.
- *Native vs UART port*: the UART/COM port (CP210x/CH340) is not the key's USB interface; the key only appears on the native port.
- *Drivers*: none to install. WinUSB binds automatically through the firmware's Microsoft OS 2.0 descriptor and CCID uses the
  Windows inbox driver.
- *BOOT button*: BOOT is GPIO0, active low, and is also the key's user-presence button (`boards/esp32s3-n16r8-boot-button.board`).
- *COM port vanishes after flashing*: expected, the firmware takes over the USB port. If the key does not enumerate within
  15 s, unplug and replug it.
- *FIDO commands cannot see the key on Windows*: Windows only lets elevated processes open FIDO HID devices. Run
  `multikey fido ...` and `multikey device info` from an Administrator terminal.

The OpenPGP image is a different product with the same storage layout; it is selected only with
`-App openpgp -AcknowledgeOpenPgpImage` and its data is not compatible with the FIDO image.
Prebuilt flash-only firmware is not available: no firmware is published with the host-tool releases.

## Hardware

No GPIO is assumed by the firmware sources. The BOOT-button board profile is `boards/esp32s3-n16r8-boot-button.board`
(copied to `sdkconfig.board` by the flash script); other boards set `CONFIG_MULTIKEY_BUTTON_GPIO` and `CONFIG_MULTIKEY_LED_GPIO`
([docs/HARDWARE.md](docs/HARDWARE.md)); the build fails while they are unset. The default USB VID/PID is a development
placeholder and must not be used for distribution. The first manual hardware run is in
[docs/FIRST_RUN_WINDOWS.md](docs/FIRST_RUN_WINDOWS.md).

## Host tool

`multikey` (prebuilt Windows/Linux archives in [GitHub Releases](https://github.com/mewisme/esp32-security-key/releases) once a
release exists, see [docs/RELEASES.md](docs/RELEASES.md); or `cd host && cargo build --release`):

```
multikey device list | info | status | version      # inventory and identity, add --json for scripts
multikey fido info | pin status                      # read-only
multikey fido pin set | change                       # FIDO PIN (set is irreversible without authenticatorReset)
multikey fido credentials list | delete --id HEX
multikey mkauth status | enroll | auth | list | revoke
multikey device rename "My Key"
```

Full reference, exit codes and the Windows elevation rule: [docs/CLI.md](docs/CLI.md).

## Build

Prerequisite: ESP-IDF v5.5.6 activated (`idf.py` on PATH), see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```
python tools/build.py dev --ci-pins          # compile check; the image refuses to be usable
python tools/build.py dev                    # real build, needs sdkconfig.board with your GPIOs
python tools/build.py prod --app openpgp
cd host && cargo test --locked
```

Every eFuse operation is manual, see [docs/PROVISIONING.md](docs/PROVISIONING.md). The firmware does **not**
burn eFuses on first boot (unlike upstream); that behaviour is opt-in.

## Documentation

[ARCHITECTURE](docs/ARCHITECTURE.md) · [HARDWARE](docs/HARDWARE.md) · [SECURITY](docs/SECURITY.md) ·
[PROTOCOLS](docs/PROTOCOLS.md) · [DEVELOPMENT](docs/DEVELOPMENT.md) · [TESTING](docs/TESTING.md) ·
[PROVISIONING](docs/PROVISIONING.md) · [ROADMAP](docs/ROADMAP.md) · [LINUX_PAM](docs/LINUX_PAM.md) ·
[CLI](docs/CLI.md) · [RELEASES](docs/RELEASES.md) · [FLASHING_ADVANCED](docs/FLASHING_ADVANCED.md) ·
[WINDOWS](docs/WINDOWS.md) · [FIRST_RUN_WINDOWS](docs/FIRST_RUN_WINDOWS.md) · [DEPENDENCIES](docs/DEPENDENCIES.md) · [ADR-0001](docs/ADR-0001-foundation.md) ·
[ADR-0002](docs/ADR-0002-separate-images.md)

## License

AGPL-3.0-or-later (see `LICENSE`). The firmware builds on AGPL-3.0 projects by Pol Henarejos; their copyrights and
licences remain with their authors. If you distribute binaries, provide the corresponding source.
