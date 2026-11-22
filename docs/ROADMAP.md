# Roadmap and status matrix

Vocabulary: **Implemented** (code exists) · **Build verified** (`idf.py build`/`cargo build` passes) ·
**Unit tested** · **Integration tested** (against host software, no hardware) · **Hardware verified** (ran on a real
ESP32-S3) · **Blocked** · **Not implemented**. Nothing may be marked Hardware verified without a report in `docs/hw-reports/`.

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Repo, licence, submodules, docs skeleton | Implemented | |
| 1 | Firmware project builds (dev) | Not verified yet | updated when `tools/build.py dev --ci-pins` succeeds |
| 1 | Firmware project builds (prod config) | Not verified yet | |
| 1 | Kconfig button/LED pins, build fails if unset | Implemented | wired into upstream button/LED via patches: pending |
| 2 | FIDO2/CTAP2 + U2F (upstream pico-fido) | Not verified yet | hardware needed |
| 3 | SSH `*-sk`, Git signing | Not tested | hardware needed |
| 4 | OpenPGP over CCID (upstream pico-openpgp) | Not integrated | SDK pin mismatch to check; symbol overlap with fido |
| 5 | MKAUTH applet + Rust host tools | Not implemented | |
| 6 | Linux PAM | Not implemented | |
| 6 | Windows Credential Provider | Not implemented | feasibility doc planned |
| 7 | Secure Boot / flash encryption (prod) | Not implemented | operator-executed, never automatic |
| 8 | Composite device on real hardware | Not tested | |
