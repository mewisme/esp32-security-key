# Protocols

| Protocol | Provided by | Status |
|---|---|---|
| CTAPHID, CTAP2, U2F | upstream pico-fido v8.2 + local patches (`patches/pico-fido`): `GetInfo` on hardware: versions `U2F_V2, FIDO_2_0..2_3`, AAGUID `0a63b994-8ba6-5e74-9e5a-0f894cc35c4d` (development value, docs/USB_IDENTITY.md) | Basic flows hardware verified on one board; UV/PIN policy in `docs/FIDO_UV.md`. No FIDO certification claimed. |
| OpenPGP card 3.x, PIV (CCID) | upstream pico-openpgp main `9b23276` (v5.0 + 48 commits; separate firmware image, see ADR-0002). AIDs: OpenPGP `D2760001240103...` (checked by `tools/gpg_smoke.*`), PIV `A000000308` | Build verified (4/8/16 MB), Experimental release image. Not hardware verified (`docs/OPENPGP.md`). |
| SSH `ecdsa-sk` / `ed25519-sk` | FIDO2; ed25519-sk requires EdDSA in `GetInfo` algorithms | Not tested |
| Git SSH signing | `ssh-keygen -Y sign` with sk key | Not tested |
| MKAUTH applet | this repo | Specified below; see ROADMAP for implementation status |

## MKAUTH v1 (custom challenge-response applet)

Transport: CCID (PC/SC), ISO 7816-4 APDUs, short APDUs only. Available in the **fido** firmware image.
Select: `00 A4 04 00 08 F0 4D 4B 41 55 54 48 01` → `9000` with data `"MKAUTH 1"` (ASCII, 8 bytes).

All commands use `CLA=0x80`. `P1=P2=0x00` except INS `06` (P1 = operation, P2 = `00` or `01`).

| INS | Name | Command data | Response data | Notes |
|---|---|---|---|---|
| `01` | GET_INFO | none | `ver(1)=0x01` ‖ `state(1)` ‖ `policy(1)=0x01` ‖ `device_id(16)` ‖ `pubkey(65)` if `state=1` | state 0 = unenrolled, 1 = enrolled. policy bit0 = user presence required (always set, not changeable). |
| `02` | ENROLL | `PIN` (6..63 bytes) | `pubkey(65)` ‖ `device_id(16)` | Only when unenrolled (else `6985`). Sets the PIN, generates a P-256 key, requires a button press. |
| `03` | CHALLENGE | `host_nonce(32)` | `device_nonce(32)` ‖ `signature(DER ECDSA, ≤72)` | Only when enrolled (else `6985`). Requires a button press. No PIN needed (the signature proves possession; the physical press proves presence). |
| `04` | REVOKE | `PIN` | none | Requires a button press, then the PIN. Deletes the key, PIN and retry counter, state returns to 0. |
| `06` | DEVICE_NAME | by P1, see below | `flags(1)` ‖ `name` (GET, SET, CLEAR) | Read or change the name the key reports over USB. |
| `07` | BUILD_INFO | none | `fmt(1)=01` ‖ `tag ‖ len ‖ value`... | What is running on the key: version, source commit, image SHA-256, chip. Read-only, no button, no PIN. See below. |

- `pubkey` = uncompressed SEC1 P-256 point (`04 ‖ X ‖ Y`).
- `device_id` = 16 random bytes generated at enrollment (stored with the key); GET_INFO returns 16 zero bytes while unenrolled.
- Hosts send Le=0x00 on GET_INFO, ENROLL and CHALLENGE and no Le on REVOKE; the applet must accept both forms.
- Signature = ECDSA P-256 over SHA-256 of the transcript
  `"MKAUTH-v1\0" (10 bytes) ‖ host_nonce(32) ‖ device_nonce(32) ‖ device_id(16)`.
  Host nonce must be fresh random bytes chosen by the verifier for every attempt; the device keeps no replay state.
- PIN: 8 attempts, counter persisted and decremented before the comparison (a power cut cannot give free guesses). Wrong PIN → `63Cx` (x = remaining tries); 0 left → `6983`. A blocked applet is **not recoverable** except by erasing the device's key-storage partition (full re-provisioning); the FIDO `authenticatorReset` does not clear MKAUTH state.
- PIN storage: 16-byte random salt, `PBKDF2-HMAC-SHA256(pin, salt, 10000)`, and (record version 2) the stored verifier is
  `HMAC-SHA256(kbase, PBKDF2 output)` with `kbase` = the pico-keys device key (`derive_kbase`). A record of version 1 (verifier = PBKDF2
  output only) is accepted once on a correct PIN and rewritten as version 2. The private key is wrapped with the pico-keys device key
  (`derive_kbase`) so CHALLENGE needs no PIN. On a build without OTP/Secure-Lock the device key is derived from the chip serial hash only, so
  at-rest protection depends on flash encryption (see SECURITY.md). Enrollment fails with `6F00`, storing nothing, if wrapping the key fails.
- Files: `0xBC00` = record (magic `MKA1`, record version byte: 1 or 2, device_id, salt, verifier, pubkey, wrapped key; written at enrollment and
  when a version 1 record is upgraded, never per PIN attempt); `0xBC02` = PIN tries left (1 byte, rewritten on every attempt); `0xBC01` = device name.
  When `0xBC02` is missing it is created from the record's counter. A record that carries the `MKA1` magic but has the wrong size or an unknown
  version answers `6F00` to every command (it is not treated as "unenrolled", so ENROLL cannot overwrite it).
- **Button before PIN:** REVOKE and the PIN-protected INS 06 operations wait for the button first; only after a press is the PIN checked and an attempt
  spent. With no press the answer is `6300` and the retry counter is unchanged. Malformed lengths (`6700`) and names (`6A80`) are still rejected
  before the button is awaited. The PIN bytes in the APDU buffer are zeroized after use.
- RNG: the pico-keys SDK RNG (`random_fill_iterator`), the same source upstream uses for FIDO.
- Status words: `9000` ok · `6300` no button press within `CONFIG_MULTIKEY_UP_TIMEOUT_MS` (default 15000 ms) ·
  `6700` wrong length · `6983` PIN blocked · `6985` wrong state (INS 06: renaming compiled out) · `6A80` incorrect data
  (INS 06: invalid name, or a PIN supplied while none exists) · `6A86` bad P1/P2 · `6D00` unknown INS · `6E00` unknown CLA · `6F00` internal error.
- Verification by the host: check `signature` against the **trusted** public key for the user (trust store), using the
  transcript built from the host's own nonce and the returned device nonce and the trusted `device_id`.

### Known limitations (MKAUTH v1)

- The CHALLENGE transcript (`"MKAUTH-v1\0" ‖ host_nonce ‖ device_nonce ‖ device_id`) is not bound to a verifier context (relying-party
  name, host, transport, session). A signature obtained from the key for one verifier's nonce is only useless to another verifier because
  nonces are fresh and verifiers choose them; there is no protection against a malicious host that relays a nonce chosen by a third party
  while the user presses the button. Adding a context string to the transcript changes the wire format (firmware, `multikey-proto`, web)
  and therefore needs a protocol v2; it is **not** part of this version. The v1 identifier in GET_INFO (`ver = 0x01`) and in the transcript
  prefix stays `MKAUTH-v1`; a v2 transcript must use a different prefix and a different `ver`, so v1 and v2 signatures can never be confused.
- The record format version (below) is independent of this protocol version.

### INS 06 DEVICE_NAME (USB product name)

| P1 | Operation | Command data | Authorization |
|---|---|---|---|
| `00` | GET | none | none. Response: `flags(1)` ‖ `name`. flags: bit0 a user name is stored (else the build default), bit1 the stored name differs from the one the host currently sees (re-enumeration pending), bit2 renaming is compiled in. `name` = what the next enumeration reports. |
| `01` | SET | `pin_len(1)` ‖ `PIN` ‖ `name` | button press; PIN too once enrolled (`pin_len` must be 0 while unenrolled, else `6A80`). Name: 1..31 printable ASCII (0x20..0x7E), no leading/trailing space, else `6A80` (checked **before** a PIN attempt is spent or the button awaited). Response as GET. |
| `02` | CLEAR | `pin_len(1)` ‖ `PIN` | same as SET. Restores the build-time default name. Response as GET. |
| `03` | REENUM | `pin_len(1)` ‖ `PIN` | same as SET. Detaches/attaches USB (~1.5 s) after the status word has been sent. Response: none. |

- P2 bit0 = 1 on SET/CLEAR: also re-enumerate afterwards (same as a following REENUM without a second press). P2 > 1 → `6A86`.
- The name is stored in its own file `0xBC01`: keys, credentials, PINs, VID/PID and the FIDO AAGUID are never touched. It survived
  reboot and a firmware update on hardware; that it also survives MKAUTH REVOKE and FIDO `authenticatorReset` follows from the code
  (`cmd_revoke` deletes only `0xBC00` and `0xBC02`; `fido_reset_should_clear` does not list prefix `0xBC`) and was not run. Details: `docs/USB_IDENTITY.md`.
- Short APDU, Lc ≤ 1+63+31 = 95. Hosts send Le=0x00 on GET/SET/CLEAR and no Le on REENUM.
- The web installer sends the same APDUs (SELECT, GET_INFO, INS 06 GET/SET/CLEAR with P2 = 1) over the WebCCID interface: the second, vendor-class (0xFF, two bulk endpoints, WinUSB-bound) interface runs the same CCID parser as the smart-card interface, which Chrome's WebUSB refuses to claim (`web/src/lib/device/{mkauth,webccid}.ts`).
- **Timing on the WebCCID interface (observed, Windows 11, Chrome, one board):** after the key restarts its USB connection the first command can go
  unanswered. A SELECT sent 1 ms after Chrome's `connect` event got no answer in 5 s (IccPowerOn, answered by the USB task, did work); the same
  sequence sent a second later was answered in about 10 ms, and over libusb (with a 1 s pause) every answer arrived in 10 ms. Likely cause
  (read from `pico-keys-sdk/src/usb/usb.c`, **not confirmed by a trace**): the card core serves one interface at a time and `card_start` calls
  `card_exit`, which flushes queued commands, when another interface (here Windows' own smart-card stack probing the CCID interface right after
  enumeration) sends a command. The page therefore waits 1 s after the key is back and reads on a fresh claim, up to 6 times; the key's
  `6300` (button not pressed) is shown as such only when the key says it. With no BOOT press (libusb probe) the key answers `6300` after
  exactly 15.03 s, sends a time-extension frame every 1.51 s, and one extra vendor frame (`0x7F`, payload `03 00 03`) when the wait starts.

### INS 07 BUILD_INFO (what is running on the key)

`80 07 00 00 00`. Read-only: no button, no PIN, nothing is written. A firmware built before this command answers `6D00`; the host tools
and the web page then say the firmware cannot report its build. Response: `fmt(1) = 01`, then entries `tag(1) ‖ len(1) ‖ value(len)`
(at most 255 bytes in all). A reader skips tags it does not know and rejects a repeated tag, a truncated entry, or a text entry that is
not printable ASCII (nothing a device sends can inject control characters into a terminal or a page).
Tags `01`-`03`, `06`, `07`, `09`-`0C` are always present; tags `04`, `05`, `08` and `0D` are optional and are left out when they do not fit in
the 255-byte response (or, for `05`/`08`, cannot be computed). Readers must not require them.

| Tag | Value | Source |
|---|---|---|
| `01` | project name, ASCII | `esp_app_desc_t.project_name` (`multikey-fido`) |
| `02` | version, ASCII | `esp_app_desc_t.version`: the host workspace version, `-dev` suffix on non-release builds |
| `03` | ESP-IDF version, ASCII | `esp_app_desc_t.idf_ver` |
| `04` | source commit, ASCII | 12 hex digits of `git rev-parse HEAD` when CMake configured, `+dirty` if tracked files (submodules ignored) differed, `unknown` outside a git checkout |
| `05` | SHA-256 of the app image as flashed, 32 bytes | computed over the first `image_len` bytes of the running partition, appended digest included, so it equals the manifest's `images[role=app].sha256` (checked: `file size == image_len` for a real build). Computed once per boot (about 600 KB of flash), then cached |
| `06` | SHA-256 of the app ELF, 32 bytes | `esp_app_desc_t.app_elf_sha256` |
| `07` | flash size the image was built for, ASCII (`16MB`) | `CONFIG_ESPTOOLPY_FLASHSIZE` |
| `08` | flash size the chip reports, u32 BE bytes | `esp_flash_get_physical_size` |
| `09` | security flags, 1 byte: bit0 flash encryption on, bit1 secure boot on | `esp_flash_encryption_enabled`, `esp_secure_boot_enabled` |
| `0A` | chip: model(1) ‖ full revision(2, BE, major×100+minor) ‖ cores(1) | `esp_chip_info` (model 9 = ESP32-S3) |
| `0B` | reset reason of this boot, 1 byte | `esp_reset_reason_t` |
| `0C` | seconds since boot, u32 BE | `esp_timer_get_time` |
| `0D` | running partition: offset(4, BE) ‖ label, ASCII | `esp_ota_get_running_partition` |

Nothing here identifies the owner or the individual key: the MAC address, the serial number and the MKAUTH `device_id` are not part of
it. A host compares tag `05` with the release manifests to learn whether the key runs exactly a published image: a match is proof that
it is that image, no match means a local, modified or unlisted build (it is not proof of tampering). `multikey device build --manifest
FILE` and the web page "Your key" do exactly that.

### Live events (passkey activity)

pico-fido reports every passkey operation as it happens. `event_send` (upstream `src/fido/event.c`) is called when a registration
(`makeCredential`) or a sign-in (`getAssertion`) finishes, successfully or not, and when the key starts waiting for the BOOT button.
The message is pushed on the **bulk IN endpoint of the vendor-class (WCID) interface**, the interface that carries MKAUTH for the web
installer and is bound to WinUSB; it is not visible through PC/SC. It is a CCID message of type `0x7F`:

```
CCID header (10 bytes): 7F | dwLength (LE32) | bSlot=0 | bSeq=0 | bStatus | 00 00
payload:                op(1) | result(1) | total length(1) | { type(1) | len(1) | value }...
```

`op`: 1 makeCredential, 2 getAssertion, 3 waiting for the button. `result`: 0 pending (a button wait), 1 ok, 2 error. `total length` is the
length of the whole payload. Fields (all optional):

| Type | Value |
|---|---|
| `01` | relying party id, text |
| `02` | user name, text |
| `03` | user display name, text |
| `04` | COSE algorithm, 4 bytes BE (two's complement: `-7` = `FFFFFFF9`, ES256) |
| `05` | authenticator-data flags, 1 byte (UP `01`, UV `04`, BE `08`, BS `10`, AT `40`, ED `80`) |
| `06` | CTAP2 status code of a failed operation, 1 byte |
| `07` | credentials that matched a sign-in request, 1 byte |
| `08` | for a button wait: the operation that needs the press (1 or 2) |

- **What it gives and what it does not.** The key sees the relying party id, the account the site chose, whether the button was pressed,
  whether it reported the user as verified (the UV flag; it is the authenticator's claim, and a probe sign-in with `up=false` can carry
  it without any button press), the algorithm and why a failure failed. It cannot tell which *provider* an account belongs to beyond
  that id, cannot tell when a past event happened, and learns nothing about passkeys that were never created on it. A non-resident
  credential leaves no trace on the key at all.
- **Text is untrusted.** The site chose it. It can be cut short and can end inside a UTF-8 sequence; decoders replace control and
  bidirectional-formatting characters (`multikey-proto` `sanitize_text`, the web `sanitizeText`).
- **Length (local patch).** Upstream built the event in a 64-byte buffer and dropped the *whole* event when the fields did not fit. A
  registration event spends 3 bytes on the header, 6 on the algorithm and 3 on the flags, which leaves 52 bytes for the three text
  fields, each with 2 bytes of framing: `github.com` + `alice` + `Alice A.` (36 bytes with framing) fit, a 12-character RP id with a
  25-character user name and a 25-character display name (68 bytes with framing) did not, and that registration left no trace.
  `patches/pico-fido/0004-multikey-wcid-event-size.patch` uses the 255 bytes the length field allows, writes the fixed-size fields first
  and cuts the text fields to the room left. Firmware built before this patch drops events whose text is long.
- **Queued events.** An unread event waits in the key until a host reads the endpoint, so the first reads of a new session can return events
  from before it started, and their time is unknown (hosts mark them "earlier"). Observed on hardware: `multikey device watch` printed
  three queued events on its first run and none on the second (`docs/hw-reports/2026-11-23-build-info-and-passkey-events.md`).
- **One reader at a time.** A single program can hold the interface: `multikey device watch` and the web page cannot run together.
- **Who can read them.** Any local program that can open the WinUSB interface (and any page the user lets claim the device in the
  browser). No PIN or button is needed: this is upstream behavior and `docs/SECURITY.md` says what it means.

## SSH and Git signing (procedure)

Uses the FIDO2 interface of the **fido** image; no firmware code is specific to SSH. Status of everything in this
section: **Not tested (needs hardware)**. Helper scripts: `tools/ssh_smoke.sh`, `tools/ssh_smoke.ps1`.

- Requirements: OpenSSH client >= 8.3 for the scripts (security-key `ecdsa-sk` keys appeared in 8.2; `-O verify-required` is available from 8.4). `ed25519-sk` additionally needs the device to advertise EdDSA (COSE alg `-8`) in `authenticatorGetInfo`; check with `python tools/ctap_smoke.py` (it prints the algorithm list). If `-8` is not listed, use `ecdsa-sk`.
- Create a resident key (stored on the device, recoverable on another machine): `ssh-keygen -t ecdsa-sk -O resident -O verify-required -O application=ssh:multikey-test -f ./id_ecdsa_sk` (touch the key when it blinks).
- `-O verify-required` makes the server demand user verification, i.e. the device PIN, in addition to the button. A FIDO PIN must be set first; without a PIN the device cannot satisfy it.
- Recover resident keys on a new machine: `ssh-keygen -K` (writes `id_*_rk` files into the current directory; run it in a scratch directory).
- Windows: use Win32-OpenSSH 9.x. Windows may route security-key access through the WebAuthn API and require an elevated (administrator) shell; this requirement is **unverified**.
- Git commit signing with the key (shown only; apply it yourself, nothing in this repo edits your git config):

```
git config --global gpg.format ssh
git config --global user.signingkey /path/to/id_ecdsa_sk.pub
git config --global commit.gpgsign true
git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
```

- Manual signature check: `ssh-keygen -Y sign -f id_ecdsa_sk.pub -n git msg.txt` then `ssh-keygen -Y check-novalidate -n git -s msg.txt.sig < msg.txt`.

| Item | Status |
|---|---|
| ssh-keygen ecdsa-sk (resident, verify-required) | Not tested (needs hardware) |
| ssh-keygen ed25519-sk | Not tested (needs hardware; depends on GetInfo EdDSA) |
| `ssh-keygen -K` resident download | Not tested (needs hardware) |
| `ssh-keygen -Y sign` / `check-novalidate` | Not tested (needs hardware) |
| Win32-OpenSSH path | Not tested (needs hardware; admin/WebAuthn requirement unverified) |
