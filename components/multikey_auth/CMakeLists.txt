# Source commit reported by INS 07 BUILD_INFO ("<12 hex>", plus "+dirty" when tracked files had local changes, or
# "unknown" outside a git checkout). It is read when CMake configures. Moving the current branch's ref is a configure
# dependency, so an incremental build after a commit still reports the new commit.
# IDF also runs this file in a script-mode scan for component requirements (CMAKE_BUILD_EARLY_EXPANSION), where
# directory properties and targets do not exist: the git probe and the target definition stay out of that pass.
set(_mk_commit "unknown")
if(NOT CMAKE_BUILD_EARLY_EXPANSION)
    find_package(Git QUIET)
    if(GIT_FOUND)
        execute_process(COMMAND ${GIT_EXECUTABLE} -C "${COMPONENT_DIR}" rev-parse --short=12 HEAD
            OUTPUT_VARIABLE _mk_rev OUTPUT_STRIP_TRAILING_WHITESPACE RESULT_VARIABLE _mk_rc ERROR_QUIET)
        if(_mk_rc EQUAL 0 AND _mk_rev MATCHES "^[0-9a-f]+$")
            set(_mk_commit "${_mk_rev}")
            # Submodules (the patched pico-* trees) and untracked files are not part of "dirty".
            execute_process(COMMAND ${GIT_EXECUTABLE} -C "${COMPONENT_DIR}" status --porcelain --untracked-files=no --ignore-submodules=all
                OUTPUT_VARIABLE _mk_changes OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
            if(_mk_changes)
                set(_mk_commit "${_mk_commit}+dirty")
            endif()
            execute_process(COMMAND ${GIT_EXECUTABLE} -C "${COMPONENT_DIR}" symbolic-ref -q HEAD
                OUTPUT_VARIABLE _mk_ref OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
            foreach(_mk_what HEAD ${_mk_ref})
                execute_process(COMMAND ${GIT_EXECUTABLE} -C "${COMPONENT_DIR}" rev-parse --git-path ${_mk_what}
                    OUTPUT_VARIABLE _mk_path OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
                get_filename_component(_mk_path "${_mk_path}" ABSOLUTE BASE_DIR "${COMPONENT_DIR}")
                if(EXISTS "${_mk_path}")
                    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${_mk_path}")
                endif()
            endforeach()
        endif()
    endif()
endif()

idf_component_register(
    SRCS multikey_auth.c
    INCLUDE_DIRS .
    REQUIRES mbedtls pico-keys-sdk fido multikey_platform
    PRIV_REQUIRES app_update bootloader_support esp_app_format esp_hw_support esp_partition esp_system esp_timer spi_flash
)
if(NOT CMAKE_BUILD_EARLY_EXPANSION)
    target_compile_definitions(${COMPONENT_LIB} PRIVATE MULTIKEY_BUILD_COMMIT="${_mk_commit}")
endif()
# The applet registers itself from a constructor; keep the object even though nothing references it.
idf_component_set_property(${COMPONENT_NAME} WHOLE_ARCHIVE ON)
