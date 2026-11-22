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

#include "mbedtls/constant_time.h"
#include "mbedtls/ecdsa.h"
#include "mbedtls/ecp.h"
#include "mbedtls/pkcs5.h"
#include "mbedtls/platform_util.h"
#include "mbedtls/sha256.h"

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

#define INS_GET_INFO 0x01
#define INS_ENROLL 0x02
#define INS_CHALLENGE 0x03
#define INS_REVOKE 0x04

static const cmd_t mka_cmds[] = {
    { INS_GET_INFO, cmd_get_info },
    { INS_ENROLL, cmd_enroll },
    { INS_CHALLENGE, cmd_challenge },
    { INS_REVOKE, cmd_revoke },
    { 0x00, 0x0 }
};

static int mka_process_apdu(void) {
    if (CLA(apdu) != 0x80) {
        return SW_CLA_NOT_SUPPORTED();
    }
    if (P1(apdu) != 0x00 || P2(apdu) != 0x00) {
        return SW_INCORRECT_P1P2();
    }
    for (const cmd_t *cmd = mka_cmds; cmd->ins != 0x00; cmd++) {
        if (cmd->ins == INS(apdu)) {
            return cmd->cmd_handler();
        }
    }
    return SW_INS_NOT_SUPPORTED();
}
