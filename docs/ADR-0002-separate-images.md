# ADR-0002: Two firmware images (fido, openpgp), not one merged image

Status: accepted (2026-11-22)

## Context

The goal was one composite device (FIDO2 over HID plus OpenPGP over CCID). Upstream builds each Pico Keys application
as its own firmware. Reading the sources shows why they are not designed to coexist:

- `pico-fido` and `pico-openpgp` each carry their own YubiKey-style *management* applet (`management.c`, both define
  `man_aid`, `cap_supported`, the global `is_gpg`, `man_select`, ...).
- Each app installs its own object-crypto hooks and key-encryption derivation (`object_provider.c`, `files.c`), i.e.
  the key-protection code that decides how credentials and keys are wrapped.
- `LibreFido/pico-fido2` once merged both apps but targets an older SDK API (`pico_keys_sdk_import.cmake`, `kek.c`) and
  is stale against the pinned SDK.

## Decision

Build two images from one tree: `MULTIKEY_APP=fido` (FIDO2/U2F over HID, OATH/OTP and MKAUTH over CCID) and
`MULTIKEY_APP=openpgp` (OpenPGP card and PIV over CCID, no HID). Select with `tools/build.py --app`.

Merging them would require reconciling two management applets and two key-wrapping providers inside security-critical
code. That is a design/review task, not integration glue, so it is **not attempted without review**. Status: Blocked
(composite OpenPGP+FIDO in one image). Phase 8 therefore verifies the composite *within* the fido image (HID + CCID)
and the openpgp image separately.

## Version pins resulting from this

- `pico-openpgp v5.0` does not compile against the SDK commit pinned by `pico-fido v8.2` (`50699e5`): it uses an older
  object-container API (`commit_timeout_ms` missing). `pico-openpgp` is therefore pinned to the upstream main commit
  `9b23276` (2026-11-02, tagged `nightly-main`; upstream has no release newer than v5.0), which builds against
  `50699e5`. Upstream's own pin for that commit is a newer SDK (`a2f0a51`, 3 commits ahead); the combination used here
  is untested by upstream.

## Consequences

- A user who wants both FIDO2 and OpenPGP must flash one image at a time (or use two boards).
- MKAUTH ships in the fido image only.
