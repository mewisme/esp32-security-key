# Protocols

| Protocol | Provided by | Status |
|---|---|---|
| CTAPHID, CTAP2, U2F | upstream pico-fido v8.2 + local patches (`patches/pico-fido`): `GetInfo` on hardware: versions `U2F_V2, FIDO_2_0..2_3`, AAGUID `0a63b994-8ba6-5e74-9e5a-0f894cc35c4d` (development value, docs/USB_IDENTITY.md) | Basic flows hardware verified on one board; UV/PIN policy in `docs/FIDO_UV.md`. No FIDO certification claimed. |
| OpenPGP card 3.x | upstream pico-openpgp main `9b23276` (v5.0 + 48 commits; separate firmware image, see ADR-0002) | Build verified (ROADMAP). Not hardware verified. |
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
| `04` | REVOKE | `PIN` | none | Requires PIN and a button press. Deletes the key and PIN, state returns to 0. |
| `06` | DEVICE_NAME | by P1, see below | `flags(1)` ‖ `name` (GET, SET, CLEAR) | Read or change the name the key reports over USB. |

- `pubkey` = uncompressed SEC1 P-256 point (`04 ‖ X ‖ Y`).
- `device_id` = 16 random bytes generated at enrollment (stored with the key); GET_INFO returns 16 zero bytes while unenrolled.
- Hosts send Le=0x00 on GET_INFO, ENROLL and CHALLENGE and no Le on REVOKE; the applet must accept both forms.
- Signature = ECDSA P-256 over SHA-256 of the transcript
  `"MKAUTH-v1\0" (10 bytes) ‖ host_nonce(32) ‖ device_nonce(32) ‖ device_id(16)`.
  Host nonce must be fresh random bytes chosen by the verifier for every attempt; the device keeps no replay state.
- PIN: 8 attempts, counter persisted and decremented before the comparison (a power cut cannot give free guesses). Wrong PIN → `63Cx` (x = remaining tries); 0 left → `6983`. A blocked applet is **not recoverable** except by erasing the device's key-storage partition (full re-provisioning); the FIDO `authenticatorReset` does not clear MKAUTH state.
- PIN storage: PBKDF2-HMAC-SHA256, 10000 iterations, 16-byte random salt. The private key is wrapped with the pico-keys device key (`derive_kbase`) so CHALLENGE needs no PIN. On a build without OTP/Secure-Lock the device key is derived from the chip serial hash only, so at-rest protection depends on flash encryption (see SECURITY.md).
- RNG: the pico-keys SDK RNG (`random_fill_iterator`), the same source upstream uses for FIDO.
- Status words: `9000` ok · `6300` no button press within `CONFIG_MULTIKEY_UP_TIMEOUT_MS` (default 15000 ms) ·
  `6700` wrong length · `6983` PIN blocked · `6985` wrong state (INS 06: renaming compiled out) · `6A80` incorrect data
  (INS 06: invalid name, or a PIN supplied while none exists) · `6A86` bad P1/P2 · `6D00` unknown INS · `6E00` unknown CLA · `6F00` internal error.
- Verification by the host: check `signature` against the **trusted** public key for the user (trust store), using the
  transcript built from the host's own nonce and the returned device nonce and the trusted `device_id`.

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
  (`cmd_revoke` deletes only `0xBC00`; `fido_reset_should_clear` does not list prefix `0xBC`) and was not run. Details: `docs/USB_IDENTITY.md`.
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
