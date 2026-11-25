# Security model

Status: design and build-time controls exist. One ESP32-S3 N16R8 board was tested on 2026-11-23 (user presence, FIDO UV/PIN
behaviour, the management channel, flashing; `docs/hw-reports/`); the hardened profile and the eFuse operations were never run on
hardware. **Nothing here has had a security review.** Do not protect real accounts with development builds.

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
  It also requires `--release` and `--board`, and refuses `--ci-pins`. Every `prod` build layers
  `sdkconfig.release-hardening` (silent panic reboot, no console, stack protector STRONG, heap poisoning, no OCD-aware
  debug, task watchdog panic; build-only, not hardware-verified). `DEBUG_APDU` (logs PINs) is a configure error in `prod`.
- In the hardened layout `part0` is **not** flash-encrypted (`partitions.hardened.csv`): the pico-keys flash journal
  programs a page twice, which a flash-encrypted page cannot do safely. Its secrets stay wrapped by the device key.
  Secure download mode still allows erase and plain writes (denial of service only). Unverified on hardware.

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
| FIDO UV policy | The UV flag is set only after a verified PIN token. The three upstream gaps listed in `docs/FIDO_UV.md` (getAssertion ignoring alwaysUv; a locked key answering with a decoy credential and a 0x0B-byte signature; alwaysUv off not restoring makeCredUvNotRqd) are fixed by `patches/pico-fido/0005`, with passing emulation tests. **Emulation tested and build verified; on the board only the PIN-set touch-only / UV paths ran (v0.3.4); the alwaysUv-on paths and the locked-key refusal are not hardware verified.** A key that already did an alwaysUv on/off round trip on an older build has lost the makeCredUvNotRqd flag and does not get it back. |
| CTAPHID_CANCEL | A request sent right after a cancel on the same channel used to receive the cancelled job's stale result. Fixed by `patches/pico-keys-sdk/0005` (request generation, one `KEEPALIVE_CANCEL`) and `patches/pico-fido/0006`; 12 emulation tests; **hardware verified on one board for three cancel cases** with the published v0.3.4 image (`docs/hw-reports/2026-11-23-v0.3.4-flash-and-cancel.md`; INIT during a wait and browser flows not run). A client that does not wait for the cancel answer can briefly see `CHANNEL_BUSY`. |
| Authenticator identity | AAGUID is a development value (`docs/USB_IDENTITY.md`). The per-device attestation certificate makes `direct` attestation device-identifying (upstream design); RPs that ask for `none` get nothing. |

## Web installer trust model

The web installer (`web/`, https://multikeys.mewis.me) flashes prebuilt firmware from the browser. What it relies on and
what it guarantees:

- **Source of the firmware.** The page fetches `firmware-manifest.json` and the firmware zip from the GitHub release through
  the site's own Worker (GitHub serves release assets without CORS headers). The Worker only accepts a release tag and one of
  three asset name patterns, holds no tokens and talks to GitHub over HTTPS.
- **Integrity, and authenticity only where a release is signed.** The manifest lists SHA-256 for the zip and each image; the
  installer checks the zip, every image and the embedded `firmware.json` before writing. The manifest comes from the same
  release, so on its own this detects corrupted or truncated downloads, not a compromised repository, release or Worker.
  The site can verify a detached Ed25519 signature of the manifest against public keys built into the site
  (`web/src/lib/firmware/release-keys.ts`, `docs/RELEASE_SIGNING.md`). **No release is signed and no signing key exists yet**, so
  every release is shown as "Not authenticated" and nothing is called authenticated. A release with an invalid, mismatched or
  unknown-key signature is refused.
- **What may be written.** Only the regions in `tools/flash_policy.json`: bootloader 0x0, partition table 0x8000, app
  0x20000 (the same allowlist `tools/flash_dev.py` enforces). A manifest whose images overlap `nvs`, `phy_init` or `part0`, or
  that lists other offsets, is rejected (`manifest-invalid`, no override).
- **Existing data.** Before writing, the installer reads the board's partition table and app descriptor (read-only) and picks
  an install mode. A matching layout keeps `part0` (credentials) and `nvs` untouched. An installed version outside the
  release's declared data-compatible range gets mode `update-forced` instead of an error: the three images are rewritten, `part0`
  is still not written, but the keys in it may become unusable. It needs the `force-storage` tick and the word `FORCE` typed.
  Switching between the FIDO and OpenPGP images
  and replacing non-MultiKeys firmware each need an
  explicit acknowledgement. A switch between the two images additionally needs the word `SWITCH` typed, because both images
  read the same `part0` in different formats: nothing is erased, but the other image's keys and credentials stop being usable.
  The OpenPGP image is offered only as Advanced / Experimental and always needs its own acknowledgement (it is build verified,
  never run on hardware). A foreign layout without MultiKeys on it can be repurposed only after typing `REPURPOSE`: the
  installer then writes 0xFF over `nvs` and `part0` (the previous firmware's data) before writing MultiKeys. A foreign layout
  with MultiKeys on it is refused (`storage-incompatible`). An unreadable table stops the install (`unsafe-layout`).
- **Never.** Full-chip erase, eFuse writes, Secure Boot/flash-encryption changes, PIN or credential operations.
- **After writing.** Each written region is read back (MD5 from the chip) before the installer reports success; detecting the
  running key afterwards is optional and only reads USB descriptors.

### Detect and plan (one flow at `/install`)

There is one web flow, `/install`. It reads the connected board in ROM download mode (read-only: partition table, app
descriptor, bootloader header, MD5 of the app region) and plans exactly one of: first install, update, reinstall (the identical
app written again), downgrade, repair, or a full-install mode (full update, forced update, switch image, replace layout,
repurpose). The decision is made by `web/src/lib/flashing/plan.ts` (`planFlash`), which combines `decideAppUpdate`
(`app-update.ts`) and `decideInstallMode` (`install-mode.ts`). What it does and does not guarantee:

- **Application-only writes** (modes `app-update`, `app-reinstall`, `app-downgrade`, `app-repair`) write exactly one region: the
  app image at `0x20000`, inside the `factory` partition. They never write the bootloader, the partition table, `nvs`,
  `phy_init` or `part0`, never erase, never fill, never touch eFuses. `app-update.ts` returns at most that one write and a unit
  test checks it for every allowed decision.
- **What they require.** The release declares `update.app_only`; the device partition table equals the release layout entry for
  entry (every partition's name, type, subtype, offset and size, no extra partition, a valid checksum entry, no overlap, nothing
  outside the flash) and has `factory` at the app offset with room for the image; a table that only keeps `nvs`, `phy_init` and
  `part0` in place is *compatible for a full install* but not exact, so the application-only path refuses it; the bootloader and
  the new app are for the same flash size; the installed app is a MultiKeys image of the same family. Anything not shown
  compatible is refused with the reason, and nothing is written on this path.
- **Update** (installed version older than the target) needs the installed version to be at least `update.data_preserving_from`.
- **Reinstall.** The flash MD5 of the app region equals the target image. The same single write is made; the person confirms with
  the `app-write-confirm` checkbox.
- **Downgrade** (installed version newer than the target). Allowed as application-only only if the *installed* release's manifest
  declares `update.downgrade_floor` at or below the target version (absent or `null` means not declared; `docs/RELEASES.md`). It
  needs the `downgrade-confirm` checkbox. Older versions may lack security fixes. **There is no anti-rollback on the board**: no
  eFuse or secure-boot version counter, so nothing prevents going back, or forward again.
- **Repair.** Same version but different content, or a pending-write record of this browser that matches the chip MAC, release and
  image and is less than 7 days old. It needs the typed word `REPAIR`.
- **Fallback to the full write is offered, never applied silently.** When the application-only path is refused (layout not exact,
  version outside the declared range, downgrade not declared, release without `update.app_only`, installed app unreadable or
  without a matching record, unparsable version) and a same-family board with a matching layout is detected, the page offers the
  full write: bootloader, partition table and app, `part0` untouched (mode `update`, or `update-forced` with `FORCE` typed). It
  shows why the application-only path was refused and writes only after the acknowledgements listed above for those modes.
- **Final re-check.** The decision is re-read and re-made on the same open connection immediately before writing; if it
  differs, the new decision is shown instead of writing.
- **Same key.** The page may first read the running key over WebUSB (read-only: BUILD_INFO, name, MKAUTH status). A board in
  download mode whose version, family or flash size differs from that reading is refused outright (`different-key`), without
  fallback. It does **not** prove that the key in download mode is physically the one that was read: the chip serial seen by the
  firmware has not been correlated with the ROM-mode reading, so the page says "plug in only the key you checked".
- **Data.** `part0` is not written, and the application-only paths are designed to keep credentials, the FIDO PIN, the MKAUTH
  record and the name. The page cannot read credentials or the PIN, so it never claims they are intact. After an application-only
  write it reports (when the key was read beforehand): the running image SHA-256 equals the published one, the version matches,
  the name and the MKAUTH enrollment and device id equal the ones read before; the FIDO credentials and PIN are shown as "not
  checked" (never read).
- **Not atomic.** A single slot is written: an interrupted write leaves the key unable to start until the write is run again
  from download mode. It is not an OTA update, has no rollback and no A/B slots. The browser records the started write
  (`localStorage`, `multikeys-pending-update`) until the flash MD5 matches; only with that record, and only for the same build,
  does the page offer a typed-`REPAIR` rewrite of an application whose descriptor is unreadable. The record names the release
  tag, the image family and profile, the application SHA-256 and the ROM-mode MAC address of the chip the write started on, and
  is used only when all of them equal what is connected now and it is less than 7 days old. A record from an older page, a stale
  one, one for another release or image, for another MAC, or made or checked without a readable MAC is refused
  (`recovery-unverified`) and the person is offered to discard it or to run a full install (which keeps `part0` when the partition
  table is intact). A MAC address is not a secret and the running firmware's WebUSB identity is not linked to it, so this
  shows "the same chip as when the write started" as far as a MAC does, not that the chip is the one that was inspected. Without
  a record the key is not repaired.
- **Storage compatibility is declared, not detected.** The key's file system has no version marker. Compatibility rests on
  `update.data_preserving_from` and `update.downgrade_floor` (release process: `docs/RELEASES.md`) and on code inspection that
  nothing in the stored formats changed since 0.2.0; it has not been tested across versions on hardware.

Status: the installer is unit tested (`plan.test.ts`, `app-update.test.ts`) and integration tested with a simulated board
(Playwright). Only the former application-only update path was run once on real hardware (one board,
`docs/hw-reports/2026-11-23-web-installer.md`). Reinstall, downgrade, automatic detection, the full-write fallback and the merged
page are **not Hardware verified**; see `docs/ROADMAP.md`.

### Renaming the key from the browser (WebUSB management)

After a verified flash the installer can give the key a USB product name (and First use can change it later). What that channel
can and cannot do:

- **Channel.** MKAUTH over the WebCCID interface (a vendor-class interface that runs the same CCID parser; Chrome's WebUSB
  refuses the smart-card interface). The page sends SELECT, GET_INFO and INS 06 GET/SET/CLEAR only: no enrolment, revocation,
  challenge or credential operation exists in the web code (`web/src/lib/device/`).
- **BOOT press, always.** SET and CLEAR need a button press inside 15 s (`6300` otherwise) and, once MKAUTH is enrolled, the
  management PIN. The page cannot skip either; it can only wait and report.
- **The PIN is not stored.** It is typed into a password field, sent as one APDU and cleared from the component's state when
  sent. It is never written to `sessionStorage` (the saved installer choices are the release tag, the image and the requested
  name), never logged and never part of an error text. A wrong PIN costs one of the key's 8 tries; the page shows the tries the
  key reports and never retries a PIN by itself. A blocked applet cannot be recovered from the browser.
- **No binary is modified.** The firmware that was verified is written unchanged; the name is applied afterwards through the
  management channel and lives in its own file on the key (`docs/PROTOCOLS.md`, INS 06). Nothing patches an image.
- **Verified, not assumed.** After the key re-enumerates the page reads the stored name (GET) and the USB product string again; it
  says "Applied and verified" only when both equal the request and no re-enumeration is pending. Otherwise it says the name was
  not confirmed and points to First use.
- **A silent key is not a missed button.** Only the key's own status word 6300 is shown as "BOOT button wasn't pressed in time". A key that
  does not answer (seen on hardware right after a restart of its USB connection) is waited for and read again; if the write itself got no
  answer the page reads the name back and reports success only if the key says it changed (`docs/hw-reports/2026-11-23-profiles-and-personalization.md`).
- **A label only.** As in the threat table, a rename can mislead a human about which key is which; it cannot change keys,
  credentials, VID/PID or the AAGUID. For a schema-1 release (v0.2.0) the page does not attempt a rename and says it is not
  available.

### What the key reports about itself (build info and passkey events)

Two read-only channels, both on the vendor interface the web installer already uses (`docs/PROTOCOLS.md`, INS 07 and "Live events"):

- **Build info (MKAUTH INS 07).** Name, version, source commit, SHA-256 of the running image, chip, security flags, reset reason, uptime
  and the running partition. It needs no button and no PIN, and it writes nothing. It leaves out the MAC address, the serial number and
  the MKAUTH `device_id`, so it does not identify one key among others. Anyone who can open the interface learns which release or local
  build you run, which tells an attacker which known bugs to try; that is the same information a USB descriptor and a firmware
  download page already give for a published release.
- **Passkey events.** For every registration, sign-in and BOOT wait the key pushes the relying party id, the account name the site chose,
  the algorithm, the authenticator-data flags (button pressed, user verified) and the CTAP2 error of a failure. The user-verified flag is
  what the firmware tells the site, not proof that a PIN was typed: on the test board events with that flag set were seen for a
  registration and a sign-in started by a page that asked for `userVerification: "discouraged"`, and whether that key had a FIDO PIN was not
  checked in that run. This is upstream
  pico-fido behavior, not something this repository added, and it is **not gated by a PIN or a button**: any local program that can
  claim the key's WinUSB interface (the command `multikey device watch` does, without administrator rights on Windows) and any page the
  user lets claim it in the browser sees which sites you sign in to, while it listens. The browser asks for the device first
  (WebUSB permission), and a page that holds the interface releases it when it stops. Treat it like the screen of the machine the key is
  plugged into: the key does not make this worse, but it does not hide it either. Events that nobody read wait in the key (a few of
  them), so a program that connects later can read the last events that happened before it started.
- **Nothing here is written.** Neither channel can change the key. `multikey device build --manifest` and the web page only compare
  a hash with the published manifests; a match proves the key runs that published image, no match is not proof of tampering.

### CI caches

Caches only speed builds up; a release never uses one. Pull requests and `main` restore the ESP-IDF ccache
(`ccache-ci-<app>-<profile>-idf5.5.6-<sha>`, `ccache-release-<hw>-idf5.5.6-<sha>`) and the Rust build cache; **only runs on `main`
save them**, a pull request's cache is scoped to that pull request by GitHub, and a tag run restores and saves nothing and
compiles from scratch. `tests/release/test_workflows.py` fails if a cache step in the `build` or `firmware` job of `release.yml`
can run for a tag or if a cache is saved from anywhere but `main`. Cache entries are not signed: the boundary is who may write them,
not their content.

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
