# 2026-11-23: touch-only / UV policy, configurable USB identity, device rename, AAGUID

Date: 2026-11-23. Board: same ESP32-S3 N16R8 as `2026-11-23-first-run.md` (MAC 80:b5:4e:c8:22:78), Windows 11, python-fido2 2.2.1,
pyscard, `multikey` CLI built from this tree. Firmware: `fido` dev image, real pins (GPIO0 BOOT, no LED), flashed three times
during this session through the native USB port (`--after watchdog_reset`); only bootloader, partition table and app were written.
No eFuse, no Secure Boot/flash encryption, no hardened image, no `authenticatorReset`, **no PIN set** (not approved), key-store
partition never erased. Test credentials are non-resident for `multikey.test` / `multikey.survival`; no resident credential was created.

Build/unit/emulation results are listed separately at the end; everything in the "Hardware" tables ran on the board.

## Correction to the earlier report
`2026-11-23-first-run.md` says two resident test credentials remain on the key. Listing discoverable credentials for
`multikey.test` (touch required) returned **0** both before and after the firmware changes, so those earlier test credentials were
non-resident and nothing is stored on the key.

## Hardware: USB identity

Firmware 2 (after the first flash of this change). `tools/usb_identity.py` (bus-reported strings via PnP) and `multikey readers`:

| Item | Value seen |
|---|---|
| iProduct | `MultiKeys Security Key` |
| MI_00 (FIDO HID) / MI_01 (keyboard) / MI_02 (CCID) iInterface | `... FIDO` / `... Keyboard` / `... CCID` (name + suffix) |
| MI_03 (WinUSB) iInterface | none (esp_tinyusb keeps 8 string slots) |
| PC/SC reader | `MultiKeys MultiKeys Security Key CCID 0` (manufacturer + CCID interface string) |
| python-fido2 product name | `MultiKeys Security Key FIDO` |
| Device Manager names | unchanged generic driver names (`USB Composite Device`, `USB Input Device`, ...) |
| Previously (old firmware) | iProduct `ESP32-S3 MultiKey`, reader `MultiKey (dev) ESP32-S3 MultiKey CCID OTP FIDO 0`, HID interface string `HID Interface` |

Windows reported the new strings at the first enumeration after flashing, for the same device instance; no stale cached string
was seen.

## Hardware: GetInfo, AAGUID, UV options (PIN-less key)
`options = {rk, alwaysUv: false, credMgmt, authnrCfg, clientPin: false, largeBlobs, perCredMgmtRO, pinUvAuthToken, setMinPINLength,
makeCredUvNotRqd: true}`, no `uv` key, extensions include `hmac-secret`, AAGUID `0a63b994-8ba6-5e74-9e5a-0f894cc35c4d`
(was Pico FIDO's `89fb94b7-...`). Upstream sets `makeCredUvNotRqd` only after an `authenticatorReset` (source), and this key was never reset; the earlier report did not list the option. It reads `true` now, i.e. the first-boot default of patch `pico-fido/0003` took effect on the existing key without touching anything else.

## Hardware: results (final firmware, `tools/hw_session.py` and the tools it runs)

| Check | Result |
|---|---|
| GetInfo: clientPin present/false, no `uv`, alwaysUv false, makeCredUvNotRqd true, pinUvAuthToken, AAGUID == project value != upstream | PASS (7 checks) |
| Browser (Chromium) decision model for this GetInfo | printed; PIN-less key: discouraged/preferred (no rk, no hmac-secret) -> plain touch-only; required -> PIN token (create PIN) |
| raw `uv=true` makeCredential / getAssertion | PASS: `INVALID_OPTION` in 0.0 s, no touch |
| register + assert `userVerification=discouraged` (python-fido2 client) | PASS: UP=1 UV=0, signature valid, no PIN request |
| register + assert with the plain request Chromium sends for `preferred` | PASS: UP=1 UV=0, signature valid |
| python-fido2 client with `preferred` | `CONFIGURATION_UNSUPPORTED` before any request (client policy: it treats a present `clientPin` key as "UV supported") |
| `userVerification=required`, no PIN, register and assert | PASS: client fails with 0 touch prompts, no UV flag fabricated |
| no touch -> request fails | PASS: `OPERATION_DENIED` after 15.0-15.1 s |
| `CTAPHID_CANCEL` | PASS: `KEEPALIVE_CANCEL` 0.14 s after cancel; GetInfo answers 0.25 s later |
| press made between two requests does not satisfy the next (B on a fresh channel) | PASS: B refused after 15.1 s (the press was requested by banner; the script cannot observe that it was made) |
| **request B on the SAME channel right after a cancel** | **FAIL (known issue)**: B gets an instant empty success, replies shift by one, `CTAPHID_INIT` timeouts for a while; fresh channel is fine (`tools/ctap_cancel_probe.py`; `docs/FIDO_UV.md`). Not fixed. |
| credentials survive firmware update + AAGUID change + rename | PASS: non-resident credential created before the update (old AAGUID) signed after it, signature verified against the saved public key (two runs: after the update, and after the rename round trip). Resident credentials: none exist, so resident survival was **not** exercised |

## Hardware: MKAUTH device name

| Check | Result |
|---|---|
| GET without authorization (flags, name) | PASS |
| 11 malformed requests (non-ASCII, TAB, DEL, leading/trailing space, empty, 32 chars, bad pin_len, unknown P1, P2>1, PIN while unenrolled) | PASS: `6A80`/`6700`/`6A86` as specified, each in 0.01 s (no button wait, no PIN attempt) |
| valid SET without a press | PASS: `6300` after 15.0 s, name unchanged (also seen from the CLI: exit 4, name unchanged, before the final firmware) |
| rename with press + `--reenumerate` | PASS: name applied on the bus (iProduct, 3 interface strings, reader name), `pending` cleared (final firmware; the first run of the flow on the previous firmware failed only this flag: it stayed `true` after re-enumeration, fixed with `multikey_usb_name_applied`) |
| unplug/replug | PASS: custom name still used, not pending |
| reset-name with press + `--reenumerate` | PASS: default name on the bus |
| a stored name survives a firmware reflash and is applied at boot | PASS (stored with firmware 2, shown by firmware 3 right after flashing) |
| rename needing the MKAUTH PIN once enrolled | **not run on hardware** (device is not enrolled; ENROLL not approved). Covered by the Rust mock tests only |
| soft re-enumeration via standalone `device reenumerate` | the P2 flag path (rename/reset-name with `--reenumerate`) ran at least 4 times, each re-enumeration PASS; standalone INS 06/03 was accepted once but its detach was not separately observed |

Seen but not fully explained: with the previous firmware a CLI rename attempt twice timed out with no press (nobody pressed in the
window), which is the expected negative behaviour.

## Not done / not verified
- FIDO PIN scenarios on hardware (`ctap_uv_test.py --only pin`): need a persistent PIN; not approved. Covered by the emulation suite only.
- Windows native WebAuthn dialog, Chrome/Firefox/websites: not tested; the PIN-prompt explanation for browsers rests on Chromium
  source (`docs/FIDO_UV.md`) and is an inference for Windows.
- MKAUTH ENROLL/CHALLENGE/REVOKE, rename with PIN.
- Linux/macOS USB strings.
- Power-loss during a rename.

## Build, unit and emulation (no hardware)
- `python tools/build.py dev --app fido` and `--app openpgp`: build; `check_no_irreversible.py` PASS for both. fido image 0x98080 bytes (68% free).
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`: proto 13, host 31 tests pass (new: name validation, APDU encodings,
  authorization, no-change guarantees).
- `tools/run_emulation_tests.sh`: 28 passed, 3 strict xfails pinning upstream deviations (`docs/FIDO_UV.md`).
