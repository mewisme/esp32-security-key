# Windows

Status: platform FIDO2 / OpenSSH paths **unverified, not hardware verified**; PC/SC MKAUTH path **Unit tested** in the
host library only (mock device); Credential Provider **Not implemented**.

## What works with none of our code (all pending hardware)

- **WebAuthn / Windows Hello platform API.** Windows talks to FIDO2 authenticators through its built-in WebAuthn API
  (`webauthn.dll`). Browsers and Microsoft / Entra ID sign-in use it. This needs the key to enumerate as a FIDO HID
  device, which the `fido` image is designed to do (see [ARCHITECTURE.md](ARCHITECTURE.md)). Not hardware verified;
  CTAP conformance is untested.
- **Win32-OpenSSH `ssh-keygen -t ecdsa-sk`** (and `ed25519-sk` if the device advertises EdDSA). Requires OpenSSH for
  Windows 9.x; per the OpenSSH/Microsoft documentation, creating or using a security key via the WebAuthn path on Windows
  needs an elevated (administrator) prompt. Marked **unverified**: to be tested, see [TESTING.md](TESTING.md).

## Supported way to use MKAUTH on Windows: PC/SC

The MKAUTH applet is reached through the CCID interface of the `fido` image. Windows exposes it through winscard
(`SCardTransmit`); `multikey-host` uses the `pcsc` crate, which links winscard on Windows, so `multikey enroll|auth|status`
work from scripts and services in the same way as on Linux. Trust store: `%ProgramData%\MultiKey\trusted.toml`
(restrict its ACL to Administrators/SYSTEM write). Whether the Windows smart-card stack accepts the CCID descriptors of
this device is pending hardware.

## What does not work, and why

- A **Windows service cannot unlock a session** or satisfy the logon screen: the secure desktop and credential entry
  belong to LogonUI and the registered credential providers. Running `multikey auth` from a service proves possession
  but unlocks nothing.
- **Unlocking the local logon screen** requires a **Credential Provider**: a COM DLL registered under
  `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\Credential Providers` and loaded by LogonUI.

## Credential Provider design (not implemented)

Status: **Not implemented.** Reason: it cannot be validated without a Windows VM snapshot with a tested recovery path,
and a faulty provider can lock the machine out of interactive logon.

Intended design, additive only:

- Wraps the standard password credential (filter / wrapper around the stock password provider). The user types the
  Windows password as usual; the provider additionally requires a verified MKAUTH signature (button press) before
  submitting. It is a second factor on top of the password, not a replacement.
- It never stores, caches or replaces the Windows password and never handles any PIN.
- If no device is present the behaviour is a documented policy choice (fall back to password-only vs. deny); default
  must be fall back, so a lost key does not lock the machine.
- Installed only by an explicit administrator command (`multikey-credprov register`) and removed by `unregister`.
  Removal must also be possible from safe mode (delete the registry key) and from Windows recovery (offline hive).
- Validation plan: VM with a snapshot, a second local administrator account, RDP/console recovery tested before the
  first registration. Until that exists this stays unbuilt.
