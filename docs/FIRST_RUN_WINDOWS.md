# First run on Windows: FIDO2 over USB HID with the BOOT button

Goal: run the `fido` image on one ESP32-S3 N16R8 devkit and pass the first smoke test. Nothing in this document flashes,
fuses or modifies a board by itself: you run each command. The development image **never writes eFuses**; Secure Boot and
flash encryption are off.

Status: these steps were executed on one real board on 2026-11-23 (see
[hw-reports/2026-11-23-first-run.md](hw-reports/2026-11-23-first-run.md)); anything differing on your board is news we want.

Read [HARDWARE.md](HARDWARE.md) "Verify physically" first (BOOT circuit, which USB-C port is native).
COM6 below is the port seen on the tested board; use yours. All commands run in PowerShell.

## 1. Build (no board needed)

```powershell
Set-Location I:\Project\esp32\security-key
. C:\esp\v5.5.6\export.ps1                      # activates ESP-IDF v5.5.6 in this session
git submodule update --init
Copy-Item boards\esp32s3-n16r8-boot-button.board sdkconfig.board
python tools\build.py dev --clean               # real pins, NOT --ci-pins
python tools\check_no_irreversible.py fido-dev  # must print PASS
```

Expected: `multikey-fido.bin binary size ... (about 68% free)` and `PASS: no irreversible provisioning option enabled...`.

## 2. Find the flashing port

```powershell
Get-PnpDevice -Class Ports -PresentOnly | Format-Table Status, FriendlyName, InstanceId
```

A UART/COM port with a bridge chip shows as CP210x / CH340 / similar. The **native** port shows as `USB Serial Device` with
`VID_303A&PID_1001` (the chip's own USB-Serial/JTAG); esptool resets and flashes through it. On the tested board only the
native port existed (COM6).

**Once the fido image runs, the firmware owns the native USB pins and that COM port disappears.** To flash again put the
chip in download mode: unplug, hold **BOOT**, plug in, release BOOT (a RESET button with BOOT held works too).

## 3. Read-only probe (changes nothing)

```powershell
python -m esptool --chip esp32s3 -p COM6 flash_id
python tools\provision_check.py -p COM6
```

Expect `Detected flash size: 16MB` and `development (open)`. If the flash size differs, stop: the image is built for 16 MB.

## 4. Flash (your decision to run this)

```powershell
Set-Location build-fido-dev
python -m esptool --chip esp32s3 -p COM6 -b 460800 --before default_reset --after watchdog_reset write_flash "@flash_args"
Set-Location ..
```

This writes the bootloader, partition table and application only (no eFuse; the key-storage partition is untouched).
`--after watchdog_reset` matters on the native port: with `hard_reset` the chip stayed in download mode on the tested board
(`boot:0x23 DOWNLOAD(USB/UART0)`) and needed a normal power-cycle. If the board still shows `VID_303A&PID_1001` after
flashing, unplug and replug it **without** BOOT held.

## 5. Check enumeration

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\VID_303A&PID_4002*' } |
    Format-Table Status, Class, FriendlyName, InstanceId
```

Tested result: a composite device with two HID interfaces (FIDO, keyboard for the OTP applet), a CCID smart-card reader
(`Microsoft Usbccid Smartcard Reader`) and a WinUSB interface. VID:PID `303A:4002` is the development placeholder.
No console is available on the native port. Boot logs only appear on UART0 (GPIO43/44) if your board exposes it:

```powershell
python -m serial.tools.miniterm COMx 115200      # the UART/COM bridge port, Ctrl+] to quit
```

## 6. FIDO2 tests

python-fido2 needs administrator rights to open FIDO HID devices on Windows (confirmed on the tested machine: nothing is
listed without elevation). `tools\run_elevated.ps1` runs a script elevated (UAC prompt) and keeps a UTF-8 log in the repo root:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r tools\requirements.txt

# 6a. User presence, interactive. Do not touch the board in phase A; follow the prompts (press BOOT only when told).
.\tools\run_elevated.ps1 tools\ctap_up_test.py

# 6b. Smoke test. Press and release BOOT each time it prints "touch the device button now" (15 s limit, no LED).
.\tools\run_elevated.ps1 tools\ctap_smoke.py --skip-eddsa
```

- 6a expects: phase A fails after about 15 s (`OPERATION_DENIED`), phase B succeeds after your press, phase C (button held down
  before the request) fails. This checks that user presence is real. `--only-a --repeat-a 4` repeats the no-touch phase as a
  spurious-press check.
- 6b needs two touches (makeCredential, getAssertion). Without a PIN, the resident test credential for `multikey.test` stays
  on the key (credential management needs a PIN). Drop `--skip-eddsa` to also test EdDSA (two more touches, one more credential).
- Without `--pin` the PIN steps are skipped. With `--pin <test-pin>` the script **sets** the PIN if none exists.
  `--reset` wipes the device and needs `--yes-wipe-device`; do not use it unless you mean it.

Read-only check of the CCID/MKAUTH applet (no state change):

```powershell
Set-Location host
cargo run -q -p multikey-cli -- readers
cargo run -q -p multikey-cli -- status
```

## 7. Report

Save the output as `docs/hw-reports/<date>-<topic>.md` with board model, which USB-C port is native, and the BOOT circuit check.

## If something fails

- `No CTAPHID device found`: not elevated, or the board is in download mode (`PID_1001`), or the native port is not connected.
- A request succeeds in the no-touch phase: do not use the device; report it. (One such result was seen once, see the hardware
  report, and could not be reproduced in 5 later no-touch runs.)
- `OPERATION_DENIED` on a touch step: the 15 s window passed before you pressed; press when the prompt appears.
