# Roadmap and status matrix

Vocabulary: **Implemented** (code exists) · **Build verified** (`idf.py build`/`cargo build` passes) ·
**Unit tested** · **Integration tested** (against host software, no hardware) · **Hardware verified** (ran on a real
ESP32-S3) · **Blocked** · **Not implemented**. Nothing may be marked Hardware verified without a report in `docs/hw-reports/`.

Last updated: 2026-11-22. No ESP32-S3 board has been used so far: every "Hardware verified" cell is empty.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Repo, AGPL-3.0 licence, pinned submodules, docs skeleton | Implemented | ADR-0001, ADR-0002 |
| 1 | `fido` image, dev + prod config, pins unset (`--ci-pins`) | Build verified | ESP-IDF v5.5.6, ~0.62 MB of 1.88 MB app partition |
| 1 | `openpgp` image, dev config | Build verified | pico-openpgp pinned to upstream main `9b23276` (v5.0 does not build, ADR-0002) |
| 1 | Kconfig pins; build fails when unset | Build verified | verified: unset pins fail with the intended `#error`; plain-LED + pins compiles |
| 1 | Button/LED wired through SDK patch | Implemented, build verified | not hardware verified |
| 2 | FIDO2/CTAP2 + U2F (upstream pico-fido v8.2) | Build verified | hardware needed for any functional claim |
| 3 | SSH `*-sk`, Git signing | Not tested | no firmware work needed; scripts pending |
| 4 | OpenPGP + PIV over CCID (separate image) | Build verified | not hardware verified |
| 4 | OpenPGP + FIDO in ONE image | **Blocked** | two management applets and two key-wrapping providers; needs a reviewed design (ADR-0002) |
| 5 | MKAUTH applet (firmware) | Implemented, build verified | not hardware verified; no C-level unit tests |
| 5 | Rust host: proto / host / CLI | Unit tested (mock device) | 33 tests; the mock signs with a test key; no PC/SC run against a device |
| 6 | Linux PAM module | Not implemented | |
| 6 | Windows Credential Provider | Not implemented | feasibility doc planned |
| 7 | Secure Boot v2 / flash encryption (prod) | Not implemented | operator-executed, never automatic |
| 8 | Composite device on real hardware | Not tested | |
