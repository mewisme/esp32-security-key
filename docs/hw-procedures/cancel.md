# Hardware procedure: CTAPHID_CANCEL and channel reuse

Purpose: confirm on the board what the emulation tests show for patches `pico-keys-sdk/0005` and `pico-fido/0006`
(`tests/emulation/test_multikey_cancel.py`, finding in `docs/FIDO_UV.md`). The emulation runs the same HID and card-thread
code but with POSIX threads and a virtual button; the board uses a FreeRTOS task on the second core, a 10 ms button poll and
the BOOT button. Status until this procedure has been run: **Build verified, emulation tested, not hardware verified.**

Non-destructive: nothing is stored, no PIN is set, no `authenticatorReset`, no eFuse access, nothing is flashed by the procedure
itself. Every request is a non-resident `makeCredential` that is never completed (nobody touches the key).

## Preconditions

- A board running a build that contains the two patches (`python tools/apply_patches.py --check` clean before building).
  Flashing that build is a separate step that needs the owner's approval (see `docs/FLASHING_ADVANCED.md`).
- No FIDO PIN set (the default state). If a PIN is set the requests below are refused before the presence wait and prove nothing.
- Windows: an elevated PowerShell (HID access, `tools\run_elevated.ps1`); Linux: permission for the hidraw device.
- Do **not** touch the BOOT button while a case runs ("DO NOT TOUCH THE BOARD" is printed by the probe). A press ends the wait
  with a success path instead of a cancel and the case reports a failure that is not a firmware fault.
- Close browsers or other tools that talk to the key.

## Steps

1. Cancel and reuse, three timings (about 2 minutes):

   ```powershell
   .\tools\run_elevated.ps1 tools\ctap_cancel_probe.py
   ```

   Cases: request A cancelled after 1 s, then request B (a) on a new channel after 2 s, (b) on the **same channel immediately**,
   (c) on the same channel after 6 s. B is never touched.

   Expected: A answers `KEEPALIVE_CANCEL` in well under 1 s; B waits about 15 s (the configured presence timeout) and ends
   with `OPERATION_DENIED`. Output ends with three `PASS` lines and exit code 0.
   **Failure signature of the old firmware:** case (b) prints `B -> SUCCESS-REPLY ...` after ~0 s.

2. UP group of the UV script (cancel, timeout, stale press):

   ```powershell
   .\tools\run_elevated.ps1 tools\ctap_uv_test.py --only timeout cancel stale
   ```

   Expected: every check `PASS`; the `cancel` group shows `KEEPALIVE_CANCEL`, `stale` shows that a press made before the next
   request does not satisfy it.

3. INIT during a presence wait (the host re-opens the channel instead of cancelling). In an elevated Python with python-fido2:
   start a `makeCredential` on one `CtapHidDevice` in a thread, wait 1 s, open a second `CtapHidDevice.list_devices()` handle
   (its constructor sends `CTAPHID_INIT`) and time it.

   Expected: the second handle opens within about 1 s (not after the 15 s presence timeout), and a `get_info()` on it returns a
   normal answer. The first request then ends with an error or no reply, never with a success.

## Observations to record

| What | Pass criterion |
|---|---|
| Time from cancel to `KEEPALIVE_CANCEL` | < 1 s (earlier build: 0.14 s) |
| Number of replies to one cancel | exactly one |
| Same-channel request right after the cancel answer | waits for presence, no empty success, no shifted reply |
| `CTAPHID_INIT` during a wait | answered within about 1 s |
| Any request after the procedure | `get_info()` valid, `multikey device info` unchanged (name, MKAUTH, image SHA-256) |

## Recovery if something looks wrong

1. Unplug and replug the key (a power cycle clears all card-thread and HID state; nothing persistent was written).
2. Retry `tools\ctap_cancel_probe.py` once; the first HID call after a replug can find no reader, wait about 5 s.
3. If case (b) still shows an instant success, or `CTAPHID_INIT` blocks for the whole timeout, the build does not contain
   the patches: run `python tools/apply_patches.py --check`, rebuild, and report the build's image SHA-256.

Record the result in a new `docs/hw-reports/` file (board, build version, image SHA-256, the output above); do not edit the
existing reports.
