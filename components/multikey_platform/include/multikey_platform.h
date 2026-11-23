/* SPDX-License-Identifier: AGPL-3.0-or-later */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "sdkconfig.h"

#define MULTIKEY_BUTTON_GPIO CONFIG_MULTIKEY_BUTTON_GPIO
#define MULTIKEY_LED_GPIO CONFIG_MULTIKEY_LED_GPIO

#ifdef CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW
#define MULTIKEY_BUTTON_PRESSED_LEVEL 0
#else
#define MULTIKEY_BUTTON_PRESSED_LEVEL 1
#endif

/* True when the button is configured (and, if an LED type is selected, the LED too). A CI-only image
 * built without pins returns false. */
bool multikey_pins_configured(void);
