idf_component_register(
    SRCS multikey_platform.c
    INCLUDE_DIRS include
    REQUIRES driver esp_driver_gpio
)

# Identity strings end up in USB string descriptors. esp_tinyusb converts them byte for byte, so only
# printable ASCII that fits its 31 character buffer is valid. CONFIG_* is not defined during the early
# requirement-expansion pass, hence the DEFINED guards.
foreach(_mk_var MANUFACTURER PRODUCT_NAME)
    if(DEFINED CONFIG_MULTIKEY_USB_${_mk_var})
        set(_mk_str "${CONFIG_MULTIKEY_USB_${_mk_var}}")
        string(LENGTH "${_mk_str}" _mk_len)
        if(_mk_len LESS 1 OR _mk_len GREATER 31 OR NOT _mk_str MATCHES "^[ -~]+$"
           OR _mk_str MATCHES "^ " OR _mk_str MATCHES " $")
            message(FATAL_ERROR
                "CONFIG_MULTIKEY_USB_${_mk_var}=\"${_mk_str}\" is invalid: 1..31 printable ASCII characters, "
                "no leading or trailing space.")
        endif()
    endif()
endforeach()
if(DEFINED CONFIG_MULTIKEY_AAGUID)
    string(LENGTH "${CONFIG_MULTIKEY_AAGUID}" _mk_len)
    if(NOT _mk_len EQUAL 32 OR NOT CONFIG_MULTIKEY_AAGUID MATCHES "^[0-9a-fA-F]+$")
        message(FATAL_ERROR "CONFIG_MULTIKEY_AAGUID must be exactly 32 hexadecimal digits (got \"${CONFIG_MULTIKEY_AAGUID}\").")
    endif()
    string(TOLOWER "${CONFIG_MULTIKEY_AAGUID}" _mk_aaguid)
    if(_mk_aaguid STREQUAL "89fb94b706c936739b7e30526d968145")
        message(FATAL_ERROR "CONFIG_MULTIKEY_AAGUID is upstream Pico FIDO's AAGUID. Do not reuse another project's identifier.")
    endif()
endif()

# WebUSB landing page URL: https only, printable ASCII without spaces, 1..200 characters after the scheme
# (the descriptor stores the scheme in bScheme and the rest as bytes; bLength must stay <= 255).
if(DEFINED CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED AND DEFINED CONFIG_MULTIKEY_WEBUSB_LANDING_URL)
    set(_mk_url "${CONFIG_MULTIKEY_WEBUSB_LANDING_URL}")
    if(NOT _mk_url MATCHES "^https://[!-~]+$")
        message(FATAL_ERROR
            "CONFIG_MULTIKEY_WEBUSB_LANDING_URL=\"${_mk_url}\" is invalid: it must be https:// followed by "
            "printable ASCII without spaces (percent-encode other characters).")
    endif()
    string(LENGTH "${_mk_url}" _mk_url_len)
    math(EXPR _mk_url_tail "${_mk_url_len} - 8")
    if(_mk_url_tail GREATER 200)
        message(FATAL_ERROR "CONFIG_MULTIKEY_WEBUSB_LANDING_URL is too long (${_mk_url_tail} > 200 characters after https://).")
    endif()
endif()
