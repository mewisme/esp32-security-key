# Testing

Status vocabulary (same as ROADMAP.md): Implemented / Build verified / Unit tested / Integration tested /
Hardware verified / Blocked / Not implemented. Nothing below is recorded as Hardware verified until a human
pastes a real report into `docs/hw-reports/`. Reports so far: `2026-11-23-read-only-probe.md`, `2026-11-23-first-run.md`,
`2026-11-23-uv-and-identity.md`, `2026-11-23-management-cli-and-webusb.md`, `2026-11-23-web-installer.md`,
`2026-11-23-profiles-and-personalization.md` (one board, Windows 11).

## Test levels

| Level | Command | Prerequisites | Needs device | Status |
|---|---|---|---|---|
| Firmware build (dev, both images) | `python tools/build.py dev --ci-pins` | ESP-IDF v5.5.6 exported (`export.ps1`/`export.sh`), submodules + patches applied (see DEVELOPMENT.md) | no | see ROADMAP.md |
| Firmware build (prod config, never flashed) | `python tools/build.py prod --ci-pins` | same | no | see ROADMAP.md |
| Rust unit tests | `cd host && cargo test` | Rust toolchain | no | see ROADMAP.md |
| Rust lint | `cd host && cargo fmt --check && cargo clippy -- -D warnings` | Rust toolchain | no | see ROADMAP.md |
| Tool self-test (eFuse reporter) | `python tools/provision_check.py --self-test` | `pip install -r tools/requirements.txt` not required for this step | no | Unit tested (fixtures only) |
| CTAP2/U2F smoke | `python tools/ctap_smoke.py [--pin PIN] [--skip-pin-change]` (a `--pin` on a PIN-less key SETS that PIN, which ends touch-only use; see FIDO_UV.md) | venv with `tools/requirements.txt`; **fido** image flashed; Windows: elevated shell | yes | pending hardware |
| SSH sk keys | `tools/ssh_smoke.sh --yes` / `tools\ssh_smoke.ps1 -Yes` | OpenSSH >= 8.3 (verify-required needs >= 8.4); fido image | yes | pending hardware |
| OpenPGP card | `tools/gpg_smoke.sh` | gpg 2.2+, pcscd/scdaemon; **openpgp** image (not the fido image) | yes | pending hardware |
| MKAUTH round trip | `multikey mkauth enroll --user U` / `mkauth auth --user U` / `mkauth revoke --user U` (host CLI) | PC/SC; fido image | yes | Hardware verified once (Windows 11; `2026-11-23-management-cli-and-webusb.md`) |
| eFuse state report | `python tools/provision_check.py -p COMx` (read-only `espefuse summary`) | board in download mode; `tools/requirements.txt` | yes | Hardware verified (read-only, one blank chip; `2026-11-23-read-only-probe.md`) |
| FIDO UV/PIN policy, no hardware | `tools/run_emulation_tests.sh` (WSL/Linux; CI job `fido-emulation`) | rsync, cmake, ninja, gcc, libssl-dev, python3; builds pico-fido's `ENABLE_EMULATION` binary from a /tmp copy | no | Integration tested (28 pass, 3 pinned upstream deviations) |
| FIDO UV/UP on the board | `tools\run_elevated.ps1 tools\ctap_uv_test.py [--only info raw nopin timeout cancel stale pin]` | venv; fido image; elevated PowerShell; `--pin` only with an existing PIN | yes | see docs/hw-reports |
| Credentials survive update/rename | `ctap_survival.py snapshot` ... change ... `verify` (via `run_elevated.ps1`) | same | yes | see docs/hw-reports |
| USB strings per interface | `python tools/usb_identity.py --expect-product "<name>"` | Windows; built `multikey` CLI optional | yes | see docs/hw-reports |
| MKAUTH device name, device-side validation | `.venv\Scripts\python tools\mkauth_name_test.py --nobutton` | `pip install pyscard`; PC/SC | yes (no press needed) | see docs/hw-reports |
| Rename flow incl. re-enumeration and replug | `python tools/name_flow_test.py` | built `multikey` CLI; unenrolled MKAUTH | yes (2 presses, 1 replug) | see docs/hw-reports |
| Firmware per hardware profile | `python tools/build.py dev --hw esp32s3-4mb --board esp32s3-boot-button --clean` (also `esp32s3-8mb`, `esp32s3-16mb`) | ESP-IDF v5.5.6 exported; submodules + patches applied | no | Build verified (image header flash-size bytes `2f`/`3f`/`4f` checked, see HARDWARE_PROFILES.md); hardware verified for 16 MB only |
| Web installer logic and UI | `cd web && pnpm test` / `pnpm test:e2e` | `pnpm install`; Playwright chromium for e2e | no | Unit tested; Integration tested with a simulated board and key |
| Rename from the browser (WebCCID) against a real key | web installer or First use page, desktop Chrome/Edge | key with a native USB port; BOOT press (15 s) | yes | Hardware verified (one board, Windows 11, Chrome: set, reset, set; `2026-11-23-profiles-and-personalization.md`) |

`ctap_smoke.py --reset --yes-wipe-device` runs authenticatorReset (erases all credentials and the PIN). It is
off by default. The script only deletes credentials it created itself for rpId `multikey.test`.
`provision_check.py` is read-only: it contains no eFuse write command and its self-test asserts that.
The scripts' output proves only what they print for the connected device; it is not CTAP2.1 or FIDO conformance.

`tools\run_elevated.ps1` shows the elevated window's output live (so prompts are visible) and also logs it; the scripts that need a
touch wait for Enter first and print `TOUCH NOW` when the key is actually waiting. `ctap_uv_test.py`, `ctap_survival.py`,
`ctap_up_test.py`, `mkauth_name_test.py`, `name_flow_test.py` and `usb_identity.py` never set a PIN, never reset the authenticator and
write nothing but non-resident test credentials for `multikey.test` / `multikey.survival` (and, for the rename tests, the device-name file).

## Hardware reports (`docs/hw-reports/`)

One file per test session: `docs/hw-reports/<YYYY-MM-DD>-<topic>.md`, written by a human who ran the test. The template (one
copy only) is in [hw-reports/README.md](hw-reports/README.md). Failed runs are kept. Do not edit raw output.

## Manual compatibility matrix

Every cell stays `pending hardware` until a report exists in `docs/hw-reports/`.

| Target | Windows | Linux | Notes |
|---|---|---|---|
| Chromium (WebAuthn, passkey/security key) | pending hardware | pending hardware | fido image |
| Firefox (WebAuthn) | pending hardware | pending hardware | fido image |
| GitHub (security key 2FA) | pending hardware | pending hardware | fido image |
| Google account (security key) | pending hardware | pending hardware | fido image |
| Microsoft account (security key) | pending hardware | pending hardware | fido image |
| Windows Hello / Entra sign-in | pending hardware | n/a | platform WebAuthn API; no local-account unlock (see WINDOWS.md) |
| Linux PAM (`pam_multikey`) | n/a | pending hardware | test only via a throw-away PAM service, never login/sudo first |
| ssh (`ecdsa-sk`, `ed25519-sk`, resident keys) | pending hardware | pending hardware | fido image; ed25519-sk needs EdDSA in GetInfo |
| git SSH commit signing | pending hardware | pending hardware | `tools/ssh_smoke.*` (`ssh-keygen -Y sign`) |
| gpg (card status, sign, decrypt, gpg-agent SSH) | pending hardware | pending hardware | **openpgp** image |

## Power-loss and persistence (pending hardware)

Pull power during credential write / MKAUTH enroll and confirm the filesystem is consistent after reboot; confirm
credentials survive reboot. Status: pending hardware.

## Host CLI, flash script and release pipeline (no hardware)

- `cd host && cargo test --locked`: 116 tests (proto 19, host 43, fido 17, cli 37; `multikey-pam`, 11 more, is not a default member:
  `cargo test -p multikey-pam`). The FIDO PIN and credential
  flows run against `MockAuthenticator`, including assertions that no PIN appears in any output. The real HID path of
  `ctap-hid-fido2` has no emulator coverage here (pico-fido's emulation speaks a virtual transport, not HID): `fido *` against a real key
  is a hardware test and is only partly done (see ROADMAP).
- `python -m unittest discover tests/flash` (75 tests: flash safety rules, hardware profiles, descriptor tool) and `tests/release` (60
  tests: deterministic packaging, manifest schema 2, workflow guards, `install.sh`/`install.ps1` against a fake release; the shell
  tests run on Linux, the PowerShell tests on Windows).
- `cd web && pnpm lint && pnpm test && pnpm build`: eslint, 174 unit tests (manifest v1/v2, profile selection, installer state machine,
  MKAUTH APDUs, WebCCID framing, renaming orchestration including a silent or slow key, locale detection), production build and the check
  that no test double is in the bundle. `pnpm test:e2e` runs 58 Playwright `test()` cases (installer, site, Passkey lab at `/passkeys`,
  reduced-motion; some loop over pages) against a simulated board, a simulated key and a virtual authenticator, with English and
  Vietnamese checks (`web/README.md`); they are not hardware tests.
- `.github/workflows/release.yml` verifies the packaged artifact itself (version output, help, static CRT, PAM symbols/load/fail-closed).
