# Architecture

```
Host apps (browser, ssh, git, gpg, PAM, multikey CLI)
        │ USB
┌───────┴──────────── ESP32-S3 native USB OTG (TinyUSB) ─────────────┐
│ HID interfaces (CTAPHID, OTP kbd)  CCID interface (smart card)     │
│   └─ pico-fido: CTAP2 / U2F          ├─ fido image: OATH + MKAUTH  │
│                                      └─ openpgp image: OpenPGP/PIV │
│ Vendor-class WinUSB interface ("WebCCID", same CCID parser, lets   │
│   the browser reach MKAUTH over WebUSB)                            │
│            pico-keys-sdk: APDU router, file system, key-encryption  │
│            multikey_platform: button (user presence), LED, pins     │
│            multikey_auth: MKAUTH applet                             │
│ ESP-IDF v5.5.6 · mbedTLS (software ECC/EdDSA) · flash fs partition  │
└─────────────────────────────────────────────────────────────────────┘
```

- The `fido` image enumerates as a composite device: two HID interfaces (FIDO, keyboard for the OTP applet), a CCID reader and
  the WinUSB interface (hardware verified on Windows 11, `docs/hw-reports/2026-11-23-first-run.md`). The `openpgp` image has no HID
  and carries OpenPGP/PIV instead of FIDO, OATH and MKAUTH (Experimental, build verified; [OPENPGP](OPENPGP.md)); the two are separate
  images ([ADR-0002](ADR-0002-separate-images.md)). Why they cannot be one image yet, measured: [DESIGN-combined-image](DESIGN-combined-image.md).
- MKAUTH rides on CCID (and on the WebCCID interface from the browser), so it needs no interface of its own.
- Source layout: `pico-*` submodules (pinned, never edited), `patches/` (our changes to them), `components/` (our
  firmware components), `host/` (Rust workspace), `web/` (web installer), `tools/`, `docs/`.
- See [ADR-0001](ADR-0001-foundation.md) for the reasons behind each choice and ROADMAP for what exists today.
