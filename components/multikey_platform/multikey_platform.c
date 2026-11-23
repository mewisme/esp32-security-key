/* SPDX-License-Identifier: AGPL-3.0-or-later */
#include "multikey_platform.h"

/*
 * Compile-time pin safety checks for the ESP32-S3 N16R8 module (quad flash, octal PSRAM).
 * They run only when a pin is configured (>= 0). Facts used (ESP32-S3 datasheet / ESP-IDF docs):
 *   GPIO19/20 : native USB D-/D+ (the HID/CCID interfaces of this firmware)
 *   GPIO26-37 : SPI flash and octal PSRAM lines on -R8 / -R16V modules, not usable as GPIO
 *   GPIO0     : strapping, BOOT button; LOW at reset = ROM download mode
 *   GPIO3/45/46 : strapping (JTAG source, VDD_SPI voltage, boot log), need an explicit acknowledgement
 * These are a safety net, not a substitute for reading your board's schematic.
 */
#define MK_BTN CONFIG_MULTIKEY_BUTTON_GPIO
#define MK_LED CONFIG_MULTIKEY_LED_GPIO

#define MK_RESERVED(p) ((p) == 19 || (p) == 20 || ((p) >= 26 && (p) <= 37))

_Static_assert(MK_BTN < 0 || !MK_RESERVED(MK_BTN),
               "MULTIKEY_BUTTON_GPIO is used by USB (19/20) or flash/octal PSRAM (26-37) on N16R8 modules");

#if !defined(CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW)
_Static_assert(MK_BTN != 0, "GPIO0 (BOOT) must be configured active low: a HIGH level at reset is not its circuit");
#endif

#if !defined(CONFIG_MULTIKEY_BUTTON_STRAPPING_ACK)
_Static_assert(MK_BTN != 3 && MK_BTN != 45 && MK_BTN != 46,
               "GPIO3/45/46 are strapping pins: set MULTIKEY_BUTTON_STRAPPING_ACK if you really want one");
#endif

#if !defined(CONFIG_MULTIKEY_LED_TYPE_NONE)
_Static_assert(MK_LED < 0 || !MK_RESERVED(MK_LED),
               "MULTIKEY_LED_GPIO is used by USB (19/20) or flash/octal PSRAM (26-37) on N16R8 modules");
_Static_assert(MK_LED < 0 || MK_LED != MK_BTN, "LED and button must use different GPIOs");
#endif

bool multikey_pins_configured(void) {
#if defined(CONFIG_MULTIKEY_LED_TYPE_NONE)
    return MK_BTN >= 0;
#else
    return MK_BTN >= 0 && MK_LED >= 0;
#endif
}
