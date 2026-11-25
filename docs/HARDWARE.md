# Hardware

Target: ESP32-S3 devkits with **4, 8 or 16 MB quad-SPI flash** ([HARDWARE_PROFILES.md](HARDWARE_PROFILES.md)). Hardware
verification so far is one **ESP32-S3 N16R8** board (16 MB quad flash, 8 MB octal PSRAM). The firmware uses the chip's **native USB
OTG** (GPIO19 = D-, GPIO20 = D+) for the FIDO HID and CCID interfaces. Nothing about the board's connectors, LEDs or buttons
is assumed beyond what is listed under "Verify physically".

## First hardware setup (simplest path): BOOT button, no LED, no extra parts

`boards/esp32s3-boot-button.board` (any ESP32-S3 devkit with the standard BOOT button; used by every flash profile) selects:

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
3. **Flash and PSRAM size.** `esptool flash_id` should report 4, 8 or 16 MB, the profile you build or install (the flash script and
   the web installer refuse any other size); `chip_id`/boot log should show the ESP32-S3 revision. The
   firmware keeps PSRAM disabled (key material never goes to external RAM), so PSRAM is simply unused.
4. **Console.** The firmware console is UART0 (GPIO43/44), reachable through the bridge port only on boards wired that way.
   No console is available on the native USB port while the firmware uses it for FIDO.
5. **LED.** Boards often have a WS2812 or a plain LED, but its GPIO varies between vendors/revisions. The default here is
   no LED. To use one, read your board schematic, then set `CONFIG_MULTIKEY_LED_TYPE_WS2812` or `..._PLAIN` and
   `CONFIG_MULTIKEY_LED_GPIO`. **Without an LED nothing indicates that the key is waiting**: the browser or tool prompt
   ("touch your security key") is the only cue; press BOOT once, briefly. Patterns: [Status LED](#status-led).

## Using a different button or an LED

```
CONFIG_MULTIKEY_BUTTON_GPIO=<n>
CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW=y
CONFIG_MULTIKEY_LED_TYPE_PLAIN=y        # or CONFIG_MULTIKEY_LED_TYPE_WS2812=y
CONFIG_MULTIKEY_LED_GPIO=<n>
CONFIG_MULTIKEY_LED_ACTIVE_LOW=y        # plain LED only, if lit when LOW
```

With an LED type selected the build fails while `MULTIKEY_LED_GPIO` is -1. With the button unset the build always fails.

## Status LED

Status: Implemented, build verified (no LED, WS2812, plain), host unit tested (state machine). **Not hardware verified**: no
board's LED GPIO has been identified yet. The LED only observes state; a missing or failed LED changes nothing in FIDO, PIN, UV or
user-presence handling. It is dark when idle and while USB is suspended or unplugged.

| Situation | Colour LED (WS2812) | Plain LED |
|---|---|---|
| Power-up / USB attached | blue, one 0.4 s pulse | one 0.4 s pulse |
| Idle, suspended, not mounted | off | off |
| Waiting for BOOT (user presence) | blue, 0.8 s on / 0.8 s off | same |
| Command running (not waiting) | dim blue, steady | lit, steady |
| BOOT accepted | green, one short flash | one short flash |
| Request answered with CTAP status 0x00 after a touch | green, 2 flashes | 2 flashes |
| Request answered with an error after a touch | red, 2 flashes | 3 flashes |
| Wait timed out | yellow, 2 long flashes | 3 long flashes |
| Cancelled by the host, or channel reset | feedback cleared, no success flash | same |

"Success" means the key answered 0x00 to a request that needed a touch. It does not mean a website accepted the login, and it
is not user verification. Requests that never ask for a touch (getInfo polling, PIN commands) show nothing, so a wrong PIN is
not displayed on the key.

`CONFIG_MULTIKEY_LED_BRIGHTNESS` (1-15, default 3, WS2812 only) scales the colour LED; full output is glaring.

### Identifying the LED of a board (needs the owner; flashing requires approval)

Candidate profiles `boards/esp32s3-devkitc1-ws2812-gpio48-candidate.board` (DevKitC-1 v1.0 reference) and
`...-gpio38-candidate.board` (v1.1 reference) are **unverified guesses**; a clone may wire it elsewhere. Build with one
(`python tools/build.py dev --board <name> --clean`), flash the app only, replug, and look for the blue power-up pulse. No pulse:
try the other candidate. Neither: the pin is unidentified, find the schematic. Both candidate pins are ordinary free GPIOs, so a
wrong guess drives nothing harmful on a DevKitC-style board. After observing, record it in `docs/hw-reports/` and add a verified
profile; keep `esp32s3-boot-button` (no LED) as the default for CI and releases.

## Compatibility levels

Same rows, in the same order, as the home page's table (`web/src/lib/compatibility/matrix.ts`). The installer also checks chip,
flash type (quad or octal) and flash size electronically before writing; profiles and their evidence:
[HARDWARE_PROFILES.md](HARDWARE_PROFILES.md).

| Hardware | Level | Detail |
|---|---|---|
| ESP32-S3 N16R8 | Hardware verified | 16 MB quad flash, 8 MB PSRAM (unused) |
| Other ESP32-S3 with 16 MB quad flash | Expected compatible | native USB connector and a BOOT button on GPIO0 |
| ESP32-S3 with 8 MB quad flash (N8, N8R2, N8R8) | Build verified | builds and passes every image check; not run on a board yet |
| ESP32-S3 with 4 MB quad flash (N4, N4R2) | Build verified | builds and passes every image check; not run on a board yet |
| ESP32-S3 with 2 MB flash | Unsupported | does not fit the 3 MB storage layout |
| Octal-flash modules (ESP32-S3-WROOM-2, e.g. N16R8V, N32R8V) | Unsupported | only quad-SPI flash is supported |
| ESP32, ESP32-S2, -C3, -C6, -H2 | Unsupported | MultiKeys only runs on the ESP32-S3 |
| Boards without a native USB connector | Unsupported | the key talks to the computer through the chip's own USB |

Hardware verified = ran on that board type with a report in `docs/hw-reports/`. Build verified = the firmware for that flash size
builds, packages and passes the image checks, but nobody has run it on such a board. Expected compatible = same build as a
hardware-verified profile on a board that is not the tested one. The web installer cannot tell the tested N16R8 from another
board: a connected board that reports the same flash size and PSRAM is labelled "Same configuration as the hardware-verified
N16R8", never "Hardware verified", and every board needs the "this exact board hasn't been tested" acknowledgement. A board whose
flash interface (quad or octal) cannot be read is refused.

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
