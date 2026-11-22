#
# ESP32-S3 MultiKey firmware: ESP-IDF project root.
#
# Layout mirrors upstream Pico Keys projects (pico-keys-sdk at ./pico-keys-sdk,
# applications at ./pico-fido and ./pico-openpgp, all pinned git submodules) so the
# upstream relative paths keep working without patching. See docs/ADR-0001-foundation.md.
#
# SPDX-License-Identifier: AGPL-3.0-or-later
#
cmake_minimum_required(VERSION 3.16)

# Shared + per-profile defaults. Profile is chosen with -DMULTIKEY_PROFILE=dev|prod
# (use tools/build.py, which also selects the build directory and sdkconfig file).
if(NOT DEFINED MULTIKEY_PROFILE)
    set(MULTIKEY_PROFILE dev)
endif()
if(NOT MULTIKEY_PROFILE STREQUAL "dev" AND NOT MULTIKEY_PROFILE STREQUAL "prod")
    message(FATAL_ERROR "MULTIKEY_PROFILE must be 'dev' or 'prod' (got '${MULTIKEY_PROFILE}')")
endif()
if(NOT DEFINED SDKCONFIG_DEFAULTS AND NOT DEFINED ENV{SDKCONFIG_DEFAULTS})
    set(SDKCONFIG_DEFAULTS "sdkconfig.defaults;sdkconfig.${MULTIKEY_PROFILE}")
    if(EXISTS "${CMAKE_CURRENT_LIST_DIR}/sdkconfig.board")
        list(APPEND SDKCONFIG_DEFAULTS "sdkconfig.board")
    endif()
endif()

# Upstream app switches. pico-fido references the OATH/OTP applets unconditionally in the sdk
# hid/management code paths, so (like upstream's default build) they stay enabled.
set(ENABLE_POWER_ON_RESET 0)
set(ENABLE_OATH_APP 1)
set(ENABLE_OTP_APP 1)
add_compile_definitions(ENABLE_POWER_ON_RESET=0 ENABLE_OATH_APP=1 ENABLE_OTP_APP=1)
# FIDO2 over HID + smart-card (CCID) interface for OATH/OTP now, OpenPGP/MKAUTH later.
set(USB_ITF_HID 1)
set(USB_ITF_CCID 1)
set(USB_ITF_WCID 1)
option(ENABLE_EDDSA "Enable/disable EdDSA support" ON)

set(PICOKEYS_COMPONENTS fido)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
include(pico-keys-sdk/picokeys_sdk_import.cmake)
SET_BUILD_NUMBER("${CMAKE_CURRENT_LIST_DIR}/pico-fido")

# The SDK import file points EXTRA_COMPONENT_DIRS at ./src/<app>; our apps live in submodules.
set(EXTRA_COMPONENT_DIRS
    pico-fido/src/fido
    pico-keys-sdk/config/esp32/components/mbedtls
    pico-keys-sdk/config/esp32/components/pico-keys-sdk
    pico-keys-sdk/config/esp32/components/tinycbor
    components
)
set(COMPONENTS fido pico-keys-sdk tinycbor multikey_platform)

set(SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/fido.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/object_authorization.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/object_provider.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/resident_container.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/files.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cmd_register.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cmd_authenticate.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cmd_version.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_reset.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_get_info.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_make_credential.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/event.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/known_apps.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_client_pin.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/credential.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_get_assertion.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_selection.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_cred_mgmt.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_config.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_vendor.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/fido_vault.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/cbor_large_blobs.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/management.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/defs.c
)


list(APPEND SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/oath_container.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/oath.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/otp_container.c
    ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/otp.c
)
SET_VERSION(ver_major ver_minor "${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido/version.h")
project(multikey)
