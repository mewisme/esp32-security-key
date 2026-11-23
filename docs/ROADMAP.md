# Roadmap and status matrix

Vocabulary: **Implemented** (code exists) · **Build verified** (`idf.py build`/`cargo build` passes) ·
**Unit tested** · **Integration tested** (against host software, no hardware) · **Hardware verified** (ran on a real
ESP32-S3) · **Blocked** · **Not implemented**. Nothing may be marked Hardware verified without a report in `docs/hw-reports/`.

Last updated: 2026-11-22. No ESP32-S3 board has been used so far: no cell below says Hardware verified.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Repo, AGPL-3.0 licence, pinned submodules, docs | Implemented | ADR-0001, ADR-0002 |
| 1 | `fido` image, dev + prod, pins unset (`--ci-pins`) | Build verified | ESP-IDF v5.5.6; dev 0.62 MB, prod 0.58 MB of the 1.88 MB app partition |
| 1 | `openpgp` image, dev + prod | Build verified | pico-openpgp pinned to upstream main `9b23276`; v5.0 does not build (ADR-0002) |
| 1 | Kconfig pins; build fails when unset | Build verified | verified: unset pins fail with the intended `#error`; plain-LED + pins compiles |
| 1 | BOOT (GPIO0, active low) as presence button, LED optional (`LED_TYPE_NONE` default), pin safety checks | Implemented, build verified | real-pin dev build of both images passes; WS2812/plain-LED compiled only earlier; not hardware verified |
| 1 | Real user presence enforced (patch 0001: non-zero timeout, button must be released then pressed) | Implemented, build verified | upstream default skipped the button entirely; needs hardware confirmation via `tools/ctap_smoke.py` |
| 1 | Dev build free of irreversible operations (`tools/check_no_irreversible.py`) | Build verified | fido-dev and openpgp-dev: PASS; checker flags the old hardened build as expected |
| 1 | Read-only probe of a real board (chip, 16 MB flash, fuses open) | Hardware probed (no function tested) | `docs/hw-reports/2026-11-23-read-only-probe.md` |
| 1 | No automatic eFuse writes (patch 0002) | Implemented, build verified | upstream burned KEY3/KEY4 at first boot; now opt-in |
| 2 | FIDO2/CTAP2 + U2F (upstream pico-fido v8.2) | Build verified; first-run procedure in FIRST_RUN_WINDOWS.md | hardware needed for any functional claim; `tools/ctap_smoke.py` written, never run on a device |
| 3 | SSH `*-sk`, Git signing | Not tested | no firmware work; scripts written (`tools/ssh_smoke.*`), never run |
| 4 | OpenPGP + PIV over CCID (separate image) | Build verified | `tools/gpg_smoke.sh` written, never run |
| 4 | OpenPGP + FIDO in ONE image | **Blocked** | two management applets and two key-wrapping providers; needs a reviewed design (ADR-0002) |
| 5 | MKAUTH applet (firmware) | Implemented, build verified | not hardware verified; no C-level unit tests |
| 5 | Rust host: proto / host / CLI | Unit tested (mock device) | 33 tests; mock signs with a test key; never run against PC/SC hardware |
| 6 | Linux PAM module (`multikey-pam`) | Implemented, unit tested (logic) | 11 tests on Windows; not built or run on Linux; not hardware verified |
| 6 | Windows: FIDO via platform WebAuthn, MKAUTH via PC/SC | Not tested | see WINDOWS.md |
| 6 | Windows Credential Provider | **Not implemented** | needs a VM snapshot to test safely; a faulty provider can lock a machine out |
| 7 | Hardened profile (Secure Boot v2 + flash encryption + JTAG off) | Build verified (throwaway key) | never fused or booted; partitions.hardened.csv encrypted-partition behaviour of the pico flash driver unverified |
| 7 | Read-only fuse checker `tools/provision_check.py` | Unit tested (fixtures) | live `espefuse` JSON shape read from source, not captured from a chip |
| 7 | OTA update, anti-rollback | Not implemented | no OTA partitions in the layout |
| 7 | Power-loss test of key store | Not tested | needs hardware |
| 8 | Composite device (HID + CCID) enumeration on real hosts | Not tested | needs hardware; use `docs/hw-reports/` |
| 8 | Reproducible dependency pinning (mbedTLS/tinycbor/libcvc by hash) | Not implemented | upstream fetches tags/branch at configure time |
