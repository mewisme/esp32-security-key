# Architecture

```
Host apps (browser, ssh, git, gpg, PAM, multikey CLI)
        │ USB
┌───────┴──────────── ESP32-S3 native USB OTG (TinyUSB) ─────────────┐
│ HID interface (CTAPHID)          CCID interface (smart card)        │
│   └─ pico-fido: CTAP2 / U2F        ├─ OpenPGP applet (pico-openpgp) │
│                                     └─ MKAUTH applet (this repo)    │
│            pico-keys-sdk: APDU router, file system, key-encryption  │
│            multikey_platform: button (user presence), LED, pins     │
│ ESP-IDF v5.5.6 · mbedTLS (software ECC/EdDSA) · flash fs partition  │
└─────────────────────────────────────────────────────────────────────┘
```

- Two USB interfaces only (HID + CCID); MKAUTH rides on CCID, so no third interface is needed.
- Source layout: `pico-*` submodules (pinned, never edited), `patches/` (our changes to them), `components/` (our
  firmware components), `host/` (Rust workspace), `tools/`, `docs/`.
- See [ADR-0001](ADR-0001-foundation.md) for the reasons behind each choice and ROADMAP for what exists today.
