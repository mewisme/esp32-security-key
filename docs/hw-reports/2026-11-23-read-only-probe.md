# 2026-11-23: read-only probe of the attached board (no firmware flashed)

Scope: identification only. **No functional test (FIDO, MKAUTH, button) was run; nothing was flashed; no eFuse was written.**
A probe via `esptool flash_id` resets the board once (RTS reset), nothing else.

Date: 2026-11-23
Host: Windows 11, ESP-IDF v5.5.6 (esptool 4.14.0)
Connection: native USB-Serial/JTAG, `USB\VID_303A&PID_1001`, enumerated as `USB Serial Device (COM6)` and
"USB JTAG/serial debug unit". No separate UART-bridge COM port belongs to this board (COM1/4/5 are unrelated).

Commands: `python -m esptool --chip esp32s3 -p COM6 flash_id`, `python tools\provision_check.py -p COM6`

Result (esptool):
- Chip ESP32-S3 (QFN56), revision v0.2, 40 MHz crystal, MAC 80:b5:4e:c8:22:78
- Features: WiFi, BLE, embedded PSRAM 8 MB (AP_3v3)
- Flash: manufacturer 0x68, device 0x4018, **16 MB**, quad (4 data lines), 3.3 V set by eFuse
- USB mode: USB-Serial/JTAG

Result (eFuse, read-only): all of SECURE_BOOT_EN, SPI_BOOT_CRYPT_CNT, DIS_USB_JTAG, DIS_PAD_JTAG, DIS_USB_SERIAL_JTAG,
DIS_DOWNLOAD_MODE, ENABLE_SECURITY_DOWNLOAD and the other download/JTAG bits read 0/False.
Classification by `provision_check.py`: **development (open)**; i.e. a blank board, as expected before first flash.

Consequences for the first run:
- The board's only visible USB connection here is the native port, so flashing is done through it (step 4 of
  FIRST_RUN_WINDOWS.md with `-p COM6`). esptool's USB-Serial/JTAG auto-reset worked, so no BOOT/RESET dance was needed
  for this probe.
- After the fido image starts, the native USB pins belong to the firmware's TinyUSB device (FIDO HID + CCID). The USB-Serial/JTAG
  COM port will disappear. To re-flash: hold BOOT, then replug / tap RESET, release BOOT.

Not verified: that the BOOT button on this board is wired to GPIO0 with a pull-up (needs a physical check or the first run);
whether the board has a second USB-C connector; the board vendor/model name.
