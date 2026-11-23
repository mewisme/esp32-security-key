#
# ESP32-S3 MultiKeys firmware: ESP-IDF project root.
#
# Layout mirrors upstream Pico Keys projects (pico-keys-sdk at ./pico-keys-sdk,
# applications at ./pico-fido and ./pico-openpgp, all pinned git submodules) so the
# upstream relative paths keep working without patching. See docs/ADR-0001-foundation.md.
#
# Two firmware images are built from this tree (never merged, see ADR-0002):
#   MULTIKEY_APP=fido     FIDO2/U2F (HID) + OATH/OTP + MKAUTH (CCID)      [default]
#   MULTIKEY_APP=openpgp  OpenPGP card + PIV (CCID only)
# tools/build.py selects app, profile, build directory and sdkconfig file.
#
# SPDX-License-Identifier: AGPL-3.0-or-later
#
cmake_minimum_required(VERSION 3.16)

if(NOT DEFINED MULTIKEY_PROFILE)
    set(MULTIKEY_PROFILE dev)
endif()
if(NOT MULTIKEY_PROFILE STREQUAL "dev" AND NOT MULTIKEY_PROFILE STREQUAL "prod")
    message(FATAL_ERROR "MULTIKEY_PROFILE must be 'dev' or 'prod' (got '${MULTIKEY_PROFILE}')")
endif()
if(NOT DEFINED MULTIKEY_APP)
    set(MULTIKEY_APP fido)
endif()
if(NOT MULTIKEY_APP STREQUAL "fido" AND NOT MULTIKEY_APP STREQUAL "openpgp")
    message(FATAL_ERROR "MULTIKEY_APP must be 'fido' or 'openpgp' (got '${MULTIKEY_APP}')")
endif()
if(NOT DEFINED SDKCONFIG_DEFAULTS AND NOT DEFINED ENV{SDKCONFIG_DEFAULTS})
    set(SDKCONFIG_DEFAULTS "sdkconfig.defaults;sdkconfig.${MULTIKEY_PROFILE}")
    if(EXISTS "${CMAKE_CURRENT_LIST_DIR}/sdkconfig.board")
        list(APPEND SDKCONFIG_DEFAULTS "sdkconfig.board")
    endif()
endif()

set(ENABLE_POWER_ON_RESET 0)
add_compile_definitions(ENABLE_POWER_ON_RESET=0)
option(ENABLE_EDDSA "Enable/disable EdDSA support" ON)

if(MULTIKEY_APP STREQUAL "fido")
    # pico-fido references the OATH/OTP applets unconditionally in sdk hid/management code paths,
    # so (like upstream's default build) they stay enabled.
    set(ENABLE_OATH_APP 1)
    set(ENABLE_OTP_APP 1)
    add_compile_definitions(ENABLE_OATH_APP=1 ENABLE_OTP_APP=1)
    set(USB_ITF_HID 1)
    set(USB_ITF_CCID 1)
    set(USB_ITF_WCID 1)
    set(PICOKEYS_COMPONENTS fido)
    set(APP_DIR "pico-fido")
else()
    set(USB_ITF_HID 0)
    set(USB_ITF_CCID 1)
    set(USB_ITF_WCID 1)
    set(ENABLE_LIBCVC 1)
    set(PICOKEYS_COMPONENTS openpgp)
    set(APP_DIR "pico-openpgp")
endif()

# Firmware version (esp_app_desc_t.version) follows the host workspace version so one release
# number covers host tools and firmware. Non-release builds carry a -dev suffix.
file(READ "${CMAKE_CURRENT_LIST_DIR}/host/Cargo.toml" _mk_cargo)
string(REGEX MATCH "\\[workspace\\.package\\][^[]*\nversion = \"([^\"]+)\"" _mk_match "${_mk_cargo}")
if(NOT _mk_match)
    message(FATAL_ERROR "could not read [workspace.package] version from host/Cargo.toml")
endif()
set(_mk_ver "${CMAKE_MATCH_1}")
if(MULTIKEY_RELEASE_BUILD)
    set(PROJECT_VER "${_mk_ver}")
else()
    set(PROJECT_VER "${_mk_ver}-dev")
endif()

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
include(pico-keys-sdk/picokeys_sdk_import.cmake)
SET_BUILD_NUMBER("${CMAKE_CURRENT_LIST_DIR}/${APP_DIR}")

# The SDK import file points EXTRA_COMPONENT_DIRS at ./src/<app>; our apps live in submodules.
set(EXTRA_COMPONENT_DIRS
    ${APP_DIR}/src/${PICOKEYS_COMPONENTS}
    pico-keys-sdk/config/esp32/components/mbedtls
    pico-keys-sdk/config/esp32/components/pico-keys-sdk
    components
)
set(COMPONENTS ${PICOKEYS_COMPONENTS} pico-keys-sdk multikey_platform)

if(MULTIKEY_APP STREQUAL "fido")
    list(APPEND EXTRA_COMPONENT_DIRS pico-keys-sdk/config/esp32/components/tinycbor)
    list(APPEND COMPONENTS tinycbor multikey_auth)
    set(FIDO_DIR ${CMAKE_CURRENT_LIST_DIR}/pico-fido/src/fido)
    set(SOURCES
        ${FIDO_DIR}/fido.c
        ${FIDO_DIR}/object_authorization.c
        ${FIDO_DIR}/object_provider.c
        ${FIDO_DIR}/resident_container.c
        ${FIDO_DIR}/files.c
        ${FIDO_DIR}/cmd_register.c
        ${FIDO_DIR}/cmd_authenticate.c
        ${FIDO_DIR}/cmd_version.c
        ${FIDO_DIR}/cbor.c
        ${FIDO_DIR}/cbor_reset.c
        ${FIDO_DIR}/cbor_get_info.c
        ${FIDO_DIR}/cbor_make_credential.c
        ${FIDO_DIR}/event.c
        ${FIDO_DIR}/known_apps.c
        ${FIDO_DIR}/cbor_client_pin.c
        ${FIDO_DIR}/credential.c
        ${FIDO_DIR}/cbor_get_assertion.c
        ${FIDO_DIR}/cbor_selection.c
        ${FIDO_DIR}/cbor_cred_mgmt.c
        ${FIDO_DIR}/cbor_config.c
        ${FIDO_DIR}/cbor_vendor.c
        ${FIDO_DIR}/fido_vault.c
        ${FIDO_DIR}/cbor_large_blobs.c
        ${FIDO_DIR}/management.c
        ${FIDO_DIR}/defs.c
        ${FIDO_DIR}/oath_container.c
        ${FIDO_DIR}/oath.c
        ${FIDO_DIR}/otp_container.c
        ${FIDO_DIR}/otp.c
    )
    SET_VERSION(ver_major ver_minor "${FIDO_DIR}/version.h")
else()
    list(APPEND EXTRA_COMPONENT_DIRS pico-keys-sdk/config/esp32/components/libcvc)
    list(APPEND COMPONENTS libcvc)
    set(PIV_DIR ${CMAKE_CURRENT_LIST_DIR}/pico-openpgp/src/piv)
    set(PGP_DIR ${CMAKE_CURRENT_LIST_DIR}/pico-openpgp/src/openpgp)
    set(SOURCES
        ${PGP_DIR}/openpgp.c
        ${PGP_DIR}/object_provider.c
        ${PGP_DIR}/key_container.c
        ${PGP_DIR}/openpgp_vault.c
        ${PGP_DIR}/files.c
        ${PGP_DIR}/piv.c
        ${PGP_DIR}/management.c
        ${PGP_DIR}/cmd_select.c
        ${PGP_DIR}/cmd_get_data.c
        ${PGP_DIR}/cmd_verify.c
        ${PGP_DIR}/cmd_put_data.c
        ${PGP_DIR}/cmd_select_data.c
        ${PGP_DIR}/cmd_import_data.c
        ${PGP_DIR}/cmd_version.c
        ${PGP_DIR}/cmd_change_pin.c
        ${PGP_DIR}/cmd_mse.c
        ${PGP_DIR}/cmd_internal_aut.c
        ${PGP_DIR}/cmd_challenge.c
        ${PGP_DIR}/cmd_activate_file.c
        ${PGP_DIR}/cmd_terminate_df.c
        ${PGP_DIR}/cmd_pso.c
        ${PGP_DIR}/cmd_keypair_gen.c
        ${PGP_DIR}/cmd_reset_retry.c
        ${PGP_DIR}/do.c
        ${PGP_DIR}/defs.c
        ${PIV_DIR}/cmd_version.c
        ${PIV_DIR}/cmd_select.c
        ${PIV_DIR}/cmd_get_serial.c
        ${PIV_DIR}/cmd_verify.c
        ${PIV_DIR}/cmd_get_data.c
        ${PIV_DIR}/cmd_get_metadata.c
        ${PIV_DIR}/cmd_authenticate.c
        ${PIV_DIR}/cmd_asym_keygen.c
        ${PIV_DIR}/cmd_put_data.c
        ${PIV_DIR}/cmd_set_mgmkey.c
        ${PIV_DIR}/cmd_move_key.c
        ${PIV_DIR}/cmd_change_pin.c
        ${PIV_DIR}/cmd_reset_retry.c
        ${PIV_DIR}/cmd_set_retries.c
        ${PIV_DIR}/cmd_reset.c
        ${PIV_DIR}/cmd_attestation.c
        ${PIV_DIR}/cmd_import_asym.c
    )
    SET_VERSION(ver_major ver_minor "${PGP_DIR}/version.h")
endif()

project(multikey-${MULTIKEY_APP})
