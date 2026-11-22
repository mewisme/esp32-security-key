# ADR-0001: Foundation, licensing and layout

Status: accepted (2026-11-22)

## Decisions

1. **Base = Pico Keys.** `pico-keys-sdk` + `pico-fido` + `pico-openpgp` (all AGPL-3.0, Pol Henarejos) as pinned
   git submodules at the repository root (`./pico-keys-sdk`, `./pico-fido`, `./pico-openpgp`).
   Upstream's ESP-IDF port lives in `pico-keys-sdk/config/esp32` and ESP32-S3 + Secure Boot/Secure Lock are
   documented upstream. Rejected: writing our own CTAP/OpenPGP stack (size, risk); `itres-labs/esp32-fido2-lab`
   (MIT but CTAP2-only: no resident keys, U2F or attestation); `Escape2snap/esp32-fido2` and
   `LibreFido/pico-fido2` (references only; the latter targets an older SDK API).
2. **Licence: AGPL-3.0-or-later for the whole project**, because it links AGPL code. Approved by the project owner.
3. **ESP-IDF v5.5.6.** Upstream CI builds with v5.5.1; we use the owner's choice 5.5.6.
4. **Submodules at repo root, not `third_party/`.** Upstream CMake uses project-relative paths such as
   `pico-keys-sdk/config/esp32/components/...`; matching the upstream layout avoids patching them.
   Local firmware changes go in `patches/<submodule>/NNNN-*.patch` (applied by `tools/apply_patches.py`),
   never as edits inside a submodule.
5. **Pinned versions:** see [DEPENDENCIES.md](DEPENDENCIES.md). pico-fido v8.2 pins pico-keys-sdk `50699e5`; that SDK
   commit is used for every app. pico-openpgp v5.0 pins a different, older SDK commit (`b35df81`) and is therefore
   validated against `50699e5` at build time (see ROADMAP).
6. **Custom auth transport = an APDU applet on the CCID interface**, not a third USB interface (endpoint budget on
   the S3 OTG core, free PC/SC support on Windows and Linux).
7. **No assumed GPIOs.** Button and LED pins are Kconfig values defaulting to -1; the build fails while unset.
8. **PSRAM disabled** so key material never goes to external RAM.
9. **Dev/prod split:** `sdkconfig.dev`, `sdkconfig.prod`, separate build dirs. No script burns eFuses or enables
   Secure Boot; those steps are manual and marked irreversible in PROVISIONING.md.
10. **USB VID/PID** `0x303A:0x4002` is a development placeholder only (Kconfig-overridable); not for distribution.

## Consequences

- Distributing binaries requires publishing the corresponding source (AGPL section 13 applies to network use;
  this is a device, but treat source offer as mandatory).
- We inherit upstream's cryptographic and protocol correctness, bugs and CTAP feature set.
