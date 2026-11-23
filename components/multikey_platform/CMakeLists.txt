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
