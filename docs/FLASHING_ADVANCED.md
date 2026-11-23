# Flashing: how the script works, and the manual commands

The one-command path is `.\tools\flash-dev.ps1` (see the README). This page explains what it checks, lists the
equivalent manual commands (also for Linux/macOS) and says what it deliberately cannot do.

## What `flash-dev.ps1` does

`flash-dev.ps1` is a thin Windows front end. It finds ESP-IDF v5.5.x (an explicit `-IdfPath` is used exclusively, else
`$env:IDF_PATH`, `C:\esp\v5.5.*`, `$HOME\esp\v5.5.*`; it never downloads or installs anything), activates it in a child
PowerShell, and runs `tools/flash_dev.py`, which holds every rule and is unit-tested (`python -m unittest discover tests/flash`).

| Step | What happens | Stops with |
|---|---|---|
| 1 prerequisites | Python 3.9+, git, ESP-IDF v5.5.x, `-AcknowledgeOpenPgpImage` for `-App openpgp` | 2 |
| 2 board config | creates `sdkconfig.board` from `boards/esp32s3-n16r8-boot-button.board` when missing; an existing one is kept and must define `CONFIG_MULTIKEY_BUTTON_GPIO` (a GPIO other than 0 prints a warning) | 2 |
| 3 sources | initializes missing submodules, refuses submodules at another commit, applies the stacked patches (idempotent) | 2 |
| 4 device | finds exactly one ESP32-S3 download port (USB 303A:1001); UART bridges (CP210x, CH340/CH9102, FTDI) only through `-Port`; waits for download mode | 3 |
| 5 build | `python tools/build.py dev --app <app>` (real pins, never `--ci-pins`), then checks the generated sdkconfig (target esp32s3, button GPIO set, no CI-pins option, no eFuse provisioning, no Secure Boot, no flash encryption), runs `check_no_irreversible.py`, and requires `flash_args` to write exactly 0x0, 0x8000 and 0x20000 with no image touching `nvs`, `phy_init` or `part0` | 5 |
| 6 identity | read-only `esptool flash_id` (must be ESP32-S3 with 16 MB) and a read of the device partition table: blank flash or a table whose `nvs`, `phy_init` and `part0` match this build. Anything else (moved `part0`, unreadable or garbage table) stops | 5 |
| 7 confirm | prints board MAC, port, image size and SHA-256, the exact write list and what is not touched, then asks you to type `FLASH`. `-DryRun` ends here with "DRY RUN: nothing written" | 4 |
| 8 flash | the proven command: `python -m esptool --chip esp32s3 -p <port> -b 460800 --before default_reset --after watchdog_reset write_flash "@flash_args"` run in `build-<app>-dev` | 1 |
| 9 verify | waits up to 20 s for 303A:4002 and requires two HID interfaces, a CCID reader and a WinUSB interface via `tools/usb_identity.py --json` | 6 |

Exit codes: 0 PASS/dry run, 1 failure, 2 prerequisite/arguments, 3 no or ambiguous device, 4 declined, 5 storage-safety stop,
6 verification FAIL.

### What it cannot do, on purpose

- No `-Yes`, no production or hardening option, no eFuse, Secure Boot or flash-encryption action.
- No `erase_flash`, `erase_region` or `--erase-all`: the commands are built from an allowlist and the script refuses any argv
  containing those tokens (unit-tested).
- No override for the storage-safety stop (exit 5). If your device has a different layout (an older firmware with another
  partition table, a moved `part0`), credential preservation cannot be established. Do not work around it with a manual flash
  unless you accept losing the credentials, and back up what you can first (the key cannot export its credentials).
- It does not reset the authenticator, set a PIN or create credentials.
- It never flashes a `--ci-pins` image (that image refuses to run anyway).
- The OpenPGP image shares the `part0` file system with different applets. Credentials, PINs and keys from the FIDO image are not
  usable and may be lost or mis-read; the script requires `-AcknowledgeOpenPgpImage` and still asks for `FLASH`.

### Why `part0` survives

The credential store lives in the `part0` data partition at 0x200000 (1 MiB). The three images the script writes end below
0x200000 (the app partition `factory` ends at 0x200000), and the script has checked on both sides that `part0`'s offset and
size are the same on the device and in this build before writing. Flashing never erases outside the written ranges.
[INFERENCE] "survives" is established by this layout argument and by earlier hardware runs where a flashed update kept credential
state (`tools/ctap_survival.py snapshot|verify`); resident-credential survival across a flash was never exercised on hardware.

## Manual commands

Windows (what `FIRST_RUN_WINDOWS.md` verified):

```powershell
. C:\esp\v5.5.6\export.ps1
git submodule update --init
Copy-Item boards\esp32s3-n16r8-boot-button.board sdkconfig.board
python tools\build.py dev                      # real pins, NOT --ci-pins
python tools\check_no_irreversible.py fido-dev
Set-Location build-fido-dev
python -m esptool --chip esp32s3 -p COM6 -b 460800 --before default_reset --after watchdog_reset write_flash "@flash_args"
```

Use the port you actually have (`Get-PnpDevice -Class Ports -PresentOnly`; native download mode is VID_303A&PID_1001).
`--after watchdog_reset` matters on the native port: with `hard_reset` the chip stayed in download mode.

Linux / macOS (not hardware verified by this project): activate ESP-IDF v5.5.6 (`. ~/esp/v5.5.6/export.sh`), run the same
`tools/build.py dev` steps, then `cd build-fido-dev && python -m esptool --chip esp32s3 -p /dev/ttyACMn -b 460800
--before default_reset --after watchdog_reset write_flash @flash_args`. The device node differs per system; check `dmesg`.

## Download mode

Unplug, hold BOOT, plug in, release BOOT (BOOT+RST works on boards with an RST button). While the firmware runs, the native USB
port belongs to it and no COM port exists.

## Checking the WebUSB landing page

The firmware advertises `MULTIKEY_WEBUSB_LANDING_URL` (default the project's GitHub page) as a WebUSB landing page. Static
check of a build: `python tools/check_usb_descriptors.py`. Read-only check of a running key:
`python tools/check_usb_descriptors.py --live` (needs `pip install pyusb libusb-package` and a libusb-accessible interface;
see the tool's help). To drop the capability set `CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED=n` in `sdkconfig.board`.
