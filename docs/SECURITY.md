# Security model

Status: design and build-time controls exist; **no hardware has been tested and nothing here has had a security review**.
Do not protect real accounts with development builds.

## What the ESP32-S3 is and is not

The ESP32-S3 is a general-purpose microcontroller, **not a secure element**:

- Private keys are decrypted into internal RAM while in use and are exposed to anything that can read that RAM.
- ECC and EdDSA run in software on the CPU (no ECC accelerator on the S3), so timing/power side channels were not
  evaluated. No side-channel or fault-injection resistance is claimed.
- External flash is outside the chip. Without flash encryption anyone with physical access can read it with a clip.

## Assets and boundaries

Assets: FIDO credentials and resident keys, OpenPGP/PIV keys, the MKAUTH P-256 key, PINs, device identity.
The host is untrusted. The device enforces PIN retry counters and user presence (physical button).

## Protection at rest: three levels

| Level | How it is reached | What it protects against | Status |
|---|---|---|---|
| **Dev (default)** | `build dev`, `build prod` | Nothing meaningful. Stored secrets are wrapped with a key derived from the chip serial only (`derive_kbase` with no OTP key). Flash is readable and writable, JTAG and ROM download are open. | Build verified |
| **Prod + MKEK in eFuse** | `CONFIG_MULTIKEY_ALLOW_EFUSE_PROVISIONING=y` | A random master key in eFuse KEY3/KEY4 (write-protected) is mixed into the wrapping key, so a dump of external flash alone no longer reveals secrets. Upstream burns it silently at first boot; we make it opt-in. Irreversible. | Build not verified for this option, not hardware verified |
| **Hardened** | `build prod --harden` (`sdkconfig.hardening`): Secure Boot v2 (RSA-3072) + flash encryption (Release) + restricted ROM download + JTAG disabled | Modified firmware, flash dumping, JTAG readout. Release-mode flash encryption fuses cannot be undone. | Build verified (throwaway key). Fusing: Not performed; hardware flow not verified |

Important consequence: **with the default configuration the "encryption" of keys on flash is obfuscation.** Upstream's
README makes the same distinction for chips without OTP secrets.

## Irreversible operations: policy

- No script and no default image burns eFuses. `tools/provision_check.py` only reads.
- Upstream pico-keys-sdk burns eFuses in two places: automatically at first boot (random MKEK into KEY3/KEY4) and from
  the USB rescue interface (Secure Boot digest bound to the *upstream project's* key plus JTAG fuses). Patch
  `patches/pico-keys-sdk/0002-multikey-no-automatic-efuse-writes.patch` disables the second path entirely and gates the
  first behind the Kconfig option above. Without an MKEK the SDK falls back to its no-OTP derivation (an unprogrammed
  eFuse block is never used as an all-zero key).
- The hardened image burns fuses by design when booted on a blank chip: `tools/build.py` refuses to build it without
  `--signing-key` and `--i-understand-irreversible`, and PROVISIONING.md spells out the consequences.

## Threats and posture

| Threat | Posture |
|---|---|
| Malicious host / phishing | FIDO origin binding (upstream). User presence needs a physical button press. |
| MKAUTH replay / MITM | Fresh verifier nonce + device nonce + device_id in the signed transcript; the device keeps no replay state; a relay attack (malware forwards challenges to a real key) is not prevented, as with any presence-only token. |
| Stolen device (powered off) | Dev: keys recoverable. Hardened: see table; PIN retry counters protect only against use through the USB interface, not against hardware attacks. |
| PIN brute force over USB | FIDO/OpenPGP counters from upstream. MKAUTH: 8 tries, persisted, decremented before compare. A blocked MKAUTH applet is not recoverable except by wiping storage. |
| Firmware tampering | Only with Secure Boot v2 (hardened). |
| Supply chain | Submodules pinned by SHA; mbedTLS/tinycbor/libcvc are fetched by tag/branch at configure time (not hash-pinned). |
| Weak RNG | The SDK RNG (hardware RNG based) is used everywhere; entropy quality with Wi-Fi/BT off was not assessed. |
| Debug/UART output | Dev builds log at INFO; prod at WARN. UART logging is not disabled in prod. |
| Device renaming | The name is a label. Changing it needs a BOOT press and, once MKAUTH is enrolled, the MKAUTH PIN; an unenrolled key has no PIN, so a press is the only check and malware that can reach the key can rename it after a press (spoofing a different label to a human, nothing more: keys, credentials, VID/PID and AAGUID cannot change through it, and the CLI/host find the key by the manufacturer string, which a rename does not change). `MULTIKEY_USB_CUSTOM_NAME_ENABLED=n` removes the feature. |
| FIDO UV policy | The UV flag is set only after a verified PIN token. With a PIN set, `docs/FIDO_UV.md` lists upstream gaps found by the emulation tests: getAssertion ignores alwaysUv; a locked key returns a signature that does not verify instead of an error (cause not analysed; no key exposure was observed, none was looked for beyond the failed verification); toggling alwaysUv off leaves makeCredUvNotRqd cleared. Not patched. |
| Authenticator identity | AAGUID is a development value (`docs/USB_IDENTITY.md`). The per-device attestation certificate makes `direct` attestation device-identifying (upstream design); RPs that ask for `none` get nothing. |

## Web installer trust model

The web installer (`web/`, https://multikeys.mewis.me) flashes prebuilt firmware from the browser. What it relies on and
what it guarantees:

- **Source of the firmware.** The page fetches `firmware-manifest.json` and the firmware zip from the GitHub release through
  the site's own Worker (GitHub serves release assets without CORS headers). The Worker only accepts a release tag and one of
  three asset name patterns, holds no tokens and talks to GitHub over HTTPS.
- **Integrity, not authenticity.** The manifest lists SHA-256 for the zip and each image; the installer checks the zip, every
  image and the embedded `firmware.json` before writing. The manifest comes from the same release, so this detects corrupted
  or truncated downloads, not a compromised repository, release or Worker. Nothing is signed.
- **What may be written.** Only the regions in `tools/flash_policy.json`: bootloader 0x0, partition table 0x8000, app
  0x20000 (the same allowlist `tools/flash_dev.py` enforces). A manifest whose images overlap `nvs`, `phy_init` or `part0`, or
  that lists other offsets, is rejected (`manifest-invalid`, no override).
- **Existing data.** Before writing, the installer reads the board's partition table and app descriptor (read-only) and picks
  an install mode. A matching layout keeps `part0` (credentials) and `nvs` untouched; updates outside the release's declared
  data-compatible range, switching between the FIDO and OpenPGP images and replacing non-MultiKeys firmware each need an
  explicit acknowledgement. A foreign layout without MultiKeys on it can be repurposed only after typing `REPURPOSE`: the
  installer then writes 0xFF over `nvs` and `part0` (the previous firmware's data) before writing MultiKeys. A foreign layout
  with MultiKeys on it is refused (`storage-incompatible`). An unreadable table stops the install (`unsafe-layout`).
- **Never.** Full-chip erase, eFuse writes, Secure Boot/flash-encryption changes, PIN or credential operations.
- **After writing.** Each written region is read back (MD5 from the chip) before the installer reports success; detecting the
  running key afterwards is optional and only reads USB descriptors.

The installer is unit- and e2e-tested against a simulated board and was run once on real hardware (one board, update path,
`docs/hw-reports/2026-11-23-web-installer.md`); see `docs/ROADMAP.md`.

## Rules enforced in the repository

- **User presence is real and not configurable.** Upstream pico-keys-sdk returns a button timeout of 0 unless one was
  commissioned into the device's phy config, and a timeout of 0 makes every presence check succeed immediately, i.e. a
  stock upstream build asserts the FIDO UP flag without any button press. Patch 0001 makes `button_timeout_seconds()`
  return `CONFIG_MULTIKEY_UP_TIMEOUT_MS` (>= 1 s, from Kconfig, not lowerable from the host). It also requires the button
  to be seen released, then pressed, then released after the request starts (upstream accepted a button already held down).
  Hardware result (2026-11-23, one board, `docs/hw-reports/2026-11-23-first-run.md`): the stock behaviour was confirmed to
  accept makeCredential with no button press (0.2 s, no presence keepalive; an additional upstream gap: no presence check
  at all when the platform sends no pinUvAuthParam, fixed by `patches/pico-fido/0001`). After the fixes a request without a
  press is refused after 15 s, a press-and-release satisfies it, and a button held down before the request does not. One
  unexplained early success at about 10 s was seen in 1 of 6 no-touch runs (probable early press); open. An earlier statement
  here that there is "no user-presence shortcut" referred only to MKAUTH and was incomplete for FIDO.
- MKAUTH policy bit0 is hard-wired; CI asserts `sdkconfig.prod` and `sdkconfig.defaults` do not set
  `CONFIG_MULTIKEY_ALLOW_UNSET_PINS_FOR_CI`.
- GPIO0 (BOOT) as the presence button is safe for boot and flashing because it is only read as an input after boot
  (HARDWARE.md); the build rejects pins that collide with USB or flash/PSRAM and requires acknowledgement for strapping
  pins 3/45/46.
- `tools/check_no_irreversible.py` checks a finished dev build: no Secure Boot / flash-encryption / eFuse-provisioning
  option enabled, and no project object linked against an eFuse write API.
- Dev attestation only; no FIDO certification and no CTAP 2.1 claim.
- OATH/OTP applets (YubiKey-compatible) are enabled in the fido image because upstream references them unconditionally.
  They enlarge the attack surface; removing them needs an upstream-level change.
- Admin-less OpenPGP mode (non-standard, Gnuk-compatible) is **off** (upstream turns it on for non-ESP builds).
