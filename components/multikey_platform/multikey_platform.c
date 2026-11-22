/* SPDX-License-Identifier: AGPL-3.0-or-later */
#include "multikey_platform.h"

bool multikey_pins_configured(void) {
    return CONFIG_MULTIKEY_BUTTON_GPIO >= 0 && CONFIG_MULTIKEY_LED_GPIO >= 0;
}
