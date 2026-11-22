# Security model

Status: initial. Updated as features land.

## Assets and boundaries

Private keys (FIDO credentials, OpenPGP keys, MKAUTH key), PINs, device identity. The host is untrusted; the device
enforces PIN retry counters and user presence.

## Threats and current posture

| Threat | Posture |
|---|---|
| Malicious host / phishing | FIDO origin binding (upstream). User presence needs a physical button press (no bypass in prod). |
| Flash dump / physical extraction | **Dev builds: keys readable by anyone with physical access.** Prod profile adds flash encryption and Secure Boot v2 (Phase 7, operator-enabled). Keys are decrypted in RAM during use: the ESP32-S3 is not a secure element. |
| Side channels / fault injection | Not evaluated. No claims. |
| Firmware tampering | Secure Boot v2 in prod (not yet implemented). |
| Supply chain | Upstream deps pinned by submodule SHA; mbedTLS/tinycbor are fetched by tag at configure time (see DEPENDENCIES). |
| Weak RNG | Uses ESP-IDF hardware RNG via upstream; RF subsystem off means entropy quality needs checking (open item). |

## Rules

- No `user_presence=true` shortcuts in prod; CI will grep `sdkconfig.prod` for bypass options.
- Dev attestation only; no FIDO certification or CTAP 2.1 claim.
- Never auto-burn eFuses; irreversible steps are manual (PROVISIONING.md).
