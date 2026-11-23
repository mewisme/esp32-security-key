# Hardware

Target: generic **ESP32-S3 N16R8** devkit (16 MB quad flash, 8 MB octal PSRAM). The firmware uses the chip's **native USB
OTG** (GPIO19 = D-, GPIO20 = D+) for the FIDO HID and CCID interfaces. Nothing about the board's connectors, LEDs or buttons
is assumed beyond what is listed under "Verify physically".

## First hardware setup (simplest path): BOOT button, no LED, no extra parts

`boards/esp32s3-n16r8-boot-button.board` selects:

```
CONFIG_MULTIKEY_BUTTON_GPIO=0          # the onboard BOOT button
CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW=y    # pressed = LOW
CONFIG_MULTIKEY_LED_TYPE_NONE=y        # no LED at all
```

Copy it to `sdkconfig.board` (git-ignored) and build. Step-by-step PowerShell commands: [FIRST_RUN_WINDOWS.md](FIRST_RUN_WINDOWS.md).

### How GPIO0 is handled

GPIO0 is a strapping pin: its level is sampled **only while the chip leaves reset**. If it is LOW then, the ROM enters
download mode instead of booting the firmware. After boot it is an ordinary GPIO.

- The firmware configures GPIO0 as an **input with the internal pull-up** and never drives it, so it cannot fight the
  board's BOOT circuit and cannot change the strapping level seen at the next reset.
- Pressing BOOT while the key is running does nothing to the chip except what the firmware does with it (answer a
  user-presence request). It does not reset the board, drop USB, or enter download mode.
- Normal boot, USB enumeration and `esptool` flashing do not depend on the firmware's GPIO0 setup: flashing uses the ROM
  bootloader before our code runs.
- **Do not hold BOOT while plugging in or pressing RESET** unless you want download mode (that is how you re-flash by hand).
- GPIO0 is enforced active-low at build time; pins 19/20/26-37 are rejected; pins 3/45/46 need an explicit acknowledgement.
- The build option cannot disable user presence. A request waits up to `CONFIG_MULTIKEY_UP_TIMEOUT_MS` (15 s) for a press
  **and release** of the button that *starts after the request begins*: a button already held when the request starts, or
  held down, does not count (patch 0001, `async_button_armed`).

### Verify physically (do not skip, nothing below is assumed)

1. **BOOT circuit.** With the board unpowered, a continuity/resistance check between GPIO0 and GND should read open when the
   button is released and ~0 ohm when pressed; with power, GPIO0 should read ~3.3 V released (external pull-up). If your
   board has no BOOT button, or wires it differently, choose another pin and an external button.
2. **USB connectors.** Many N16R8 boards have two USB-C ports: one labelled UART/COM (USB-UART bridge, used for flashing and
   the log console) and one labelled USB (native, GPIO19/20). Some have only one. **The FIDO key needs the native port.** If
   your board has only a bridge port, GPIO19/20 are not on a connector and FIDO over USB needs wiring to them.
   `Get-PnpDevice -Class Ports` after plugging each connector shows which one is a bridge (CP210x / CH340 / etc.) and which
   is "USB Serial Device" with VID 303A (the ROM's USB-Serial-JTAG while in download mode).
3. **Flash and PSRAM size.** `esptool flash_id` should report 16 MB; `chip_id`/boot log should show the ESP32-S3 revision. The
   firmware keeps PSRAM disabled (key material never goes to external RAM), so PSRAM is simply unused.
4. **Console.** The firmware console is UART0 (GPIO43/44), reachable through the bridge port only on boards wired that way.
   No console is available on the native USB port while the firmware uses it for FIDO.
5. **LED.** Boards often have a WS2812 or a plain LED, but its GPIO varies between vendors/revisions. The default here is
   no LED. To use one, read your board schematic, then set `CONFIG_MULTIKEY_LED_TYPE_WS2812` or `..._PLAIN` and
   `CONFIG_MULTIKEY_LED_GPIO`. **Without an LED nothing indicates that the key is waiting**: the browser or tool prompt
   ("touch your security key") is the only cue; press BOOT once, briefly.

## Using a different button or an LED

```
CONFIG_MULTIKEY_BUTTON_GPIO=<n>
CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW=y
CONFIG_MULTIKEY_LED_TYPE_PLAIN=y        # or CONFIG_MULTIKEY_LED_TYPE_WS2812=y
CONFIG_MULTIKEY_LED_GPIO=<n>
CONFIG_MULTIKEY_LED_ACTIVE_LOW=y        # plain LED only, if lit when LOW
```

With an LED type selected the build fails while `MULTIKEY_LED_GPIO` is -1. With the button unset the build always fails.

## Compatibility levels

Same rows as the web installer's board step (`web/src/lib/compatibility/boards.ts`). The installer also checks chip and flash
size electronically before writing.

| Board | Level | Why |
|---|---|---|
| ESP32-S3 N16R8 devkit with two USB ports and a BOOT button | Tested | firmware hardware verified on this board type with the developer script |
| Other ESP32-S3 board with 16 MB flash, native USB and BOOT on GPIO0 | Expected to work | same chip, flash size and button wiring; not tested |
| ESP32-S3 with 4 or 8 MB flash | Not supported | the partition layout needs 16 MB |
| ESP32, ESP32-S2, ESP32-C3, ESP32-C6, ESP32-H2 | Not supported | MultiKeys runs on the ESP32-S3 only |
| Board without a native USB connector (USB-to-serial chip only) | Not supported | the key needs the chip's own USB (GPIO19/20) |
| Not sure | Checked during install | read the module marking (N16 = 16 MB); the installer stops on a wrong chip or flash size |

## Limits you should know

- The ESP32-S3 is **not a secure element**. Keys are decrypted in internal RAM while in use. Flash encryption and Secure Boot
  (production hardening, operator-enabled, never in development) protect against flash dumping and modification only.
- ECC/EdDSA run in software on the CPU; operations take noticeably longer than on dedicated key chips (not yet measured).
- PSRAM is intentionally unused.

## USB identity

Default VID:PID `0x303A:0x4002` is a **development placeholder only; do not distribute** devices with it. Obtain your own
VID/PID before distributing (Kconfig `MULTIKEY_USB_VID` / `MULTIKEY_USB_PID`).

Manufacturer `MultiKeys`, default product name `MultiKeys Security Key` (Kconfig `MULTIKEY_USB_MANUFACTURER`,
`MULTIKEY_USB_PRODUCT_NAME`); the user can rename the device at run time (`multikey device rename`). Every string, the Windows
behaviour and the limits (ASCII only, 31 characters, no string for the WinUSB interface) are in `docs/USB_IDENTITY.md`.
