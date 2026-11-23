# Application-only update on the N16R8 (v0.3.2 local build to published v0.3.3)

Date: 2026-11-23. Board: ESP32-S3 N16R8 (16 MB), Windows 11, Chrome, dev server `localhost:5173` (current `main`), published
release v0.3.3 (`multikey-firmware-v0.3.3-esp32s3-16mb-fido-dev.zip`). Approved by the maintainer: one app write, the web
hardware test, and sign-in with the existing `passkey-lab-test` credential. No PIN, reset, enrolment, new credential or eFuse
operation was done.

## Before (read-only, host CLI)

| Item | Value |
|---|---|
| Firmware | `multikey-fido 0.3.2`, commit `fbb8fb19a14f`, image SHA-256 `3bd9d3b6…38a8` (a local build) |
| Flash | built for 16 MB, chip 16 MB, running from `factory` at `0x20000` |
| Name / MKAUTH | "Mew's Security Key" (custom) / protocol v1, `enrolled=false` |
| Passkey sign-in (existing credential, BOOT) | success (reported by the maintainer) |

## Procedure and what the maintainer reported

`/update`: Choose key, Check for updates, download mode, Choose device, Review, acknowledgement, Update, replug without BOOT,
Check my key. Review outcome: **"Compatible update"**. Verify verdict: **"Update verified"**. The maintainer did not note how many
rows the write table showed, so "one write row" is **not** observed on hardware (it is covered by unit and e2e tests).

## After (read-only, host CLI, independent of the page)

| Item | Value |
|---|---|
| Firmware | `multikey-fido 0.3.3`, commit `2af0a0358c19` |
| Image SHA-256 | `f3da69de…a256`, equal to the SHA-256 of `multikey-fido.bin` inside the published zip (computed from the downloaded asset) |
| Name / MKAUTH | "Mew's Security Key" (custom) / `enrolled=false`, unchanged |
| Passkey sign-in with the same credential, BOOT | success, no re-registration (reported by the maintainer) |

## Conclusions and limits

- Hardware verified once, on one N16R8: an application-only update from a 0.3.2 local build to the published 0.3.3 image kept the
  key name and MKAUTH state, and an existing credential still signed in. The running image equals the published one.
- The FIDO PIN state of the board was not recorded and not exercised; PIN preservation is **not** verified. Credentials: one
  credential, one sign-in.
- Not tested: 4 and 8 MB, an interrupted write and the `REPAIR` path, downgrade and other refusals on hardware, OpenPGP.
- The bootloader and partition table were not read back after the update, so "not written" rests on the code path (one write), not
  on a flash read.
- The first host CLI call after the replug found no reader (the key had just re-enumerated); the next call, 5 s later, worked.
