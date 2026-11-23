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
| UP: no touch -> refused after 15 s; cancel (`CTAPHID_CANCEL`) answers `KEEPALIVE_CANCEL` in about 0.14 s; a press made before the next request (on a fresh channel) does not satisfy it | hardware (`ctap_uv_test.py`, `ctap_cancel_probe.py`); same-channel reuse after a cancel was broken on hardware and is fixed in firmware (emulation-tested, not yet re-verified on the board), see "Fixed" below |

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

## `makeCredUvNotRqd` (on by default)

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
- A touch-only non-resident `makeCredential` then fails with `PUAT_REQUIRED` (the key cannot unwrap its device key; before
  patch `pico-fido/0005` this was `CTAP1_ERR_OTHER`), and a UV-less `getAssertion` for an existing credential fails with
  `PUAT_REQUIRED` as well (before that patch it returned a success carrying a decoy credential and a bogus signature, see
  below). Both work again after one PIN entry.
- U2F authenticate is refused (SW 6985) while locked; the first U2F call right after `setPIN` in the same session still works.

Consequence: **touch-only use and a FIDO PIN are mutually exclusive in practice.** Keep the key PIN-less for touch-only sites. If
you need UV (some enterprise or `verify-required` SSH use), set the PIN knowing every use then needs it once per power-up and
U2F-only sites stop working. Removing a PIN requires `authenticatorReset` (deletes all credentials). A Kconfig that keeps the
device key unwrapped when a PIN is set would give both, at the price of PIN-independent at-rest key protection; **not
implemented, needs an explicit decision** (it changes the security model).

## Upstream deviations found by the emulation tests: fixed by `pico-fido/0005` (UV policy)

Each was pinned by a strict `xfail` test until it was fixed; the tests are now plain regression tests
(`tests/emulation/test_multikey_uv.py`).

| Deviation (upstream) | Root cause | Fix |
|---|---|---|
| `getAssertion` never checks `alwaysUv` (only makeCredential does) | `cbor_get_assertion.c` never read `FIDO2_OPT_AUV` | with alwaysUv on and no `pinUvAuthParam`: `PUAT_REQUIRED` (`OPERATION_DENIED` when no PIN is set), including `up=false` requests, which would otherwise return a real UV-less assertion |
| Toggling `alwaysUv` off does not restore `makeCredUvNotRqd` that toggling on cleared | `cbor_config.c` cleared the flag on and only cleared AUV off | toggling on moves the flag into a remembered bit (`FIDO2_OPT_MCUV_SAVED`), toggling off moves it back; nothing else in the options byte changes. A key that already did a round trip with an older build lost the flag and cannot get it back (Kconfig default only applies to a never-stored options byte): toggle it with the `makeCredUvNotRqd` config command or reset |
| Locked key: UV-less `getAssertion` returned **success with a decoy** (made-up credential id `00 01 00 01 ...`, signature of 64 bytes `0x0B`), not an invalid signature of a real credential | `up` defaulted to false, so a request **without an options map** was classified as a silent probe. With the key locked no credential could be loaded (`credential_verify` ignored the failed key derivation and used an all-zero key), the silent-tag check still matched, and the "silent authentication" branch answered with the decoy and the UP flag set | `up` defaults to true (CTAP); `getAssertion` refuses with `PUAT_REQUIRED` while the device key cannot be unwrapped (`fido_keydev_available()`); `credential_verify` and `credential_create` no longer ignore a failed key derivation (a locked `makeCredential` now answers `PUAT_REQUIRED` instead of `CTAP1_ERR_OTHER`) |

No key material was exposed by the decoy (the signature is constant bytes). PIN-based wrapping of the device key is unchanged.
Effective `alwaysUv` while the key is locked (`GetInfo` already reports it) is now enforced by the actual capability check, so
a PIN-protected key unlocked in the session still answers a UV-less `getAssertion` (UP only), as before.

## Fixed: the request after a CTAPHID_CANCEL on the SAME channel (patches `pico-keys-sdk/0005`, `pico-fido/0006`)

Found on hardware with `tools/ctap_cancel_probe.py` (no touch needed): request A (makeCredential waiting for a touch) is
cancelled; A answered `KEEPALIVE_CANCEL` in about 0.14 s. Then, on the same channel and immediately, request B got an
instant **empty success** (status 0, no body), B's real result arrived as the answer to the *next* request, and
`CTAPHID_INIT` timed out for a while. A new channel was fine.

**Root cause (read from the code, reproduced in emulation).** The cancel handler in `hid.c` answered `KEEPALIVE_CANCEL`
at once, zeroed `finished_data_size` and stopped the job's timeout (`timeout_stop()`), but the card thread was still
inside the user-presence wait. Once it noticed the cancel it finished the cancelled job anyway: it wrote its status byte
into the shared response buffer, set `finished_data_size` again and posted `EV_EXEC_FINISHED`, which nobody consumed
because the timeout was off. The next request on the channel dispatched a new job and `card_status()` immediately found
the *old* `EV_EXEC_FINISHED`, so the old job's one-byte result went out as the new request's answer; the new job's own
completion then answered the request after that (shift by one). Separately, a new request's `EV_CMD_AVAILABLE` could be
swallowed by the old job's presence-wait loop, and `CTAPHID_INIT` (`card_exit()` sends `EV_EXIT` and waits for its
acknowledgement) was swallowed by the same loop, which blocks the USB task until the thread is reset. `button.c` also
cleared `cancel_button` when a wait started, so a cancel that arrived just before that point was lost.

**Fix.**

- `usb.c`: every command handed to the card thread starts a *generation*. `card_job_abandon()` marks the outstanding job
  abandoned; `card_job_take_abandoned()` tells the HID layer, when a completion arrives, that it belongs to an abandoned
  job; `card_job_reset()` forgets all of it (used on `CTAPHID_INIT`).
- `hid.c`: CTAPHID_CANCEL is honoured only for the channel of the running transaction. It marks the job abandoned and
  asks the presence wait to stop. The single `KEEPALIVE_CANCEL` reply is sent when the job has really finished, instead
  of the job's own result, so a cancelled operation never yields a success and the channel is free when the host sees the
  answer. A command that arrives while a job is outstanding gets `CHANNEL_BUSY` (it used to overwrite the running job's
  state). `CTAPHID_INIT` resets the generation state and the cancel flag after stopping the card thread.
- `button.c`: the cancel flag is cleared when a command is dispatched (`hid.c`), not when the wait starts;
  `button_wait_abort()` disarms a wait that is being torn down.
- `pico-fido/fido.c` (0006): the presence wait treats `EV_EXIT` as "stop waiting": it hands the event back so the thread
  loop acknowledges it, and aborts the button wait. `CTAPHID_INIT` during a presence wait therefore completes at once.

**Tests (emulation, `tests/emulation/test_multikey_cancel.py`).** The emulation build satisfied user presence at once, so
it could not show any of this. `PICOKEYS_EMULATION_UP_TIMEOUT=<seconds>` (emulation only; unset = old behaviour) now gives
it the same wait as the board with a virtual button that is never pressed. With it the suite covers: cancel during the wait
(one `KEEPALIVE_CANCEL`, quickly), cancel racing the start of the wait, immediate same-channel `getInfo` (correct CBOR, not
an empty success), a request sent without waiting for the cancel answer (at worst `CHANNEL_BUSY`), three cancels in a row,
an idle and a duplicate cancel, request B after a cancel really waits for its own presence, UP timeout then a normal
request, a new channel after cancel, `CTAPHID_INIT` during a wait, a foreign-channel cancel being ignored, and the python-fido2
flow of `ctap_cancel_probe.py`. With the `hid.c` part of the patch reverted, 8 of those 12 tests fail, including the empty
success (`getInfo` answered with the one byte `00`).

**Not hardware verified.** The emulation runs the same HID/card-thread code with POSIX threads; the board uses a FreeRTOS
task on the second core, a 10 ms button poll and a physical button. Verify on the board with
`docs/hw-procedures/cancel.md` (`tools/ctap_cancel_probe.py`, no touch, no PIN, nothing is stored or reset).

## Tests

| Test | Needs | Command |
|---|---|---|
| Rust: MKAUTH proto/host (unrelated to FIDO UV) | nothing | `cd host && cargo test` |
| **Emulation**: UV policy (PIN set/wrong PIN/alwaysUv on and off/locked key/reset) and CTAPHID_CANCEL/channel recovery (12 tests, real presence wait with a virtual button), factory-fresh device per test | WSL/Linux (no hardware, no sudo) | `tools/run_emulation_tests.sh` (CI job `fido-emulation`) |
| **Hardware**: GetInfo options, UV/UP behaviour, browser model, cancel, timeout | board, elevated shell on Windows | `tools\run_elevated.ps1 tools\ctap_uv_test.py` (groups `info raw nopin timeout cancel stale`, `pin` with `--pin`) |
| Hardware: UP isolation | board | `tools\run_elevated.ps1 tools\ctap_up_test.py` |
| Hardware: credentials survive update/rename | board | `ctap_survival.py snapshot` ... change ... `verify` |

PIN-set scenarios on hardware (`ctap_uv_test.py --only pin --pin N`) exist but were **not run**: setting a PIN is persistent and
only `authenticatorReset` (which deletes credentials) removes it, so it needs the owner's explicit approval.
