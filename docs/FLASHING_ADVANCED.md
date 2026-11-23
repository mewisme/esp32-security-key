# Flashing: how the script works, and the manual commands

There are three ways to install MultiKeys:

1. **Web installer** (beginners): https://multikeys.mewis.me in desktop Chrome/Edge flashes the prebuilt release firmware
   (from v0.2.0) with the same write allowlist as the script; it reads the board's chip, flash type and flash size and picks the
   4, 8 or 16 MB build itself. Run once on hardware (update path, one board, 16 MB); see `docs/ROADMAP.md`.
2. **Developer script** (verified): `.\tools\flash-dev.ps1`, described below.
3. **Manual** ESP-IDF/esptool commands, below; also for Linux/macOS and the OpenPGP image.

This page explains what the script checks, lists the equivalent manual commands and says what it deliberately cannot do.

## What `flash-dev.ps1` does

`flash-dev.ps1` is a thin Windows front end. It finds ESP-IDF v5.5.x (an explicit `-IdfPath` is used exclusively, else
`$env:IDF_PATH`, `C:\esp\v5.5.*`, `$HOME\esp\v5.5.*`; it never downloads or installs anything), activates it in a child
PowerShell, and runs `tools/flash_dev.py`, which holds every rule and is unit-tested (`python -m unittest discover tests/flash`).

| Step | What happens | Stops with |
|---|---|---|
| 1 prerequisites | Python 3.9+, git, ESP-IDF v5.5.x, `-AcknowledgeOpenPgpImage` for `-App openpgp` | 2 |
| 2 board config | creates `sdkconfig.board` from `boards/esp32s3-boot-button.board` when missing; an existing one is kept and must define `CONFIG_MULTIKEY_BUTTON_GPIO` (a GPIO other than 0 prints a warning) | 2 |
| 3 sources | initializes missing submodules, refuses submodules at another commit, applies the stacked patches (idempotent) | 2 |
| 4 device | finds exactly one ESP32-S3 download port (USB 303A:1001); UART bridges (CP210x, CH340/CH9102, FTDI) only through `-Port`; waits for download mode | 3 |
| 5 build | `python tools/build.py dev --app <app> --hw <profile>` (real pins, never `--ci-pins`), then checks the generated sdkconfig (target esp32s3, button GPIO set, no CI-pins option, no eFuse provisioning, no Secure Boot, no flash encryption), runs `check_no_irreversible.py`, and requires `flash_args` to write exactly 0x0, 0x8000 and 0x20000 with no image touching `nvs`, `phy_init` or `part0` | 5 |
| 6 identity | read-only `esptool flash_id` (must be an ESP32-S3 whose flash size equals the `-Hw` profile's; the error lists the supported sizes 4MB, 8MB, 16MB) and a read of the device partition table: blank flash or a table whose `nvs`, `phy_init` and `part0` match this build. Anything else (moved `part0`, unreadable or garbage table) stops | 5 |
| 7 confirm | prints board MAC, port, image size and SHA-256, the exact write list and what is not touched, then asks you to type `FLASH`. `-DryRun` ends here with "DRY RUN: nothing written" | 4 |
| 8 flash | the proven command: `python -m esptool --chip esp32s3 -p <port> -b 460800 --before default_reset --after watchdog_reset write_flash "@flash_args"` run in the build directory (`build-<app>-dev`, `build-<app>-dev-8mb` or `build-<app>-dev-4mb`) | 1 |
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
Copy-Item boards\esp32s3-boot-button.board sdkconfig.board
python tools\build.py dev                      # 16 MB profile, real pins, NOT --ci-pins
python tools\check_no_irreversible.py fido-dev
Set-Location build-fido-dev
python -m esptool --chip esp32s3 -p COM6 -b 460800 --before default_reset --after watchdog_reset write_flash "@flash_args"
```

Use the port you actually have (`Get-PnpDevice -Class Ports -PresentOnly`; native download mode is VID_303A&PID_1001).
`--after watchdog_reset` matters on the native port: with `hard_reset` the chip stayed in download mode.

Linux / macOS (not hardware verified by this project): activate ESP-IDF v5.5.6 (`. ~/esp/v5.5.6/export.sh`), run the same
`tools/build.py dev` steps, then `cd build-fido-dev && python -m esptool --chip esp32s3 -p /dev/ttyACMn -b 460800
--before default_reset --after watchdog_reset write_flash @flash_args`. The device node differs per system; check `dmesg`.

### Other flash sizes (hardware profiles)

The board's flash size must equal the build's: 16 MB is the default; 8 MB and 4 MB are separate profiles with separate build
directories ([HARDWARE_PROFILES.md](HARDWARE_PROFILES.md); 4 and 8 MB are build verified, not hardware tested):

```powershell
python tools\build.py dev --hw esp32s3-4mb --board esp32s3-boot-button --clean      # build-fido-dev-4mb
python tools\check_no_irreversible.py fido-dev-4mb
Set-Location build-fido-dev-4mb
python -m esptool --chip esp32s3 -p COM6 -b 460800 --before default_reset --after watchdog_reset write_flash "@flash_args"
```

`--board NAME` layers `boards/NAME.board` instead of the root `sdkconfig.board`; without either, no pin configuration is added
and a normal build fails by design. `--hw esp32s3-8mb` builds into `build-fido-dev-8mb`. Check the board first:
`python -m esptool --chip esp32s3 -p COM6 flash_id` must say `Detected flash size` equal to the profile (a 16 MB image on a 4 MB
board is refused by `flash-dev.ps1`; with manual commands the check is yours).

## Prebuilt release firmware without the web installer

Each firmware zip from GitHub Releases (`multikey-firmware-v<ver>-esp32s3-<4mb|8mb|16mb>-fido-dev.zip`; v0.2.0 published
`...-esp32s3-n16r8-fido-dev.zip`, the 16 MB build) contains a `README.txt` with
the exact command, e.g.
`python -m esptool --chip esp32s3 -p PORT write_flash 0x0 bootloader.bin 0x8000 partition-table.bin 0x20000 multikey-fido.bin`.
Check `sha256sum -c SHA256SUMS` inside the folder first. Never add an erase option.

## Recovering a board that has other firmware on it

`flash-dev.ps1` refuses a board whose partition table is neither blank nor the MultiKeys layout (typical for factory demo,
MicroPython or Arduino firmware), because it cannot know what that firmware stored. Options:

- **Web installer, "Repurpose this board"**: offered when the layout is foreign and no MultiKeys app is on the board. After
  you type `REPURPOSE` it fills `nvs` (0x11000, 24 KiB) and `part0` (0x200000, 1 MiB) with 0xFF and then writes the three
  MultiKeys images. Nothing else is erased.
- **Manually**, if you accept losing everything the old firmware stored:
  `python -m esptool --chip esp32s3 -p PORT erase_region 0x11000 0x6000` and
  `python -m esptool --chip esp32s3 -p PORT erase_region 0x200000 0x100000`, then flash as above. The script never runs these
  for you.

A board whose foreign layout still runs MultiKeys (an incompatible earlier layout) is refused by both tools; ask for help
before erasing anything there, because `part0` holds its credentials.

## Download mode

Unplug, hold BOOT, plug in, release BOOT (BOOT+RST works on boards with an RST button). While the firmware runs, the native USB
port belongs to it and no COM port exists.

## Checking the WebUSB landing page

The firmware advertises `MULTIKEY_WEBUSB_LANDING_URL` (default `https://multikeys.mewis.me`, the web installer; keys flashed
before v0.2.0 keep advertising the old GitHub URL until reflashed) as a WebUSB landing page. Static
check of a build: `python tools/check_usb_descriptors.py`. Read-only check of a running key:
`python tools/check_usb_descriptors.py --live` (needs `pip install pyusb libusb-package` and a libusb-accessible interface;
see the tool's help). To drop the capability set `CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED=n` in `sdkconfig.board`.
