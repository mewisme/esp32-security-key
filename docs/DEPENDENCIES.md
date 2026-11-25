# Dependencies and pinned versions

| Component | Version / ref | Pin | Licence |
|---|---|---|---|
| pico-keys-sdk | `v3.2-773-g50699e5` (pico-fido v8.2's pin) | `50699e53e8ada214c27f6c9b66ea3b6f127fc655` | AGPL-3.0 |
| pico-fido | `v8.2` | `15b848d821b4995eb1b29a5c2a4c24c25d1a768e` | AGPL-3.0 |
| pico-openpgp | upstream main (`nightly-main`, v5.0 + 48 commits); v5.0 does not build against the SDK pin above | `9b232765dc32859ff5ba59856aa13562be18e51c` | AGPL-3.0 |
| ESP-IDF | `v5.5.6` | tag | Apache-2.0 |
| mbedTLS (fetched by pico-keys-sdk `cmake/deps.cmake`) | `v3.6.7-eddsa` fork (adds EdDSA; `v3.6.7` upstream when EdDSA is off) | `fc39404125e93ee00e6758605e6c6f2c8db440f1` (fork) / `068ff080b369adfac81509f9b57b2afabaf82dc5` (upstream, peeled tag) | Apache-2.0 |
| tinycbor | `v0.6.1` | `c0aad2fb2137a31b9845fbaae3653540c410f215` (peeled tag) | MIT |
| cJSON (only with `USB_ITF_LWIP`, not used by our images) | `v1.7.19` | `c859b25da02955fef659d658b8f324b5cde87be3` | MIT |
| mlkem-native / mldsa-native (only with `ENABLE_PQC`, not used by our images) | `v1.2.0` / `v1.0.0-beta2` | `0ba906cb14b1c241476134d7403a811b382ca498` / `9b0ee84f4cf399043eca59eca4e5f8531ca1d61b` | Apache-2.0 / MIT / ISC |
| libcvc (openpgp image only) | was branch `main`; now the commit `main` pointed to on 2026-11-23 | `54562afc4d620c8bdb118183c0db49048baa0b2c` | see upstream |
| ctap-hid-fido2 (host `multikey-fido`) | `=3.6.1` (exact), `Cargo.lock` tracked | crates.io | MIT (pulls hidapi, ring) |
| Rust toolchain (host) | `rust-version = 1.89`; CI uses `stable` (moving; **not** pinned, see "Not pinned") | `rust-toolchain` action pinned by SHA | n/a |
| ESP-IDF build container (CI, release) | `espressif/idf:v5.5.6` | `@sha256:bf72fe7a15c22849a9a94147301165a545fb8905d97c176cf748e3e4614cac84` (multi-arch index digest) | Apache-2.0 |
| GitHub Actions | see the `# vX.Y.Z` comment on each `uses:` | full 40-hex commit SHA in `ci.yml`, `release.yml`, `web.yml` | n/a |
| Python tools (`tools/requirements.txt`) | exact versions, direct and transitive | `==` pins | various |
| Python CI helper (`pyyaml`) | `6.0.2` | `==` pin in the workflow step | MIT |
| espressif/esp_tinyusb, zorxx/neopixel (IDF component manager) | see `dependencies.lock` | locked | Apache-2.0 / MIT |

Submodule pins come from the gitlinks (`git submodule status`). `pico-keys-sdk/cmake/deps.cmake` fetches mbedTLS, tinycbor, libcvc
(and, when enabled, cJSON, mlkem-native, mldsa-native) into `pico-keys-sdk/third-party` at configure time. Upstream pointed at tags
and the `main` branch; `patches/pico-keys-sdk/0006-multikey-pin-third-party-deps.patch` replaces every `PICOKEYS_*_REF` with a full
commit SHA (the old tag or branch stays in a trailing comment) and makes `picokeys_sync_dep` fail, and delete the checkout, when
`git rev-parse HEAD` is not exactly that SHA. A tag that resolves to an annotated tag object is pinned to the commit it peels to.
A `third-party` directory fetched before this patch has the old ref in its `.picokeys_dep_source` marker and is re-fetched on the next
configure. `pico-keys-sdk` shows as modified after `tools/apply_patches.py` runs (our patches, see `patches/`); this is expected.

Host release builds use `--locked` against the tracked `host/Cargo.lock` (every `cargo build|test|clippy` in the workflows has
`--locked`); `tools/gen_notices.py` writes the third-party license inventory shipped in every archive. The IDF component manager
inputs (`esp_tinyusb`, `tinyusb`, `neopixel`) are locked with content hashes in the tracked `dependencies.lock`.

## Enforcement

`python tools/check_pins.py` (CI job `pins` in `ci.yml`, after `tools/apply_patches.py`) fails on: an action `uses:` that is not
`owner/repo@<40-hex>` with a trailing version comment; a `container:`/`image:` without `@sha256:`; `cargo build|test|clippy|run|install`
without `--locked`; a `pip install` of an unpinned package; a `tools/requirements.txt` line that is not `name==version`; a `GIT_TAG`
that is not a 40-hex SHA in the repository's CMake files; a `PICOKEYS_*_REF` in `deps.cmake` that is not a 40-hex SHA; a missing
`host/Cargo.lock`. Its self-test is `python -m unittest discover tests/pins`.

## How to update a pin

1. Resolve the new ref to a commit: `git ls-remote https://github.com/<owner>/<repo>.git 'refs/tags/<tag>*'` and take the
   peeled `^{}` line when there is one (otherwise the plain line); for a branch use `refs/heads/<branch>`.
2. Action: edit the SHA and the `# vX.Y.Z` comment on every `uses:` of it (`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`).
3. Container: `docker buildx imagetools inspect espressif/idf:<tag>` (digest of the index), put it after `@`, and change the ESP-IDF
   version everywhere together (`docs/DEVELOPMENT.md`, `build.py`).
4. `deps.cmake` refs: edit patch 0006 by hand-editing `pico-keys-sdk/cmake/deps.cmake`, then regenerate it as described in
   `tools/apply_patches.py` (stage the baseline with `git -C pico-keys-sdk add -A`, diff, restore) so the tree and the patch stay
   identical; run `python tools/apply_patches.py --check`.
5. Python: change the line in `tools/requirements.txt` and re-resolve the transitive closure in a fresh venv (`pip freeze`).
6. Cargo: `cargo update -p <crate> --precise <version>` in `host/`, commit `Cargo.lock`.
7. Run `python tools/check_pins.py`, then update this document.

## Not pinned (known)

- **Rust toolchain**: CI uses `toolchain: stable` through the SHA-pinned `rust-toolchain` action, so the compiler version moves with
  upstream. `Cargo.lock` still fixes every crate. Pinning needs a deliberate choice of version (`rust-version` is 1.89).
- **Runner images and apt packages**: `ubuntu-latest`, `windows-latest`, `ubuntu-22.04/24.04` and the `apt-get install` lists
  (libpcsclite, libudev, libpam, ccache, ...) come from the runner/distribution at run time.
- **Transitive git submodules of fetched repos** (for example mbedTLS's `framework`) are not initialised by `picokeys_sync_dep`; if
  upstream ever requires them the build fails instead of fetching an unpinned tree.
- **Upstream RP2040 helpers** under the submodules (`pico_sdk_import.cmake` with `PICO_SDK_FETCH_FROM_GIT_TAG`, Dockerfiles) are
  not used by the ESP32 build and are not checked.
- Hash-locked pip installs (`--require-hashes`) are not used; versions are exact but file hashes are not verified.
- The `web/` dependencies are locked by `web/pnpm-lock.yaml` and installed with `--frozen-lockfile`.

# Dependency and upstream check, 2026-11-25

Read-only check done for the firmware audit remediation. Nothing was bumped: no submodule, no ESP-IDF, no IDF component, no web or
Rust dependency changed. Status words: these are static findings; nothing here is hardware verified.

## ESP-IDF

`git ls-remote --tags https://github.com/espressif/esp-idf 'v5.5.*'` on 2026-11-25: newest tag is `v5.5.6` (our pin). No v5.5.7
exists, so 5.5.6 stays. Re-run the check before every release.

### CVE-2026-113783 (lwIP DNS stack overflow, 2026-11-04)

Not reachable in our images. Evidence (prod fido build `build-fido-prod/multikey-fido.elf`, built 2026-11-25):

- `CONFIG_ESP_WIFI_ENABLED` is off (`sdkconfig.defaults`). Our images have no Ethernet, Wi-Fi or USB-NCM netif.
  `USB_ITF_LWIP` (the only path that calls `lwip_itf_init()` in `pico-keys-sdk/src/main.c`) is not enabled by our images.
- `liblwip.a` objects are listed in the link map (the sdkconfig still has `CONFIG_ESP_NETIF_TCPIP_LWIP=y`,
  `CONFIG_LWIP_DNS_SUPPORT_MDNS_QUERIES=1`), but `xtensa-esp32s3-elf-nm` on the final ELF shows only two lwIP symbols,
  `lwip_htonl` and `lwip_inet_pton`; no `dns_*` function (so no DNS client or response parser) is in the binary.
- Conclusion: the vulnerable DNS code is not linked and has no network input. No config change needed. Optional belt-and-braces
  (not applied, would only change the sdkconfig): `CONFIG_LWIP_DNS_SUPPORT_MDNS_QUERIES=n`.

## Upstream submodules (fetched 2026-11-25, nothing checked out)

| Submodule | Pin | upstream/main | Commits ahead |
|---|---|---|---|
| pico-fido | `15b848d` (v8.2) | `b97372c` (2026-11-18, `nightly-development`) | 23 |
| pico-keys-sdk | `50699e5` | `325c0a9` (2026-11-16) | 8 |
| pico-openpgp | `9b23276` | same (no new commits) | 0 |

Decision (plan rule): no bump; port the fix hunk into our own patch and cite the SHA. Inspect any commit with
`git -C <sub> show <sha>`.

### Per-finding comparison

| Audit finding | Upstream fix? | Upstream commit | Action for our patch |
|---|---|---|---|
| getPinToken `pinHashEnc` length (0x05/0x09) | yes | pico-fido `b1df38d` (2026-10-30) | Port. Upstream checks `pinHashEnc.len == 16` (proto 1) / `16 + IV_SIZE` (proto 2) right after the protocol check, before `permissions`/retry code. Same as plan item 1b. Upstream returns `CTAP1_ERR_INVALID_PARAMETER` (0x02). |
| `decrypt()` accepts `in_len` 0 / not a multiple of 16 / below IV+16 | **no** | none | Our own fix (plan item 1a). Do not rely on upstream. |
| `ecdh()` ignores `mbedtls_ecdh_compute_shared` return, no peer check | **no** | none | Our own fix (plan item 2). |
| `verify()` `pinUvAuthParam.len` | partly | pico-fido `d5c28ab` checks `pinUvAuthParam.len == (proto==1 ? 16u : 32u)` only in the vendor BACKUP restore path | Our own fix in `verify()` (plan item 3). |
| `credential_verify` `cred_id_len` underflow | partly | pico-fido `76e3333` (2026-11-16) | Port; but see the note below, upstream's guard only covers the new-format branch. |
| CTAP1/U2F key-handle length (`cmd_authenticate`) | yes (not an audit finding, related) | pico-fido `8992174`, `7f3c49c`, `7633fc8` | Optional port: `keyHandleLen > CTAP_MAX_KH_SIZE` and `nc < offsetof(keyHandle)+keyHandleLen` checks and calloc NULL check. Recommended since it is the same bug class. |
| APDU chaining overflow into the 2048-byte rx buffer | yes | pico-keys-sdk `325c0a9` (2026-11-16, "Fix chaining overflow") | Port (see appendix B). Replaces our plan item 10 design: upstream assembles into `chain_buf` itself and adds `apdu_process_ccid()` that stages every unchained CCID APDU into `chain_buf` too. |
| `cbor_vendor` BACKUP/UNLOCK/MSE/EA unauthenticated | partly | pico-fido `d5c28ab` (2026-11-02) hardens only BACKUP **restore** (0x01 data): length check `12 + sizeof(keydev_dec) + 16`, requires ACFG pinUvAuth token when a PIN is set, forces a button wait when no PIN, return codes on `file_put_data`, clears `keydev_dec`. UNLOCK, MSE, EA unchanged. | We disable the commands entirely (plan phase 2 item 2); do not port. Mention in the patch header that upstream only hardened BACKUP restore. |
| Power-cycle lockout cleared by `init_fido` | yes | pico-fido `db4e0e8` (2026-11-02): removes `needs_power_cycle = false` from `init_fido`, clears it in `cbor_reset`, and adds `if (needs_power_cycle) CBOR_ERROR(CTAP2_ERR_PIN_AUTH_BLOCKED)` in getPinToken | Port both halves (plan phase 2 item 9 only covered the first). |
| `low_flash.c` ignores `esp_partition_*` errors | **no** | none (`git diff HEAD origin/main` touches no `src/fs/low_flash.c`) | Our own fix (plan item 11). |
| HID other-channel busy / `job_cid` | **no** | none (only `b7dd626` OTP report size and `tud_hid_get_report_cb` return value change in `hid.c`) | Our own fix (plan phase 2 item 8). |
| Rescue user presence (`rescue_require_user_presence`, PHY write, SET TIME) | **no** | none | Our own fix. |
| `otp_esp32.c` secure-boot burn / MKEK provisioning | **no** | none | Our own fix. |
| FIDO/OATH button presence | yes (extra) | pico-fido `4ad31d1` (`FORCE_BUTTON_WAIT`, `wait_button_pressed_timeout` returns 1 on core 0 task) | Not a finding; our patches 0001/0006 cover UP. Do **not** port (conflicts with 0001/0006 and the `hcore0` check could skip our wait). |
| Resident-credential rp_id hash check | yes | pico-fido `af2b44a` (2026-11-17) | Optional, not an audit finding. |
| Brainpool COSE kty=2 / assertion hash | yes | pico-fido `47993c5`, `0c8ba81` | Not an audit finding; not ported. |
| pico-keys-sdk `ccid`/`emulation` use `apdu_process_ccid` | yes | pico-keys-sdk `325c0a9` | Part of the apdu port. |
| `cbor.c` duplicate-key rejection, `management.c tlv_walk`, `cbor_cred_mgmt.c` walk state, `cbor_vendor.c` CSR leak, largeBlobs, U2F register alwaysUv, silent tag | **no** | none | Our own fixes (plan items 1.5-1.9, 2.4-2.7). |
| pico-openpgp findings | pico-openpgp has no new commits | none | Our own patch. |

Note on `76e3333`: upstream returns early only when the id starts with `CRED_PROTO_22_S`/`CRED_PROTO_25_S` and
`cred_id_len < CRED_SILENT_ENVELOPE_OVERHEAD` (= `CRED_ENVELOPE_OVERHEAD + CRED_SILENT_TAG_LEN`). That is the exact `F1D00202`-prefixed
case in the plan's test (`test_credential_id_short_with_proto_prefix`, 28..43 byte bodies). The older-format branch
(`tag = cred_id + cred_id_len - CRED_TAG_LEN`) is not length-checked; in our patch also guard it (`cred_id_len < CRED_PROTO_LEN + CRED_TAG_LEN`)
and keep the plan's `cred_id_len < hdr_len + 16` check after `hdr_len` is computed.

## IDF components (IDF component registry, checked 2026-11-25)

| Component | Locked | Latest | Decision |
|---|---|---|---|
| `espressif/esp_tinyusb` | `1.7.6~2` | `3.0.1` stable (3.x removes DCD slave/IRQ mode, drops old IDF, has breaking API changes); 2.x `2.4.0` fixes an IAD descriptor for NCM devices only | Not bumped. No changelog entry found that touches CCID, vendor or HID control paths; a major bump changes USB descriptors and DMA mode without hardware testing. Re-check when moving IDF. |
| `espressif/tinyusb` | `0.21.0~6` | `0.21.0~6` (the version esp_tinyusb 3.0.1 pins) | Current. |
| `zorxx/neopixel` | `1.0.10` | `1.2.0` (uploaded about 3 months ago) | Not bumped: LED-only driver, no security fix known; only worth taking once LED hardware is verified. |

## mbedTLS

`pico-keys-sdk/cmake/deps.cmake` pins fork `polhenarejos/mbedtls` tag `v3.6.7-eddsa` (`fc39404125e93ee00e6758605e6c6f2c8db440f1`).
Upstream `mbedtls-3.6.8` was released 2026-11-16 (commit `82e6999`, `80f401715ae67e45961973e01cc087ea3765f38b`). The fork has **no**
`v3.6.8-eddsa` tag (only `v3.6.7-eddsa`; its `HEAD` is `caaa938`, an unrelated development branch). Status: **pending upstream fork**.
Do not change the pin in patch 0006.

3.6.8 fixes 21 advisories. Relevance to a firmware that uses only the crypto/ASN.1 half (no TLS, no X.509 parsing of untrusted
input; CSR writing only):

- TLS 1.2/1.3 and certificate-verification advisories (CVE-2026-93843, -115491, -93831, -116375, -115490, -93776, -93777, -93844, -115488,
  -116462, -90475, -90470, -115489, -90469 ECJPAKE): not reachable (no TLS, no CRL, no ECJPAKE; `config/mbedtls_config.h` is authoritative).
- CVE-2026-50582 (PKCS5/PKCS12 iteration count): not used.
- Spectre-PHT side channels (CVE-2026-115493, -93833, -93835, -93842) and p256-m branch leak (CVE-2026-93845): Spectre-v1 needs a
  speculative core; ESP32-S3 Xtensa LX7 is in-order, no speculation. p256-m driver is not enabled in our config
  (`MBEDTLS_PSA_P256M_DRIVER_ENABLED` unset) [INFERENCE: not re-grepped in the built config].
- CVE-2026-115492 "AES timing side channel through flash reads to ROM table": affects the software AES table path; the S3 uses the
  hardware AES peripheral for AES [INFERENCE]; track it for the fork update.
- Earlier ones that apply to 3.6.7 as well: CVE-2026-49300 (X.509 CA bit forgery, up to 3.6.6, so already fixed in 3.6.7).

Action: ask the fork owner for `v3.6.8-eddsa`; until then record this entry as accepted risk.

## Web (`cd web; pnpm audit --prod`, 2026-11-25)

One finding, moderate: `minimatch` `>=7.0.0 <11.0.1` ReDoS (GHSA-g3hv-75wg-m249), path
`.>shadcn>ts-morph>@ts-morph/common>minimatch`. `shadcn` is a codegen CLI listed in `dependencies`, not shipped in the bundle; plan
phase 6 item 10 moves it to `devDependencies`. No High/Critical, so `web/package.json` and `pnpm-lock.yaml` were not changed.
`pnpm outdated esptool-js fflate` printed nothing (both current).

## Rust host (`cd host; cargo audit`, cargo-audit 0.23.0 installed `--locked`, 1567 advisories, 182 crates)

One vulnerability: `crypto-bigint` 0.5.5, RUSTSEC-2026-0387 (timing variability in constant-time operations, patched in `>=0.7.6`).
Dependency path: `p256 0.13.2 -> elliptic-curve 0.13.8 -> crypto-bigint 0.5.5`, used by `multikey-proto` only for P-256 ECDSA
**verification** of public data (attestation/transcript signatures on the host). No secret key is handled on the host, so the
timing issue is not exploitable. `cargo update -p crypto-bigint` cannot reach `>=0.7.6` (p256 0.13 / elliptic-curve 0.13 require
0.5.x); the fix needs the p256 0.14 / elliptic-curve 0.14 line, a breaking dependency upgrade. Not applied. Record as accepted until
`p256` 0.14 is released stable. No other warnings.

# Appendix A: ready-to-apply upstream hunks (pico-fido)

All paths relative to the submodule; upstream files are CRLF. Check the context against our patched tree
before use (our patches 0001-0006 touch `fido.c`, `cbor_client_pin.c`, `credential.c`).

A1. `b1df38d` getPinToken pinHashEnc length (`src/fido/cbor_client_pin.c`, in the 0x05/0x09 branch right after the protocol check):

```c
        if ((pinUvAuthProtocol == 1 && pinHashEnc.len != 16) ||
            (pinUvAuthProtocol == 2 && pinHashEnc.len != 16 + IV_SIZE)) {
            CBOR_ERROR(CTAP1_ERR_INVALID_PARAMETER);
        }
```

A2. `db4e0e8` power-cycle lockout. In `cbor_client_pin.c` getPinToken after the `PIN_BLOCKED` retry check:

```c
        if (needs_power_cycle) {
            CBOR_ERROR(CTAP2_ERR_PIN_AUTH_BLOCKED);
        }
```
`cbor_reset.c`: `extern bool needs_power_cycle;` at top and `needs_power_cycle = false;` after `fido_reset_storage()` succeeds, before
`init_fido()`. `fido.c`: delete `needs_power_cycle = false;` (and its `extern`) from `init_fido()`.

A3. `76e3333` (`src/fido/credential.c` `credential_verify`, inside the `CRED_PROTO_22_S`/`CRED_PROTO_25_S` branch):

```c
        if (cred_id_len < CRED_SILENT_ENVELOPE_OVERHEAD) {
            return -1;
        }
```

A4. `8992174` + `7f3c49c` U2F authenticate length checks (`src/fido/cmd_authenticate.c`):

```c
    const size_t key_handle_offset = offsetof(CTAP_AUTHENTICATE_REQ, keyHandle);
    if (apdu.nc < key_handle_offset) return SW_WRONG_DATA();
    if (req->keyHandleLen < KEY_HANDLE_LEN || req->keyHandleLen > CTAP_MAX_KH_SIZE) return SW_INCORRECT_PARAMS();
    if ((size_t)apdu.nc < key_handle_offset + req->keyHandleLen) return SW_WRONG_DATA();
    ...
    uint8_t *tmp_kh = (uint8_t *) calloc(1, req->keyHandleLen);
    if (tmp_kh == NULL) { mbedtls_ecp_keypair_free(&key); return SW_MEMORY_FAILURE(); }
```
(`7f3c49c`/`7633fc8` change `CTAP_MAX_KH_SIZE` handling in `ctap.h`; read both before use.)

A5. `d5c28ab` BACKUP restore hardening is **not** to be ported if the command is disabled (plan phase 2 item 2). If a tool needs
BACKUP, port the whole hunk in `cbor_vendor_generic` case `CTAP_VENDOR_BACKUP` (see `git -C pico-fido show d5c28ab -- src`).

# Appendix B: ready-to-apply upstream hunks (pico-keys-sdk)

B1. `325c0a9` "Fix chaining overflow" (`git -C pico-keys-sdk show 325c0a9`): touches `src/apdu.c`, `src/apdu.h`,
`src/usb/ccid/ccid.c`, `src/usb/emulation/emulation.c`. None of our patches 0001-0006 touch these files (only 0005 touches `hid.c`),
so it should apply to our baseline. Design summary for the patch author:

- `chain_buf` becomes `uint8_t chain_buf[APDU_CHAIN_HEADER_SIZE (7) + APDU_STAGING_DATA_SIZE]`,
  `APDU_STAGING_DATA_SIZE = max(USB_BUFFER_SIZE, 2038)`, data area `APDU_CHAIN_DATA = chain_buf + 7`. The chained-data capacity check
  still uses `APDU_CHAIN_DATA_SIZE` (2038): `if (chain_used + apdu.nc >= APDU_CHAIN_DATA_SIZE) { wipe; return SW_WRONG_LENGTH(); }`
  (note `>=`, so a total of 2038 is already rejected).
- Final chunk: copy the header (`apdu.data - apdu.header`, at most 7 bytes) in front of `APDU_CHAIN_DATA`, `memcpy(chain_ptr, apdu.data, apdu.nc)`,
  then set `apdu.header = APDU_CHAIN_DATA - header_size; apdu.data = APDU_CHAIN_DATA; apdu.nc += chain_used`; this removes the old
  `memmove(apdu.data + chain_used, ...)` into the rx buffer. `chain_buf` is wiped after the command.
- `apdu_process_internal(itf, buffer, stage_data)`: case-1 and case-2 APDUs now set `apdu.data = apdu.header + 4/5/7` (no stale pointer);
  with `stage_data` (CCID path only: `apdu_process_ccid`) every unchained command's data is copied into `chain_buf` so the app never reads
  the rx buffer. Wrapper `apdu_process()` keeps the old signature for other callers.
- `ccid.c` (`CCID_XFR_BLOCK`) and `emulation.c` call `apdu_process_ccid`.
- Compared with plan item 10: upstream uses a larger staging area and a wipe on completion instead of `chain_buf` size 2038 exactly;
  the capacity limit (2038, strict) is equivalent. Plan item 12 (emulation `USB_BUFFER_SIZE`) is still worth doing, because the staging
  buffer size depends on `USB_BUFFER_SIZE` (4096 in emulation gives a larger area than the device, so tests of the 2037/2039 boundary
  still hit the 2038 check, but not an overflow of the device rx buffer).
- Our patch must still check `src/usb/hid/hid.c` chaining/CTAPHID reassembly separately: upstream has no change there.

B2. `b7dd626` (hid.c OTP report size) and the `tud_hid_get_report_cb` return value fix (`hid.c:131`): not security findings; optional.
B3. `d8fce97` core1 stack increase (`src/usb/usb.c`): not an audit finding; optional.

# Appendix C: upstream gaps (own fixes required)

No upstream commit through `pico-fido` `b97372c` / `pico-keys-sdk` `325c0a9` fixes: `decrypt()` input length, `ecdh()` return value,
`verify()` param length, low_flash error handling, HID busy-channel isolation and `job_cid`, rescue user presence / PHY write / SET TIME,
`otp_esp32.c` secure-boot burn and MKEK provisioning, `random.c` shared static, `hwrng.c` tests, vendor UNLOCK/MSE/EA, management
WRITE_CONFIG/RESET, U2F register alwaysUv, credMgmt 0x41 alias, largeBlobs state reset, silent tag, and every pico-openpgp item
(pico-openpgp has no commits after our pin). Implement these in our stacked patches as planned.
