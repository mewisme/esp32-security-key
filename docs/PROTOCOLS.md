# Protocols

| Protocol | Provided by | Status |
|---|---|---|
| CTAPHID, CTAP2, U2F | upstream pico-fido v8.2 (advertised versions to be read from `GetInfo` on hardware) | Build verified. Not hardware verified. No FIDO certification claimed. |
| OpenPGP card 3.x | upstream pico-openpgp v5.0 (separate firmware image, see ADR-0002) | Build status in ROADMAP. Not hardware verified. |
| SSH `ecdsa-sk` / `ed25519-sk` | FIDO2; ed25519-sk requires EdDSA in `GetInfo` algorithms | Not tested |
| Git SSH signing | `ssh-keygen -Y sign` with sk key | Not tested |
| MKAUTH applet | this repo | Specified below; see ROADMAP for implementation status |
