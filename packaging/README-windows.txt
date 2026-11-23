multikey - host tool for MultiKeys security keys (Windows x86_64)

multikey.exe is a single self-contained program. There is no installer and nothing is written outside the
folder you put it in, except the trust store (only when you use `mkauth enroll`) at %APPDATA%\multikey.

Verify the download (SHA256SUMS is a separate release asset):
    Get-FileHash -Algorithm SHA256 .\multikey-v<version>-windows-x86_64.zip
and compare with the line in SHA256SUMS.

Use (PowerShell):
    .\multikey.exe --version
    .\multikey.exe --help
    .\multikey.exe device list           # needs the key plugged in and the "Smart Card" service running
    .\multikey.exe device info
    .\multikey.exe fido info             # run from an Administrator terminal: Windows only lets
                                         # elevated programs open FIDO HID devices

Two different PINs exist and they are unrelated:
  - FIDO PIN   (multikey fido pin ...)    used by browsers/WebAuthn. Setting it is irreversible without
                                          authenticatorReset, which deletes every credential on the key, and on this
                                          firmware it ends touch-only use.
  - MKAUTH PIN (multikey mkauth ...)      used only by the login-key applet and the Linux PAM module.

Not FIDO certified. The key firmware is a development build; do not use it to protect real accounts.

Uninstall: delete the folder (and %APPDATA%\multikey if you used mkauth enroll).
License: GNU AGPL-3.0-or-later (LICENSE). Third-party crates: THIRD_PARTY_LICENSES.txt.
Source: https://github.com/mewisme/esp32-security-key
