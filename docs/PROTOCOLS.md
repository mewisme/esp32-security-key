# Protocols

| Protocol | Provided by | Status |
|---|---|---|
| CTAPHID, CTAP2, U2F | upstream pico-fido v8.2 (advertised versions to be read from `GetInfo` on hardware) | Not hardware verified. No FIDO certification claimed. |
| OpenPGP card 3.x | upstream pico-openpgp v5.0 | Not integrated |
| SSH `ecdsa-sk` / `ed25519-sk` | FIDO2; ed25519-sk requires EdDSA in `GetInfo` algorithms | Not tested |
| Git SSH signing | `ssh-keygen -Y sign` with sk key | Not tested |
| MKAUTH applet | this repo, AID `F0 4D 4B 41 55 54 48 01`, CLA 80 | Not implemented (spec in plan; will be documented here when implemented) |
