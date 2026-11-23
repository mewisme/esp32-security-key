multikey - host tool for MultiKeys security keys (Linux x86_64)

Requirements: libpcsclite1, libudev1 and a running pcscd (Debian/Ubuntu: sudo apt install libpcsclite1 libudev1 pcscd;
libudev1 is already present on desktop systems).
Built on Ubuntu 22.04 (glibc 2.35); older distributions may not run it.

Verify the download (SHA256SUMS is a separate release asset):
    sha256sum -c SHA256SUMS --ignore-missing

Install (optional): copy `multikey` to a directory on PATH, e.g.
    sudo install -m 0755 multikey /usr/local/bin/multikey

Use:
    multikey --version
    multikey --help
    multikey device list
    multikey device info
    multikey fido info        # needs hidraw access to the key (udev rule or the plugdev group)

Two different PINs exist and they are unrelated:
  - FIDO PIN   (multikey fido pin ...)    used by browsers/WebAuthn. Setting it is irreversible without
                                          authenticatorReset, which deletes every credential on the key, and on this
                                          firmware it ends touch-only use.
  - MKAUTH PIN (multikey mkauth ...)      used only by the login-key applet and the PAM module.

Not FIDO certified. The key firmware is a development build; do not use it to protect real accounts.

Uninstall: delete the binary (and /etc/multikey/trusted.toml if you used mkauth enroll).
License: GNU AGPL-3.0-or-later (LICENSE). Third-party crates: THIRD_PARTY_LICENSES.txt.
Source: https://github.com/mewisme/esp32-security-key
