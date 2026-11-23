# Roadmap and status matrix

Vocabulary: **Implemented** (code exists) · **Build verified** (`idf.py build`/`cargo build` passes) ·
**Unit tested** · **Integration tested** (against host software, no hardware) · **Hardware verified** (ran on a real
ESP32-S3) · **Blocked** · **Not implemented**. Nothing may be marked Hardware verified without a report in `docs/hw-reports/`.

Last updated: 2026-11-23. One ESP32-S3 N16R8 board was tested (Windows 11 host). "Hardware verified" below refers to that board and the
tests listed in the linked report only.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Repo, AGPL-3.0 licence, pinned submodules, docs | Implemented | ADR-0001, ADR-0002 |
| 1 | `fido` image, dev + prod, pins unset (`--ci-pins`) | Build verified | ESP-IDF v5.5.6; dev 0.62 MB, prod 0.58 MB of the 1.88 MB app partition |
| 1 | `openpgp` image, dev + prod | Build verified | pico-openpgp pinned to upstream main `9b23276`; v5.0 does not build (ADR-0002) |
| 1 | Kconfig pins; build fails when unset | Build verified | verified: unset pins fail with the intended `#error`; plain-LED + pins compiles |
| 1 | BOOT (GPIO0, active low) as presence button, LED optional (`LED_TYPE_NONE` default), pin safety checks | Hardware verified (button); LED not tested | pressing BOOT is read on GPIO0 and flashing/boot are unaffected (3 flashes through the native port); the LED path is untested on hardware |
| 1 | Real user presence enforced (SDK patch 0001 + pico-fido patch 0001) | Hardware verified, one open anomaly | found on hardware: stock behaviour accepted makeCredential with no press. Fixed: no-touch requests are refused after 15 s, a held button does not count. One unexplained early success at 10.6 s in 1 of 6 no-touch runs on the final image (probable early press); longer idle test pending |
| 1 | Dev build free of irreversible operations (`tools/check_no_irreversible.py`) | Build verified | fido-dev and openpgp-dev: PASS; checker flags the old hardened build as expected |
| 1 | Read-only probe of a real board (chip, 16 MB flash, fuses open) | Hardware verified | `docs/hw-reports/2026-11-23-read-only-probe.md` |
| 1 | No automatic eFuse writes (patch 0002) | Implemented, build verified | upstream burned KEY3/KEY4 at first boot; now opt-in |
| 2 | FIDO2/CTAP2 + U2F (upstream pico-fido v8.2) | **Hardware verified (basic)**: GetInfo, ES256 + EdDSA makeCredential/getAssertion with verified signatures, U2F version/check-only, real user presence | one board, Windows 11, python-fido2 only. PIN, credential management, browsers/WebAuthn sites, U2F register, ssh/git signing not tested. Advertised CTAP versions are not a conformance claim. Report: `2026-11-23-first-run.md` |
| 3 | SSH `*-sk`, Git signing | Not tested | no firmware work; scripts written (`tools/ssh_smoke.*`), never run |
| 4 | OpenPGP + PIV over CCID (separate image) | Build verified | `tools/gpg_smoke.sh` written, never run |
| 4 | OpenPGP + FIDO in ONE image | **Blocked** | two management applets and two key-wrapping providers; needs a reviewed design (ADR-0002) |
| 5 | MKAUTH applet (firmware) | Implemented, build verified; SELECT + GET_INFO hardware verified | ENROLL / CHALLENGE / REVOKE never run on hardware; no C-level unit tests |
| 5 | Rust host: proto / host / CLI | Unit tested (mock device); `readers`/`status` hardware verified | 33 tests with a mock; other commands not run against the device |
| 6 | Linux PAM module (`multikey-pam`) | Implemented, unit tested (logic) | 11 tests on Windows; not built or run on Linux; not hardware verified |
| 6 | Windows: MKAUTH via PC/SC | Partly hardware verified | `multikey readers/status` (SELECT + GET_INFO) work through Windows PC/SC; ENROLL/CHALLENGE/REVOKE not run. FIDO via browser/Windows Hello not tested (see WINDOWS.md) |
| 6 | Windows Credential Provider | **Not implemented** | needs a VM snapshot to test safely; a faulty provider can lock a machine out |
| 7 | Hardened profile (Secure Boot v2 + flash encryption + JTAG off) | Build verified (throwaway key) | never fused or booted; partitions.hardened.csv encrypted-partition behaviour of the pico flash driver unverified |
| 7 | Read-only fuse checker `tools/provision_check.py` | Hardware verified (read-only, one chip) | `espefuse` summary parsed correctly on a real ESP32-S3: classified `development (open)` |
| 7 | OTA update, anti-rollback | Not implemented | no OTA partitions in the layout |
| 7 | Power-loss test of key store | Not tested | needs hardware |
| 8 | Composite device (HID + CCID + WinUSB) enumeration | Hardware verified (Windows 11 only) | `303A:4002`: 2 HID, CCID reader, WinUSB; see `2026-11-23-first-run.md`; Linux/macOS not tested |
| 8 | Reproducible dependency pinning (mbedTLS/tinycbor/libcvc by hash) | Not implemented | upstream fetches tags/branch at configure time |
