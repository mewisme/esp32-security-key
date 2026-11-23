/*
 * MKAUTH v1: custom challenge-response applet on the CCID interface.
 * Wire format and semantics: docs/PROTOCOLS.md ("MKAUTH v1"). Any change here must change that
 * document and host/multikey-proto together.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
#include <stdint.h>
#include <string.h>

#include "sdkconfig.h"
#include "picokeys.h"
#include "apdu.h"
#include "files.h"
#include "fido.h"
#include "random.h"
#include "crypto_utils.h"
#include "usb.h"
#include "tusb.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "mbedtls/constant_time.h"
#include "mbedtls/ecdsa.h"
#include "mbedtls/ecp.h"
#include "mbedtls/pkcs5.h"
#include "mbedtls/platform_util.h"
#include "mbedtls/sha256.h"

#include "esp_app_desc.h"
#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_flash_encrypt.h"
#include "esp_image_format.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_secure_boot.h"
#include "esp_system.h"
#include "esp_timer.h"

#define MKA_EF_RECORD 0xBC00 /* free in pico-fido's fid map (see pico-fido/src/fido/files.h) */

#define MKA_VERSION 1
#define MKA_POLICY 0x01 /* bit0: user presence required. Always set, not changeable. */
#define MKA_PIN_MIN 6
#define MKA_PIN_MAX 63
#define MKA_PIN_TRIES 8
#define MKA_PIN_PBKDF2_ITERS 10000
#define MKA_DEVICE_ID_LEN 16
#define MKA_PUBKEY_LEN 65
#define MKA_NONCE_LEN 32
#define MKA_WRAPPED_LEN (12 + 32 + 16) /* encrypt_with_aad: nonce | ciphertext | tag */

static const uint8_t mka_aid[] = { 8, 0xF0, 0x4D, 0x4B, 0x41, 0x55, 0x54, 0x48, 0x01 };
static const uint8_t mka_transcript_prefix[10] = { 'M', 'K', 'A', 'U', 'T', 'H', '-', 'v', '1', 0 };

PACK(struct mka_record {
    uint8_t magic[4];
    uint8_t version;
    uint8_t tries_left;
    uint8_t reserved[2];
    uint8_t device_id[MKA_DEVICE_ID_LEN];
    uint8_t pin_salt[16];
    uint8_t pin_hash[32];
    uint8_t pubkey[MKA_PUBKEY_LEN];
    uint8_t wrapped_priv[MKA_WRAPPED_LEN];
});
typedef struct mka_record mka_record_t;

static const uint8_t mka_magic[4] = { 'M', 'K', 'A', '1' };

static int mka_process_apdu(void);
static int mka_unload(void);

static int mka_select(app_t *a, uint8_t force) {
    (void)force;
    a->process_apdu = mka_process_apdu;
    a->unload = mka_unload;
    memcpy(res_APDU, "MKAUTH 1", 8);
    res_APDU_size = 8;
    apdu.ne = res_APDU_size;
    return PICOKEYS_OK;
}

INITIALIZER(mka_ctor) {
    register_app(mka_select, mka_aid);
}

static int mka_unload(void) {
    return PICOKEYS_OK;
}

static int mka_sw_tries(uint8_t tries) {
    return set_res_sw(0x63, (uint8_t)(0xC0 | (tries & 0x0F)));
}

/* Returns the stored record or NULL if unenrolled or malformed. */
static const mka_record_t *mka_load(void) {
    file_t *ef = file_search(MKA_EF_RECORD);
    if (!file_has_data(ef) || file_get_size(ef) != sizeof(mka_record_t)) {
        return NULL;
    }
    const mka_record_t *rec = (const mka_record_t *)file_get_data(ef);
    if (memcmp(rec->magic, mka_magic, sizeof(mka_magic)) != 0 || rec->version != MKA_VERSION) {
        return NULL;
    }
    return rec;
}

static int mka_store(const mka_record_t *rec) {
    file_t *ef = file_new(MKA_EF_RECORD);
    if (ef == NULL) {
        return PICOKEYS_ERR_FILE_NOT_FOUND;
    }
    int rc = file_put_data(ef, CONST_BYTE_ARRAY((const uint8_t *)rec, sizeof(*rec)));
    if (rc != PICOKEYS_OK) {
        return rc;
    }
    flash_commit();
    return PICOKEYS_OK;
}

/* Waits for the user-presence button. 0 on press, nonzero on timeout/cancel. */
static int mka_wait_button(void) {
    uint32_t seconds = (CONFIG_MULTIKEY_UP_TIMEOUT_MS + 999u) / 1000u;
    return wait_button_pressed_timeout(seconds);
}

static void mka_pin_hash(const uint8_t *pin, size_t pin_len, const uint8_t salt[16], uint8_t out[32]) {
    mbedtls_pkcs5_pbkdf2_hmac_ext(MBEDTLS_MD_SHA256, pin, pin_len, salt, 16, MKA_PIN_PBKDF2_ITERS, 32, out);
}

/*
 * Verifies the PIN with a persisted retry counter that is decremented BEFORE the comparison, so a
 * power cut during the attempt cannot be used to get free guesses. Returns SW_OK() style value:
 * 0 means verified (counter restored); otherwise the status word to return.
 */
static int mka_verify_pin(const mka_record_t *rec_in, const uint8_t *pin, size_t pin_len, bool *ok) {
    *ok = false;
    if (pin_len < MKA_PIN_MIN || pin_len > MKA_PIN_MAX) {
        return SW_WRONG_LENGTH();
    }
    mka_record_t rec;
    memcpy(&rec, rec_in, sizeof(rec));
    if (rec.tries_left == 0) {
        mbedtls_platform_zeroize(&rec, sizeof(rec));
        return SW_PIN_BLOCKED();
    }
    rec.tries_left--;
    if (mka_store(&rec) != PICOKEYS_OK) {
        mbedtls_platform_zeroize(&rec, sizeof(rec));
        return set_res_sw(0x6F, 0x00);
    }
    uint8_t hash[32];
    mka_pin_hash(pin, pin_len, rec.pin_salt, hash);
    int diff = mbedtls_ct_memcmp(hash, rec.pin_hash, sizeof(hash));
    mbedtls_platform_zeroize(hash, sizeof(hash));
    int sw = 0;
    if (diff != 0) {
        sw = mka_sw_tries(rec.tries_left);
        if (rec.tries_left == 0) {
            sw = SW_PIN_BLOCKED();
        }
    }
    else {
        rec.tries_left = MKA_PIN_TRIES;
        if (mka_store(&rec) != PICOKEYS_OK) {
            sw = set_res_sw(0x6F, 0x00);
        }
        else {
            *ok = true;
        }
    }
    mbedtls_platform_zeroize(&rec, sizeof(rec));
    return sw;
}

static int cmd_get_info(void) {
    const mka_record_t *rec = mka_load();
    uint8_t *p = res_APDU;
    *p++ = MKA_VERSION;
    *p++ = rec ? 1 : 0;
    *p++ = MKA_POLICY;
    if (rec) {
        memcpy(p, rec->device_id, MKA_DEVICE_ID_LEN);
    }
    else {
        memset(p, 0, MKA_DEVICE_ID_LEN);
    }
    p += MKA_DEVICE_ID_LEN;
    if (rec) {
        memcpy(p, rec->pubkey, MKA_PUBKEY_LEN);
        p += MKA_PUBKEY_LEN;
    }
    res_APDU_size = (uint16_t)(p - res_APDU);
    apdu.ne = res_APDU_size;
    return SW_OK();
}

static void mka_wrap_key(const uint8_t priv[32], uint8_t out[MKA_WRAPPED_LEN]) {
    uint8_t kbase[32];
    derive_kbase(kbase);
    encrypt_with_aad(kbase, CONST_BYTE_ARRAY(priv, 32), PIN_KDF_DEFAULT_VERSION, out);
    mbedtls_platform_zeroize(kbase, sizeof(kbase));
}

static int mka_unwrap_key(const uint8_t wrapped[MKA_WRAPPED_LEN], uint8_t priv[32]) {
    uint8_t kbase[32];
    derive_kbase(kbase);
    int rc = decrypt_with_aad(kbase, CONST_BYTE_ARRAY(wrapped, MKA_WRAPPED_LEN), PIN_KDF_DEFAULT_VERSION, priv);
    mbedtls_platform_zeroize(kbase, sizeof(kbase));
    return rc;
}

static int cmd_enroll(void) {
    if (mka_load() != NULL) {
        return SW_CONDITIONS_NOT_SATISFIED();
    }
    if (apdu.nc < MKA_PIN_MIN || apdu.nc > MKA_PIN_MAX) {
        return SW_WRONG_LENGTH();
    }
    if (mka_wait_button() != 0) {
        return SW_WARNING_NOINFO();
    }

    mka_record_t rec;
    memset(&rec, 0, sizeof(rec));
    memcpy(rec.magic, mka_magic, sizeof(mka_magic));
    rec.version = MKA_VERSION;
    rec.tries_left = MKA_PIN_TRIES;
    random_fill_buffer(BYTE_ARRAY(rec.device_id, sizeof(rec.device_id)));
    random_fill_buffer(BYTE_ARRAY(rec.pin_salt, sizeof(rec.pin_salt)));
    mka_pin_hash(apdu.data, apdu.nc, rec.pin_salt, rec.pin_hash);

    mbedtls_ecp_keypair key;
    mbedtls_ecp_keypair_init(&key);
    uint8_t priv[32];
    size_t olen = 0;
    int sw = 0;
    int ret = mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, &key, random_fill_iterator, NULL);
    if (ret == 0) {
        ret = mbedtls_ecp_write_key_ext(&key, &olen, priv, sizeof(priv));
    }
    if (ret == 0 && olen == sizeof(priv)) {
        ret = mbedtls_ecp_write_public_key(&key, MBEDTLS_ECP_PF_UNCOMPRESSED, &olen, rec.pubkey, sizeof(rec.pubkey));
    }
    if (ret != 0 || olen != MKA_PUBKEY_LEN) {
        sw = set_res_sw(0x6F, 0x00);
    }
    else {
        mka_wrap_key(priv, rec.wrapped_priv);
        if (mka_store(&rec) != PICOKEYS_OK) {
            sw = set_res_sw(0x6F, 0x00);
        }
    }
    mbedtls_platform_zeroize(priv, sizeof(priv));
    mbedtls_ecp_keypair_free(&key);

    if (sw == 0) {
        memcpy(res_APDU, rec.pubkey, MKA_PUBKEY_LEN);
        memcpy(res_APDU + MKA_PUBKEY_LEN, rec.device_id, MKA_DEVICE_ID_LEN);
        res_APDU_size = MKA_PUBKEY_LEN + MKA_DEVICE_ID_LEN;
        apdu.ne = res_APDU_size;
        sw = SW_OK();
    }
    mbedtls_platform_zeroize(&rec, sizeof(rec));
    return sw;
}

static int cmd_challenge(void) {
    const mka_record_t *rec = mka_load();
    if (rec == NULL) {
        return SW_CONDITIONS_NOT_SATISFIED();
    }
    if (apdu.nc != MKA_NONCE_LEN) {
        return SW_WRONG_LENGTH();
    }
    if (mka_wait_button() != 0) {
        return SW_WARNING_NOINFO();
    }

    uint8_t device_nonce[MKA_NONCE_LEN];
    random_fill_buffer(BYTE_ARRAY(device_nonce, sizeof(device_nonce)));

    uint8_t hash[32];
    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts(&sha, 0);
    mbedtls_sha256_update(&sha, mka_transcript_prefix, sizeof(mka_transcript_prefix));
    mbedtls_sha256_update(&sha, apdu.data, MKA_NONCE_LEN);
    mbedtls_sha256_update(&sha, device_nonce, sizeof(device_nonce));
    mbedtls_sha256_update(&sha, rec->device_id, MKA_DEVICE_ID_LEN);
    mbedtls_sha256_finish(&sha, hash);
    mbedtls_sha256_free(&sha);

    uint8_t priv[32];
    mbedtls_ecp_keypair key;
    mbedtls_ecp_keypair_init(&key);
    uint8_t sig[MBEDTLS_ECDSA_MAX_LEN];
    size_t slen = 0;
    int sw = 0;
    int ret = mka_unwrap_key(rec->wrapped_priv, priv);
    if (ret == 0) {
        ret = mbedtls_ecp_read_key(MBEDTLS_ECP_DP_SECP256R1, &key, priv, sizeof(priv));
    }
    if (ret == 0) {
        ret = mbedtls_ecp_keypair_calc_public(&key, random_fill_iterator, NULL);
    }
    if (ret == 0) {
        ret = mbedtls_ecdsa_write_signature(&key, MBEDTLS_MD_SHA256, hash, sizeof(hash), sig, sizeof(sig), &slen,
                                            random_fill_iterator, NULL);
    }
    mbedtls_platform_zeroize(priv, sizeof(priv));
    mbedtls_ecp_keypair_free(&key);

    if (ret != 0 || slen > 72) {
        sw = set_res_sw(0x6F, 0x00);
    }
    else {
        memcpy(res_APDU, device_nonce, sizeof(device_nonce));
        memcpy(res_APDU + sizeof(device_nonce), sig, slen);
        res_APDU_size = (uint16_t)(sizeof(device_nonce) + slen);
        apdu.ne = res_APDU_size;
        sw = SW_OK();
    }
    mbedtls_platform_zeroize(sig, sizeof(sig));
    return sw;
}

static int cmd_revoke(void) {
    const mka_record_t *rec = mka_load();
    if (rec == NULL) {
        return SW_CONDITIONS_NOT_SATISFIED();
    }
    bool ok = false;
    int sw = mka_verify_pin(rec, apdu.data, apdu.nc, &ok);
    if (!ok) {
        return sw;
    }
    if (mka_wait_button() != 0) {
        return SW_WARNING_NOINFO();
    }
    file_t *ef = file_search(MKA_EF_RECORD);
    if (ef == NULL || file_delete(ef) != PICOKEYS_OK) {
        return set_res_sw(0x6F, 0x00);
    }
    flash_commit();
    return SW_OK();
}

/*
 * INS 06 DEVICE_NAME, P1 selects the operation. P2 is 00, or 01 on SET/CLEAR to also detach/attach USB once the
 * response has been sent (the same as a following REENUM, without a second button press):
 *   00 GET     no data. Response: flags | name. flags bit0 = a user name is stored (else the Kconfig default),
 *              bit1 = the name differs from the one the host currently sees (re-enumeration pending),
 *              bit2 = renaming is compiled in. name = what the next enumeration will report. No authorization.
 *   01 SET     data: pin_len | pin | name (printable ASCII, 1..31, no leading/trailing space).
 *   02 CLEAR   data: pin_len | pin. Restores the Kconfig default name.
 *   03 REENUM  data: pin_len | pin. Detaches from USB for about a second so the host reads the strings again.
 *              The response is only the status word.
 * SET, CLEAR and REENUM need a button press; once MKAUTH is enrolled they also need its PIN (pin_len must be 0
 * while it is not enrolled). The name lives in its own file: keys, credentials, PINs, VID/PID and the AAGUID are
 * never touched, and it survives MKAUTH revoke and FIDO reset.
 */
#define MKA_NAME_GET 0x00
#define MKA_NAME_SET 0x01
#define MKA_NAME_CLEAR 0x02
#define MKA_NAME_REENUM 0x03
#define MKA_NAME_P2_REENUM 0x01 /* P2 bit0 on SET/CLEAR: detach/attach once the response has been sent */

static int cmd_device_name_get(void) {
    char name[MULTIKEY_NAME_MAX + 1];
    bool custom = false;
    size_t n = multikey_usb_name_effective(name, &custom);
    uint8_t flags = 0;
#ifdef CONFIG_MULTIKEY_USB_CUSTOM_NAME_ENABLED
    flags |= 0x04;
#endif
    if (custom) {
        flags |= 0x01;
    }
    if (strcmp(name, multikey_usb_name_active()) != 0) {
        flags |= 0x02;
    }
    res_APDU[0] = flags;
    memcpy(res_APDU + 1, name, n);
    res_APDU_size = (uint16_t)(1 + n);
    apdu.ne = res_APDU_size;
    return SW_OK();
}

/* Verifies the optional PIN prefix and the button. rest and rest_len describe the data after the PIN. */
static int mka_manage_auth(const uint8_t **rest, size_t *rest_len) {
    if (apdu.nc < 1) {
        return SW_WRONG_LENGTH();
    }
    size_t pin_len = apdu.data[0];
    if (1 + pin_len > apdu.nc) {
        return SW_WRONG_LENGTH();
    }
    *rest = apdu.data + 1 + pin_len;
    *rest_len = apdu.nc - 1 - pin_len;
    const mka_record_t *rec = mka_load();
    if (rec == NULL) {
        if (pin_len != 0) {
            return SW_INCORRECT_PARAMS(); /* 6A80: an unenrolled device has no PIN to verify */
        }
    }
    else {
        bool ok = false;
        int sw = mka_verify_pin(rec, apdu.data + 1, pin_len, &ok);
        if (!ok) {
            return sw;
        }
    }
    if (mka_wait_button() != 0) {
        return SW_WARNING_NOINFO();
    }
    return PICOKEYS_OK;
}

static int mka_name_store(const uint8_t *name, size_t len) {
    file_t *ef = file_new(MULTIKEY_EF_DEVICE_NAME);
    if (ef == NULL || file_put_data(ef, CONST_BYTE_ARRAY(name, (uint16_t)len)) != PICOKEYS_OK) {
        return PICOKEYS_EXEC_ERROR;
    }
    flash_commit();
    return PICOKEYS_OK;
}

static void mka_reenum_task(void *arg) {
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(300)); /* let the response leave the endpoint first */
    tud_disconnect();
    vTaskDelay(pdMS_TO_TICKS(1200));
    tud_connect();
    multikey_usb_name_applied(); /* the host now reads the strings that GET reports as the effective name */
    vTaskDelete(NULL);
}

static int cmd_device_name(void) {
    uint8_t p1 = P1(apdu);
    if (p1 == MKA_NAME_GET) {
        return cmd_device_name_get();
    }
#ifndef CONFIG_MULTIKEY_USB_CUSTOM_NAME_ENABLED
    return SW_CONDITIONS_NOT_SATISFIED();
#else
    if (p1 != MKA_NAME_SET && p1 != MKA_NAME_CLEAR && p1 != MKA_NAME_REENUM) {
        return SW_INCORRECT_P1P2();
    }
    /* Malformed names are rejected before a PIN attempt is spent. */
    if (p1 == MKA_NAME_SET) {
        if (apdu.nc < 1 || 1u + apdu.data[0] > apdu.nc) {
            return SW_WRONG_LENGTH();
        }
        if (!multikey_name_valid(apdu.data + 1 + apdu.data[0], apdu.nc - 1u - apdu.data[0])) {
            return SW_INCORRECT_PARAMS(); /* 6A80: invalid name (SW_WRONG_DATA is 6700 in this SDK) */
        }
    }
    const uint8_t *rest = NULL;
    size_t rest_len = 0;
    int sw = mka_manage_auth(&rest, &rest_len);
    if (sw != PICOKEYS_OK) {
        return sw;
    }
    int rc = PICOKEYS_OK;
    if (p1 == MKA_NAME_SET) {
        rc = mka_name_store(rest, rest_len);
    }
    else if (p1 == MKA_NAME_CLEAR) {
        file_t *ef = file_search(MULTIKEY_EF_DEVICE_NAME);
        if (ef != NULL && file_has_data(ef)) {
            rc = file_delete(ef);
            if (rc == PICOKEYS_OK) {
                flash_commit();
            }
        }
    }
    else if (rest_len != 0) {
        return SW_WRONG_LENGTH();
    }
    if (rc != PICOKEYS_OK) {
        return set_res_sw(0x6F, 0x00);
    }
    multikey_usb_strings_refresh();
    if (p1 == MKA_NAME_REENUM || (P2(apdu) & MKA_NAME_P2_REENUM)) {
        if (xTaskCreate(mka_reenum_task, "mka_reenum", 2048, NULL, 5, NULL) != pdPASS) {
            return set_res_sw(0x6F, 0x00);
        }
    }
    if (p1 == MKA_NAME_REENUM) {
        return SW_OK();
    }
    return cmd_device_name_get();
#endif
}

/*
 * INS 07 BUILD_INFO: what is running on this key. Read-only, no data, no button, no PIN. Response:
 *   fmt(1) = 01, then tag(1) | len(1) | value(len) entries. A reader skips tags it does not know.
 *   01 project name (ASCII)            02 version (ASCII, esp_app_desc_t.version)   03 ESP-IDF version (ASCII)
 *   04 source commit (ASCII, 12 hex, "+dirty" if the tree had local changes when the build was configured, or "unknown")
 *   05 SHA-256 (32) of the running app image exactly as flashed: the same value as the manifest's images[role=app].sha256
 *   06 SHA-256 (32) of the app ELF (esp_app_desc_t.app_elf_sha256)
 *   07 flash size the image was built for (ASCII, e.g. "16MB")   08 flash size the chip reports (u32 BE, bytes)
 *   09 security flags (u8): bit0 flash encryption on, bit1 secure boot on
 *   0A chip: model(1) | full revision(2, BE, major*100+minor) | cores(1)
 *   0B reset reason of this boot (u8, esp_reset_reason_t)   0C seconds since boot (u32 BE)
 *   0D running partition: offset(4, BE) | label (ASCII)
 * Nothing here identifies the owner or the device: the MAC address and the serial number are not reported.
 */
#define MKA_BUILD_FMT 1
#define MKA_BUILD_MAX 255 /* short APDU response */
#define BI_PROJECT 0x01
#define BI_VERSION 0x02
#define BI_IDF 0x03
#define BI_COMMIT 0x04
#define BI_IMAGE_SHA256 0x05
#define BI_ELF_SHA256 0x06
#define BI_FLASH_BUILT 0x07
#define BI_FLASH_CHIP 0x08
#define BI_SECURITY 0x09
#define BI_CHIP 0x0A
#define BI_RESET 0x0B
#define BI_UPTIME 0x0C
#define BI_PARTITION 0x0D

#ifndef MULTIKEY_BUILD_COMMIT
#define MULTIKEY_BUILD_COMMIT "unknown"
#endif

static bool bi_put(size_t *len, uint8_t tag, const void *value, size_t n) {
    if (n > 255 || *len + 2 + n > MKA_BUILD_MAX) {
        return false;
    }
    res_APDU[(*len)++] = tag;
    res_APDU[(*len)++] = (uint8_t)n;
    memcpy(res_APDU + *len, value, n);
    *len += n;
    return true;
}

static bool bi_put_str(size_t *len, uint8_t tag, const char *s, size_t max) {
    return bi_put(len, tag, s, strnlen(s, max));
}

static bool bi_put_u32(size_t *len, uint8_t tag, uint32_t v) {
    const uint8_t be[4] = { (uint8_t)(v >> 24), (uint8_t)(v >> 16), (uint8_t)(v >> 8), (uint8_t)v };
    return bi_put(len, tag, be, sizeof(be));
}

/* SHA-256 over the first image_len bytes of the running app partition: the file that was flashed, appended digest
 * included. Computed once (about 600 KB of flash), then cached. */
static bool bi_image_sha256(uint8_t out[32]) {
    static bool done = false;
    static bool ok = false;
    static uint8_t cache[32];
    static uint8_t chunk[1024];
    if (!done) {
        done = true;
        const esp_partition_t *part = esp_ota_get_running_partition();
        esp_image_metadata_t meta;
        const esp_partition_pos_t pos = part ? (esp_partition_pos_t){ .offset = part->address, .size = part->size }
                                             : (esp_partition_pos_t){ 0, 0 };
        if (part != NULL && esp_image_get_metadata(&pos, &meta) == ESP_OK && meta.image_len > 0 &&
            meta.image_len <= part->size) {
            mbedtls_sha256_context ctx;
            mbedtls_sha256_init(&ctx);
            ok = mbedtls_sha256_starts(&ctx, 0) == 0;
            for (uint32_t off = 0; ok && off < meta.image_len; off += sizeof(chunk)) {
                uint32_t n = meta.image_len - off;
                if (n > sizeof(chunk)) {
                    n = sizeof(chunk);
                }
                ok = esp_partition_read(part, off, chunk, n) == ESP_OK && mbedtls_sha256_update(&ctx, chunk, n) == 0;
            }
            ok = ok && mbedtls_sha256_finish(&ctx, cache) == 0;
            mbedtls_sha256_free(&ctx);
        }
    }
    if (ok) {
        memcpy(out, cache, sizeof(cache));
    }
    return ok;
}

static int cmd_build_info(void) {
    const esp_app_desc_t *desc = esp_app_get_description();
    size_t len = 0;
    res_APDU[len++] = MKA_BUILD_FMT;
    bool ok = bi_put_str(&len, BI_PROJECT, desc->project_name, sizeof(desc->project_name)) &&
              bi_put_str(&len, BI_VERSION, desc->version, sizeof(desc->version)) &&
              bi_put_str(&len, BI_IDF, desc->idf_ver, sizeof(desc->idf_ver)) &&
              bi_put_str(&len, BI_COMMIT, MULTIKEY_BUILD_COMMIT, 24);
    uint8_t image_sha[32];
    if (ok && bi_image_sha256(image_sha)) {
        ok = bi_put(&len, BI_IMAGE_SHA256, image_sha, sizeof(image_sha));
    }
    ok = ok && bi_put(&len, BI_ELF_SHA256, desc->app_elf_sha256, sizeof(desc->app_elf_sha256)) &&
         bi_put_str(&len, BI_FLASH_BUILT, CONFIG_ESPTOOLPY_FLASHSIZE, 8);
    uint32_t chip_flash = 0;
    if (ok && esp_flash_get_physical_size(esp_flash_default_chip, &chip_flash) == ESP_OK) {
        ok = bi_put_u32(&len, BI_FLASH_CHIP, chip_flash);
    }
    const uint8_t security = (uint8_t)((esp_flash_encryption_enabled() ? 0x01 : 0x00) |
                                       (esp_secure_boot_enabled() ? 0x02 : 0x00));
    esp_chip_info_t chip;
    esp_chip_info(&chip);
    const uint8_t chip_bytes[4] = { (uint8_t)chip.model, (uint8_t)(chip.revision >> 8), (uint8_t)chip.revision,
                                    (uint8_t)chip.cores };
    const uint8_t reset = (uint8_t)esp_reset_reason();
    ok = ok && bi_put(&len, BI_SECURITY, &security, 1) && bi_put(&len, BI_CHIP, chip_bytes, sizeof(chip_bytes)) &&
         bi_put(&len, BI_RESET, &reset, 1) && bi_put_u32(&len, BI_UPTIME, (uint32_t)(esp_timer_get_time() / 1000000));
    const esp_partition_t *running = esp_ota_get_running_partition();
    if (ok && running != NULL) {
        uint8_t part_entry[4 + 16];
        const size_t label_len = strnlen(running->label, 16);
        part_entry[0] = (uint8_t)(running->address >> 24);
        part_entry[1] = (uint8_t)(running->address >> 16);
        part_entry[2] = (uint8_t)(running->address >> 8);
        part_entry[3] = (uint8_t)running->address;
        memcpy(part_entry + 4, running->label, label_len);
        ok = bi_put(&len, BI_PARTITION, part_entry, 4 + label_len);
    }
    if (!ok) {
        return set_res_sw(0x6F, 0x00);
    }
    res_APDU_size = (uint16_t)len;
    apdu.ne = res_APDU_size;
    return SW_OK();
}

#define INS_GET_INFO 0x01
#define INS_ENROLL 0x02
#define INS_CHALLENGE 0x03
#define INS_REVOKE 0x04
#define INS_DEVICE_NAME 0x06
#define INS_BUILD_INFO 0x07

static const cmd_t mka_cmds[] = {
    { INS_GET_INFO, cmd_get_info },
    { INS_ENROLL, cmd_enroll },
    { INS_CHALLENGE, cmd_challenge },
    { INS_REVOKE, cmd_revoke },
    { INS_DEVICE_NAME, cmd_device_name },
    { INS_BUILD_INFO, cmd_build_info },
    { 0x00, 0x0 }
};

static int mka_process_apdu(void) {
    if (CLA(apdu) != 0x80) {
        return SW_CLA_NOT_SUPPORTED();
    }
    if (INS(apdu) == INS_DEVICE_NAME) {
        if (P2(apdu) > MKA_NAME_P2_REENUM) {
            return SW_INCORRECT_P1P2();
        }
    }
    else if (P1(apdu) != 0x00 || P2(apdu) != 0x00) {
        return SW_INCORRECT_P1P2();
    }
    for (const cmd_t *cmd = mka_cmds; cmd->ins != 0x00; cmd++) {
        if (cmd->ins == INS(apdu)) {
            return cmd->cmd_handler();
        }
    }
    return SW_INS_NOT_SUPPORTED();
}
