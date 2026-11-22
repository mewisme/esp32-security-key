# Testing

Status vocabulary (same as ROADMAP.md): Implemented / Build verified / Unit tested / Integration tested /
Hardware verified / Blocked / Not implemented. Nothing below is recorded as Hardware verified until a human
pastes a real report into `docs/hw-reports/`. No hardware has been used for this project so far.

## Test levels

| Level | Command | Prerequisites | Needs device | Status |
|---|---|---|---|---|
| Firmware build (dev, both images) | `python tools/build.py dev --ci-pins` | ESP-IDF v5.5.6 exported (`export.ps1`/`export.sh`), submodules + patches applied (see DEVELOPMENT.md) | no | see ROADMAP.md |
| Firmware build (prod config, never flashed) | `python tools/build.py prod --ci-pins` | same | no | see ROADMAP.md |
| Rust unit tests | `cd host && cargo test` | Rust toolchain | no | see ROADMAP.md |
| Rust lint | `cd host && cargo fmt --check && cargo clippy -- -D warnings` | Rust toolchain | no | see ROADMAP.md |
| Tool self-test (eFuse reporter) | `python tools/provision_check.py --self-test` | `pip install -r tools/requirements.txt` not required for this step | no | Unit tested (fixtures only) |
| CTAP2/U2F smoke | `python tools/ctap_smoke.py [--pin PIN] [--skip-pin-change]` | venv with `tools/requirements.txt`; **fido** image flashed; Windows: elevated shell | yes | pending hardware |
| SSH sk keys | `tools/ssh_smoke.sh --yes` / `tools\ssh_smoke.ps1 -Yes` | OpenSSH >= 8.3 (verify-required needs >= 8.4); fido image | yes | pending hardware |
| OpenPGP card | `tools/gpg_smoke.sh` | gpg 2.2+, pcscd/scdaemon; **openpgp** image (not the fido image) | yes | pending hardware |
| MKAUTH round trip | `multikey enroll` / `multikey auth` / `multikey revoke` (host CLI) | PC/SC; fido image | yes | pending hardware |
| eFuse state report | `python tools/provision_check.py -p COMx` (read-only `espefuse summary`) | board in download mode; `tools/requirements.txt` | yes | pending hardware |

`ctap_smoke.py --reset --yes-wipe-device` runs authenticatorReset (erases all credentials and the PIN). It is
off by default. The script only deletes credentials it created itself for rpId `multikey.test`.
`provision_check.py` is read-only: it contains no eFuse write command and its self-test asserts that.
The scripts' output proves only what they print for the connected device; it is not CTAP2.1 or FIDO conformance.

## Hardware reports (`docs/hw-reports/`)

One file per run: `docs/hw-reports/<YYYY-MM-DD>-<topic>.md` (e.g. `2026-12-01-ctap.md`), written by a human who
ran the test. Template:

```
# <topic> report <YYYY-MM-DD>
- Board: <module/devkit, flash/PSRAM>
- Image: fido | openpgp   Config: dev | prod
- Firmware commit: <git sha>   ESP-IDF: <version>
- Host OS / tool versions: <e.g. Windows 11 24H2, OpenSSH 9.x, gpg 2.4.x, python-fido2 2.x>
- GPIO pins used: button=<n> led=<n>
- Command(s) run:
- Raw output (verbatim):
- Result: PASS | FAIL | partial   Notes:
```

Failed runs are kept. Do not edit raw output.

## Manual compatibility matrix

Every cell stays `pending hardware` until a report exists in `docs/hw-reports/`.

| Target | Windows | Linux | Notes |
|---|---|---|---|
| Chromium (WebAuthn, passkey/security key) | pending hardware | pending hardware | fido image |
| Firefox (WebAuthn) | pending hardware | pending hardware | fido image |
| GitHub (security key 2FA) | pending hardware | pending hardware | fido image |
| Google account (security key) | pending hardware | pending hardware | fido image |
| Microsoft account (security key) | pending hardware | pending hardware | fido image |
| Windows Hello / Entra sign-in | pending hardware | n/a | platform WebAuthn API; no local-account unlock (see WINDOWS.md if present) |
| Linux PAM (`pam_multikey`) | n/a | pending hardware | test only via a throw-away PAM service, never login/sudo first |
| ssh (`ecdsa-sk`, `ed25519-sk`, resident keys) | pending hardware | pending hardware | fido image; ed25519-sk needs EdDSA in GetInfo |
| git SSH commit signing | pending hardware | pending hardware | see PROTOCOLS.md |
| gpg (card status, sign, decrypt, gpg-agent SSH) | pending hardware | pending hardware | **openpgp** image |

## Power-loss and persistence (pending hardware)

Pull power during credential write / MKAUTH enroll and confirm the filesystem is consistent after reboot; confirm
credentials survive reboot. Status: pending hardware.
