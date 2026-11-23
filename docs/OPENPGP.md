# MultiKeys OpenPGP / PIV image (Experimental)

Status: **Build verified** for 4, 8 and 16 MB; released as a development image; **not Hardware verified**: no OpenPGP or PIV
operation has been run on a board. The scripts below are Implemented and Unit tested (argument guards, status parsing, fake
pinentry) but were never run against a card. Do not use it for keys you rely on.

The `openpgp` image is a separate firmware, not an add-on to the FIDO2 image ([ADR-0002](ADR-0002-separate-images.md),
[DESIGN-combined-image](DESIGN-combined-image.md)). While it runs there is no FIDO2, no passkey, no MKAUTH, no WebUSB landing page and
no device renaming; the board shows up as a smart-card reader (CCID) with the OpenPGP card 3.x and PIV applets.

## Install

- Web installer: **Firmware type → MultiKeys OpenPGP** (Advanced / Experimental). Switching from the FIDO2 image needs the
  acknowledgements listed in [FLASHING_ADVANCED](FLASHING_ADVANCED.md) and `SWITCH` typed.
- Command line: `tools/flash_dev.py ... --app openpgp --ack-openpgp` (PowerShell: `-App openpgp -AcknowledgeOpenPgpImage`).

Both images share the `part0` data partition. Nothing is erased by installing, but the other image's keys and credentials stop being
usable and may be overwritten. Switching back means installing the FIDO2 image again; the credentials do not return.

## Default PINs (change them first)

User PIN `123456`, admin PIN `12345678`, reset code `12345678` (the values in `pico-openpgp/src/openpgp/openpgp.c`). Anyone with the key
can use them until you change them. The PIV applet starts with PIN `123456`, PUK `12345678` and the default management key.

## First use with GnuPG

Linux needs `pcscd` (`sudo apt install pcscd scdaemon gnupg`); Windows needs Gpg4win, whose scdaemon talks to the built-in smart-card service.
Use the native USB connector.

```sh
gpg --card-status                  # Application ID begins D27600012401, PIN retry counter "3 .. 3"
gpg --edit-card
gpg/card> admin
gpg/card> passwd                   # 1 change PIN, 3 change admin PIN: do this before generating keys
gpg/card> key-attr                 # optional: ECC (ed25519 / NIST P-256) or RSA up to the sizes the card reports
gpg/card> generate                 # on-card generation; asks the admin PIN, then the PIN
```

- If scdaemon fights pcscd for the reader, put `disable-ccid` into `~/.gnupg/scdaemon.conf`.
- SSH through the card: `enable-ssh-support` in `gpg-agent.conf`, `export SSH_AUTH_SOCK=$(gpgconf --list-dirs agent-ssh-socket)`, `ssh-add -L`.
- Touch policy: the card implements the OpenPGP user-interaction flag (UIF, `uif` in `gpg --edit-card`, checked in `cmd_pso.c` and
  `cmd_internal_aut.c`); with it on, signing, decrypting and authenticating wait for the BOOT button. It is off by default
  (`UIF setting: Sign=off Decrypt=off Auth=off`), so out of the box only the PIN gates a key use. The FIDO2 image's user-presence
  patches are separate. Not tested on hardware.
- Admin-less mode (non-standard, Gnuk-compatible) is off: `ENABLE_ADMINLESS_MODE` is not defined by this repository's build.

## PIV with yubico-piv-tool

```sh
yubico-piv-tool -a status
yubico-piv-tool -a generate -s 9c -A ECCP256 -o pub.pem
yubico-piv-tool -a verify-pin -a selfsign-certificate -s 9c -S "/CN=me/" -i pub.pem -o cert.pem
yubico-piv-tool -a import-certificate -s 9c -i cert.pem
yubico-piv-tool -a change-pin -P 123456 -N <new PIN>
```

OpenSC (`pkcs11-tool`, `opensc-tool`) can also talk to the PIV applet. Not verified here.

## Smoke tests

| Script | Default (read-only) | Destructive (test key only; needs both flags) |
|---|---|---|
| `tools/gpg_smoke.sh`, `tools/gpg_smoke.ps1` | `gpg --card-status`, checks AID, version, serial, PIN counters, key slots | factory reset, RSA-2048 on-card keygen, sign/verify, encrypt/decrypt, one wrong user PIN and recovery, replug and re-check |
| `tools/piv_smoke.sh` | `yubico-piv-tool -a status`, checks CHUID, CCC, PIN tries | ECCP256 in slot 9c, self-signed certificate, test signature, PIN change and change back, one wrong PIN |

Both run read-only unless you pass `--destructive` together with `--i-understand-this-resets-the-card` (PIV:
`--i-understand-this-changes-the-card`; PowerShell: `-Destructive -IUnderstandThisResetsTheCard`). The GnuPG scripts use a throw-away
`GNUPGHOME`, so your own keyring and gpg-agent are not touched; destructive mode answers pinentry with the public factory PINs through
`tools/fake_pinentry.py`. `python -m unittest discover tests/smoke` runs the parts that need no card.

The first hardware run must be recorded in `docs/hw-reports/` (date, board, OS, gpg version, what passed and what did not). Only then
may the image be called Hardware verified, `HARDWARE_VERIFIED_IMAGES` in `tools/package_firmware.py` gain `openpgp`, and the web installer
drop the Experimental badge.
