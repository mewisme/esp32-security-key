# 2026-11-23: management CLI, FIDO PIN/credential commands, WebUSB landing page, flash script

Date: 2026-11-23. Board: the same ESP32-S3 N16R8 as the earlier reports (MAC 80:b5:4e:c8:22:78), Windows 11, python-fido2 (venv),
`multikey` 0.1.0 built from this tree (`host/target/release/multikey.exe`). Firmware: `fido` dev image, real pins (GPIO0 BOOT, no LED),
built from commit f5864fc plus patch 0004 (WebUSB). The user explicitly approved, per operation: flashing, read-only live checks, FIDO
PIN set, resident credential creation, MKAUTH enroll, `authenticatorReset`, push to `main`, and a v0.1.0 tag. No eFuse, Secure Boot, flash
encryption, hardened image or `--ci-pins` image was involved. The key ended in the same logical state as it started: no FIDO PIN, no
credentials, MKAUTH not enrolled, default name.

## Hardware verified

| # | What | How | Result |
|---|---|---|---|
| 1 | Flash script, dry run | `tools/flash-dev.ps1 -DryRun -NoBuild` (board in download mode, COM6 auto-detected) | chip ESP32-S3, 16 MB, MAC matches, device partition table matches this build, nothing written |
| 2 | Flash script, real write | `tools/flash-dev.ps1 -NoBuild`, user typed `FLASH` | esptool "Hash of data verified", watchdog reset, step 9 PASS (HID FIDO + keyboard, CCID, WinUSB); exit 0. Wrote only 0x0, 0x8000, 0x20000. App sha256 9aae90c1...6df2 |
| 3 | WebUSB descriptors | `tools/check_usb_descriptors.py --live` (pyusb + libusb-package, no elevation, read-only) | PASS: BOS 57 bytes, 2 capabilities, WebUSB vendor code 1 / iLandingPage 1, GET_URL returned `https://github.com/mewisme/esp32-security-key`, GET_URL with a wrong iLandingPage stalled, MS OS 2.0 set 178 bytes |
| 4 | USB identity after the new firmware | `tools/usb_identity.py` | iProduct `MultiKeys Security Key`, interfaces `... FIDO`, `... Keyboard`, `... CCID`, WinUSB (no string), reader `MultiKeys MultiKeys Security Key CCID 0` |
| 5 | `device list/info/status/version`, `mkauth status`, `readers` (normal user) | read-only | work; with no elevation the HID half is absent (Windows rule) and the tool says so (`HID -`, hint, `FIDO: unavailable`) |
| 6 | Same, elevated | read-only | HID FIDO interface found; HID and reader paired into one entry; `fido info` shows versions, AAGUID `0a63b994...5c4d`, firmware version 0x802, options; `fido pin status` = not set, credMgmt supported |
| 7 | `fido pin set --yes --pin-stdin` | throwaway PIN | PIN set and verified (read back `clientPin=true`); `alwaysUv` became `true`; U2F_V2 vanished from `versions` while a PIN is set (observed) |
| 8 | second `fido pin set` | | refused before any prompt, exit 2 |
| 9 | resident credential | `tools/ctap_make_resident.py` (python-fido2, PIN, one BOOT press) | credential created for `multikey.cli-test` |
| 10 | `fido credentials list [--json]` | `--pin-stdin` | credential listed with RP, user, id; JSON parsed (after fix, see Findings) |
| 11 | `fido pin change` with a wrong current PIN | | exit 5, "7 attempts left"; `pin status` retries 7; one attempt only |
| 12 | `fido pin change` with the right PIN | | changed; retries back to 8 |
| 13 | `fido credentials delete --yes --pin-stdin` | | credential gone (store verified empty); `list` on an empty store prints `(no discoverable credentials)` / `[]`; deleting an unknown id exits 1 |
| 14 | `mkauth enroll` / `list` / `auth` | PIN typed by the user, BOOT presses | all exit 0; trust-store entry written and listed |
| 15 | `device rename "HW Test Key" --reenumerate` (PIN path) | PIN + BOOT | exit 0; bus iProduct became `HW Test Key`, interfaces `HW Test Key FIDO/Keyboard` (usb_identity) |
| 16 | `device reset-name --reenumerate` (PIN path) | PIN + BOOT | exit 0; name back to `MultiKeys Security Key (default)` |
| 17 | `mkauth revoke` | PIN + BOOT | exit 0; `mkauth status` afterwards `enrolled : false`, device id zeros |
| 18 | `authenticatorReset` | `tools/ctap_reset.py` (unplug, replug, BOOT within 10 s) | second attempt succeeded: `clientPin` false, `alwaysUv` false, `makeCredUvNotRqd` true (touch-only restored). The first attempt ended without completing (PIN still set); cause not determined, probably the 10 s window was missed |

The console transcript of session 14-17 lost some command output (PowerShell transcripts do not capture all native output); exit codes
were 0 and the state transitions above were confirmed afterwards with read-only commands.

## Findings (fixed in this change)

- Windows lets only elevated processes open FIDO HID devices; unelevated, hidapi does not list the interface at all. Documented in README,
  `docs/CLI.md` and printed as a hint by the tool.
- `ctap-hid-fido2` prints `Unknown member: 12` to **stdout** while parsing credential-management responses, which broke `--json`. Every call
  into the crate now runs with stdout redirected to the null device (`multikey-fido/src/quiet.rs`); re-run on hardware: JSON is pure.
- With an empty credential store the key answers `CTAP2_ERR_NO_CREDENTIALS` to enumerateRPs; this was reported as "credential not found"
  and made `delete` fail its post-check. It is now an empty list. Re-run on hardware: correct.
- Hardware tool `ctap_make_resident.py` and `ctap_reset.py` were added for these tests.

## Not run / not verified

- The browser (Chrome) WebUSB notification for the landing page: not tested. The descriptors are verified, the notification is not.
- Credential survival across the flash of this session: no snapshot was taken before flashing (`ctap_survival.py snapshot`), so survival is
  supported only by the layout argument and the partition-table check, not by a before/after comparison.
- Interactive typed confirmations (`set pin`, `delete`) and the no-echo PIN prompts of `fido` were not exercised on hardware (the runs used
  `--yes --pin-stdin`); they are unit-tested against the mock. MKAUTH prompts were exercised interactively by the user.
- PIN-blocked, PIN-auth-blocked and low-retry warnings on hardware: not run (would burn retries).
- Linux, macOS, other boards, `fido` commands on Linux hidraw: not run. The Linux release binary and PAM module were built and smoke
  tested in CI only (see `docs/RELEASES.md`), not against a key.
- Firmware has no MultiKeys build identifier; `device version` shows protocol/CTAP versions only.
