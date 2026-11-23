# FIDO2: touch-only use, PIN prompts and user verification

Goal: authenticate with the BOOT button alone whenever the relying party (RP) accepts user presence (UP) without user
verification (UV), keep the PIN for sites that require UV, and never fake UV.

Status words used below: **hardware** = observed on the board (report: `docs/hw-reports/2026-11-23-uv-and-identity.md`),
**emulation** = observed with pico-fido's native emulation build running the same CTAP code (`tools/run_emulation_tests.sh`,
no hardware), **source** = read from code, **inference** = reasoning from source, not observed.

## What the firmware does (no PIN set; the default state of a new key)

| Fact | Evidence |
|---|---|
| `GetInfo.options`: `clientPin=false` (PIN supported, not set), no `uv` key (no built-in UV), `alwaysUv=false`, `makeCredUvNotRqd=true`, `rk=true`, `pinUvAuthToken=true`, `credMgmt`, `authnrCfg`, `largeBlobs` | hardware |
| `userVerification: discouraged` register + assert: succeed with a button press; flags `UP=1 UV=0`; signature valid | hardware |
| A plain request (what Chromium sends for `preferred` on a PIN-less key) behaves the same | hardware |
| `uv=true` in makeCredential/getAssertion is refused at once with `INVALID_OPTION` (no touch needed): the key has no built-in UV and says so | hardware, matches CTAP 2.1 |
| `userVerification: required` cannot be satisfied: a platform must first create a PIN. Clients that cannot do that fail before any touch | hardware (python-fido2 `CONFIGURATION_UNSUPPORTED`, 0 touch prompts) |
| The UV flag is only ever set after a verified PIN token (`cbor_make_credential.c`/`cbor_get_assertion.c`: set only in the `pinUvAuthParam` branch). There is no code path that sets UV otherwise | source + hardware (UV=0 in every PIN-less result) + emulation (UV=1 only with the PIN) |
| UP: no touch -> refused after 15 s; cancel (`CTAPHID_CANCEL`) answers `KEEPALIVE_CANCEL` in about 0.14 s; a press made before the next request (on a fresh channel) does not satisfy it | hardware (`ctap_uv_test.py`, `ctap_cancel_probe.py`); same-channel reuse after a cancel is broken, see the known issue below |

## Why does a browser ask for a PIN on a key that has none?

Three independent layers; only the first is firmware.

1. **Firmware (GetInfo).** The key advertises `clientPin` (supported). A platform that wants UV therefore *can* create a PIN, so it
   offers to. The key does not advertise `uv`. This is correct CTAP 2.1 behaviour and the firmware never demands UV by itself while
   no PIN is set.
2. **RP policy.** The prompt only appears when the RP asks for it: `userVerification: required`, or `preferred` combined with a
   discoverable credential (`residentKey: required`, i.e. a passkey), or `preferred` combined with the `hmac-secret`/PRF extension.
   With `userVerification: discouraged` and no discoverable credential no PIN is needed (hardware test above).
3. **Browser policy.** Chromium's `FidoDeviceAuthenticator::PINUVDispositionForMakeCredential` and the UV upgrade in
   `MakeCredentialRequestHandler::SpecializeRequestForAuthenticator` (device/fido/, read 2026-11):
   - `discouraged`: plain request, touch only.
   - `preferred` on a key with `clientPin=false`, no `uv`, and no hmac-secret request: plain request, touch only.
   - `preferred` **with** hmac-secret/PRF: treated as required -> "create a PIN" prompt, because a later PIN would change the
     hmac-secret output.
   - discoverable credential requested: `discouraged` is upgraded to `preferred` (so the same hmac-secret rule applies).
   - `required`: PIN token, and on a PIN-less key an offer to create one.
   `tools/ctap_uv_test.py` prints this model's verdict for every combination for the connected key.
   python-fido2 is stricter than Chromium: it treats `preferred` as required whenever the `clientPin` key exists in GetInfo,
   even when false (client policy: hardware showed `CONFIGURATION_UNSUPPORTED` without any request reaching the key).
   The **Windows native WebAuthn dialog** is a separate implementation whose source is not available; its behaviour is **not
   verified here**. If Windows shows a PIN prompt for a PIN-less key, test with `userVerification: discouraged` first
   (https://webauthn.io lets you choose it) and compare.

So: to see no PIN prompt, the RP/site must use `discouraged` or `preferred` without a passkey and without PRF. A key that
advertised `uv` or hid `clientPin` would only be lying to the browser.

## `makeCredUvNotRqd` (default on since this change)

CTAP 2.1: when a PIN *is* set, a non-discoverable credential may be created with a touch alone if the authenticator advertises
`makeCredUvNotRqd`. Upstream sets it only after `authenticatorReset`, so a never-reset key advertised `false`. Kconfig
`MULTIKEY_FIDO_MAKECRED_UV_NOT_REQUIRED` (default y, patch `pico-fido/0003`) initialises the options byte once (never stored, or
erased by a reset). A stored options byte, even one a user cleared, is never touched. It never sets UV and cannot create a
discoverable credential without UV (hardware GetInfo: `makeCredUvNotRqd=true`; emulation: `rk=true` without
`pinUvAuthParam` and a PIN set -> `PUAT_REQUIRED`). Hardware: the flag appeared on the user's key after the first flash with
this build (it had never been reset).

## Setting a FIDO PIN costs touch-only use (upstream design, read this before setting one)

With a PIN set, pico-fido (a) wraps the device key with the PIN, (b) removes `U2F_V2` from `GetInfo`, (c) reports
`alwaysUv=true` until the PIN has been entered in the current session (`cbor_get_info.c:95`, `fido.c:241-301`,
`fido.c:541`/`hid.c:452`: every `CTAPHID_INIT` resets the lock flag). Observed in the emulation build (not on hardware: no PIN was
set on the board, by decision):

- After a power cycle with a PIN set, `GetInfo` says `alwaysUv=true`, so browsers ask for the PIN for everything.
- A touch-only non-resident `makeCredential` then fails with `CTAP1_ERR_OTHER` (the key cannot unwrap its device key), and a
  UV-less `getAssertion` for an existing credential returns **success with a signature that does not verify** (an upstream
  defect: the failed key load is not propagated; no key material is exposed). Both work again after one PIN entry.
- U2F authenticate is refused (SW 6985) while locked; the first U2F call right after `setPIN` in the same session still works.

Consequence: **touch-only use and a FIDO PIN are mutually exclusive in practice.** Keep the key PIN-less for touch-only sites. If
you need UV (some enterprise or `verify-required` SSH use), set the PIN knowing every use then needs it once per power-up and
U2F-only sites stop working. Removing a PIN requires `authenticatorReset` (deletes all credentials). A Kconfig that keeps the
device key unwrapped when a PIN is set would give both, at the price of PIN-independent at-rest key protection; **not
implemented, needs an explicit decision** (it changes the security model).

## Other upstream deviations found by the emulation tests (strict `xfail` tests pin them)

| Deviation | Where | Effect |
|---|---|---|
| `getAssertion` never checks `alwaysUv` (only makeCredential does) | `cbor_get_assertion.c` | with alwaysUv enabled by the user, assertions still succeed with a touch |
| Toggling `alwaysUv` off does not restore `makeCredUvNotRqd` that toggling on cleared | `cbor_config.c:344-358` | after on/off, a PIN-protected key requires UV for every registration |
| Locked key returns a signature that does not verify instead of an error | see above | RP verification fails; cause not analysed, no exposure was looked for beyond that |

Not fixed here: none of these affect the PIN-less touch-only default. Decide whether to patch them.

## Known issue found on hardware: the request after a CTAPHID_CANCEL on the SAME channel

`tools/ctap_cancel_probe.py` (no touch needed): request A (makeCredential waiting for a touch) is cancelled; A answers
`KEEPALIVE_CANCEL` in about 0.14 s as required. Then:

| Next request B | Observed (hardware) |
|---|---|
| on a **new channel** (new `CTAPHID_INIT`, what a browser normally does), 2 s later | correct: waits for a touch, refused with `OPERATION_DENIED` after 15.1 s (PASS) |
| on the **same channel**, immediately | the key answers with an instant, **empty success** (status 0, no body), and B's real result (`OPERATION_DENIED` 15 s later) is delivered as the answer to the *next* request; at times the HID side then stops answering for a while (`CTAPHID_INIT` timeouts, recovered by itself) |

The replies carried no attestation, so no credential was handed to the client; replies stay out of step with requests until the
stale one is consumed. **Probable cause (inference from reading `hid.c`, not verified):** the cancel handler zeroes
`finished_data_size` while the card thread is still running A, and a new CBOR request clears `cancel_button` (`hid.c:582`), so
A's late completion leaks into the next transaction on that channel. Work-around for clients: open a fresh channel after
cancelling; `tools/ctap_uv_test.py --only stale` does so. A firmware fix touches the SDK's HID/card state machine and was not attempted.

## Tests

| Test | Needs | Command |
|---|---|---|
| Rust: MKAUTH proto/host (unrelated to FIDO UV) | nothing | `cd host && cargo test` |
| **Emulation**: 28 UV-policy checks + 3 pinned deviations, PIN set/wrong PIN/alwaysUv/reset, factory-fresh device per test | WSL/Linux (no hardware, no sudo) | `tools/run_emulation_tests.sh` (CI job `fido-emulation`) |
| **Hardware**: GetInfo options, UV/UP behaviour, browser model, cancel, timeout | board, elevated shell on Windows | `tools\run_elevated.ps1 tools\ctap_uv_test.py` (groups `info raw nopin timeout cancel stale`, `pin` with `--pin`) |
| Hardware: UP isolation | board | `tools\run_elevated.ps1 tools\ctap_up_test.py` |
| Hardware: credentials survive update/rename | board | `ctap_survival.py snapshot` ... change ... `verify` |

PIN-set scenarios on hardware (`ctap_uv_test.py --only pin --pin N`) exist but were **not run**: setting a PIN is persistent and
only `authenticatorReset` (which deletes credentials) removes it, so it needs the owner's explicit approval.
