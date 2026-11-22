idf_component_register(
    SRCS multikey_auth.c
    INCLUDE_DIRS .
    REQUIRES mbedtls pico-keys-sdk fido multikey_platform
)
# The applet registers itself from a constructor; keep the object even though nothing references it.
idf_component_set_property(${COMPONENT_NAME} WHOLE_ARCHIVE ON)
