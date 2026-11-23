# First run on Windows: FIDO2 over USB HID with the BOOT button

Goal: get the `fido` image running on one ESP32-S3 N16R8 devkit and pass the first smoke test. Nothing in this document
flashes, fuses or modifies a board by itself: you run each command. The development image **never writes eFuses** and has
Secure Boot and flash encryption off.

Status of everything below: **written, never run on hardware** (no board was available when this was written). Paste the
output of your run into `docs/hw-reports/` (template in that folder's README) and tell us what differed.

Read [HARDWARE.md](HARDWARE.md) "Verify physically" first (BOOT circuit, which USB-C port is the native one).

Conventions: COM5 is an example; use your port. All commands run in PowerShell.

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

## 2. Find the serial (flashing) port

Plug in the USB-C port you intend to flash through and run:

```powershell
Get-PnpDevice -Class Ports -PresentOnly | Format-Table Status, FriendlyName, InstanceId
```

Note the `COMx`. A UART/COM port with a bridge chip shows up as CP210x / CH340 / similar. The **native** port shows up as
`USB Serial Device` with `VID_303A&PID_1001` (the chip's own USB-Serial/JTAG); esptool resets and flashes through it
too. On the board probed on 2026-11-23 (`docs/hw-reports/2026-11-23-read-only-probe.md`) only the native port was present,
as COM6, and esptool worked through it without any button handling.

Important: once the fido image runs, the firmware takes over the native USB pins and that COM port **disappears**. To flash
again, hold BOOT, then replug or tap RESET, release BOOT (the ROM then exposes the COM port again).

## 3. Read-only probe (changes nothing)

```powershell
python -m esptool --chip esp32s3 -p COM5 flash_id
python tools\provision_check.py -p COM5
```

Expect `Detected flash size: 16MB` and a fuse classification of `development (open)`. If the flash size differs, stop and
tell us: the image is built for 16 MB.

## 4. Flash (your decision to run this)

```powershell
Set-Location build-fido-dev
python -m esptool --chip esp32s3 -p COM5 -b 460800 --before default_reset --after hard_reset write_flash "@flash_args"
Set-Location ..
```

This writes the bootloader, partition table and application (flash only; no eFuse is touched). It leaves the key-storage
partition as is. To start from empty key storage first (erases all flash, still no eFuses):
`python -m esptool --chip esp32s3 -p COM5 erase_flash`.

If the board does not enter download mode by itself: hold **BOOT**, tap **RESET**, release BOOT, rerun the command.

## 5. Check enumeration as a FIDO key

After flashing the tool already hard-reset the chip (`--after hard_reset`). If you flashed through a UART/COM bridge, unplug
it and plug the **native USB** port (GPIO19/20) in. If you flashed through the native port, just wait a few seconds (or
replug it, BOOT *not* held): the COM port vanishes and the FIDO device appears.

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\VID_303A&PID_4002*' } |
    Format-Table Status, Class, FriendlyName, InstanceId
```

Expect entries for the composite device with an HID interface (FIDO) and a smart-card/CCID interface (`MI_xx`). VID:PID
`303A:4002` is the development placeholder. If nothing appears: wrong connector, board still in download mode (VID `303A`
PID `1001`), or the firmware did not start; open the UART console:

```powershell
python -m serial.tools.miniterm COM5 115200      # on the UART/COM port, Ctrl+] to quit
```

## 6. First FIDO2 smoke test

python-fido2 needs an **elevated** PowerShell to open FIDO HID devices on Windows (documented by python-fido2; confirm on
your machine). Open PowerShell as Administrator, then:

```powershell
Set-Location I:\Project\esp32\security-key
python -m venv .venv
.\.venv\Scripts\python -m pip install -r tools\requirements.txt
.\.venv\Scripts\python tools\ctap_smoke.py
```

When the script asks to touch the key, **press and release BOOT once**. A press that started before the request, or a button
held down, is ignored on purpose. There is no LED by default, so nothing blinks: watch the script output. Each request waits
15 s.

Without `--pin` the PIN steps are skipped. To test PIN set/verify/change, choose a PIN yourself (never reuse a real one):
`.\.venv\Scripts\python tools\ctap_smoke.py --pin <your-test-pin>`. If the device has no PIN, this **sets** it.
`--reset` wipes the device and needs `--yes-wipe-device`; do not use it unless you mean it.

Expected result: `PASS` lines for GetInfo and the makeCredential/getAssertion round trip, exit code 0. `GetInfo` is printed
so we can see which CTAP versions and algorithms (EdDSA) the firmware really advertises. This is **not** a conformance test.

## 7. Report

Save the output as `docs/hw-reports/<date>-first-run.md` with board model, what each USB-C port is, the BOOT circuit check,
and the `GetInfo` output. Only after that may ROADMAP.md move FIDO2 to "Hardware verified".

## Native-port-only flashing (no UART/COM bridge)

Hold BOOT, plug the native port in (or tap RESET), release BOOT: the ROM exposes a "USB JTAG/serial" device (VID `303A`
PID `1001`) with a COM port. Use that COM port in step 4. After flashing, press RESET (BOOT not held) to start the key.
Whether your board supports this was not verified.
