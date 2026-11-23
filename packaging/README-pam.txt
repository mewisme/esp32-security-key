pam_multikey.so - PAM module for MultiKeys MKAUTH login keys (Linux x86_64)

WARNING: a mistake in PAM configuration can lock you out of the machine. Keep a root shell open, test in a spare
service first, and never put this module in a stack you cannot recover without logging in.

Requirements: libpam0g, libpcsclite1 and a running pcscd
    sudo apt install libpam0g libpcsclite1 pcscd
Built on Ubuntu 22.04 (glibc 2.35). Enroll the key first with the multikey tool (`multikey mkauth enroll`), see
docs/LINUX_PAM.md in the source repository.

Verify the download (SHA256SUMS is a separate release asset):
    sha256sum -c SHA256SUMS --ignore-missing

Install (the directory depends on the distribution):
    Debian/Ubuntu x86_64:   sudo install -m 0644 pam_multikey.so /lib/x86_64-linux-gnu/security/
    others:                 sudo install -m 0644 pam_multikey.so /lib/security/

Configure ONE service file only, starting with a test service such as /etc/pam.d/multikey-test:
    auth required pam_multikey.so
    account required pam_permit.so
Test it without logging out:
    sudo apt install pamtester
    pamtester multikey-test "$USER" authenticate
Only after that works, consider adding it to a real service as `auth sufficient` or `required` per your policy.
The module fails closed: with no key, no reader or no pcscd, authentication fails.

Uninstall: remove the `pam_multikey.so` lines from the PAM service files first, then delete the .so.

Not FIDO certified. The key firmware is a development build; do not use it to protect real accounts.
License: GNU AGPL-3.0-or-later (LICENSE). Third-party crates: THIRD_PARTY_LICENSES.txt.
Source: https://github.com/mewisme/esp32-security-key
