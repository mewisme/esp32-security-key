/* SPDX-License-Identifier: AGPL-3.0-or-later */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "sdkconfig.h"

#if !defined(CONFIG_MULTIKEY_ALLOW_UNSET_PINS_FOR_CI)
#if CONFIG_MULTIKEY_BUTTON_GPIO < 0
#error "MULTIKEY_BUTTON_GPIO is unset. Set it in menuconfig or sdkconfig.board (see docs/HARDWARE.md)."
#endif
#if CONFIG_MULTIKEY_LED_GPIO < 0
#error "MULTIKEY_LED_GPIO is unset. Set it in menuconfig or sdkconfig.board (see docs/HARDWARE.md)."
#endif
#endif

#define MULTIKEY_BUTTON_GPIO CONFIG_MULTIKEY_BUTTON_GPIO
#define MULTIKEY_LED_GPIO CONFIG_MULTIKEY_LED_GPIO

#ifdef CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW
#define MULTIKEY_BUTTON_PRESSED_LEVEL 0
#else
#define MULTIKEY_BUTTON_PRESSED_LEVEL 1
#endif

/* True when both pins are configured. A CI-only image (pins unset) returns false. */
bool multikey_pins_configured(void);
