# Hardware

Target: generic **ESP32-S3 N16R8** devkit (16 MB flash, 8 MB octal PSRAM) with the native USB OTG port
(GPIO19 = D-, GPIO20 = D+) connected to the host. The UART/USB-bridge port is only for flashing and logs.

## What you must choose

No pin assignments are assumed. Choose them and put them in `sdkconfig.board` (git-ignored):

```
CONFIG_MULTIKEY_BUTTON_GPIO=<n>
CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW=y     # button to GND, internal pull-up
CONFIG_MULTIKEY_LED_GPIO=<n>
CONFIG_MULTIKEY_LED_TYPE_PLAIN=y        # or CONFIG_MULTIKEY_LED_TYPE_WS2812=y
```

Avoid pins used by flash/octal PSRAM on N16R8 modules (GPIO26-37 are not usable), USB (19, 20), and be careful with
strapping pins (0, 3, 45, 46). Check your board's schematic. The build fails while a pin is -1.

## Limits you should know

- The ESP32-S3 is **not a secure element**. Keys are decrypted in internal RAM while in use. Flash encryption and
  Secure Boot (production profile, operator-enabled) protect against dumping and modification of flash only.
- No hardware ECC accelerator is used for FIDO/OpenPGP curves; ECC/EdDSA run in software, so operations take noticeably
  longer than on dedicated key chips (not yet measured on hardware).
- PSRAM is intentionally unused.

## USB identity

Default VID:PID `0x303A:0x4002` is a **development placeholder only; do not distribute** devices with it. Obtain your own
VID/PID before distributing (Kconfig `MULTIKEY_USB_VID` / `MULTIKEY_USB_PID`).
