# Linux PAM module (`pam_multikey.so`)

Status: **Implemented** (module) · **Unit tested** (decision logic and argument parsing, mock device) · **Build verified on Linux**
(CI builds and tests `multikey-pam`; the release workflow checks the shipped `.so`: dependencies, symbols, `dlopen`, and a `pamtester`
run with no key that must fail closed) · **Not hardware verified** (no authentication with a real key through PAM).

The module authenticates a PAM user with the MKAUTH v1 applet ([PROTOCOLS.md](PROTOCOLS.md)): it looks up the user in
the trust store, asks the device for a challenge response (the user presses the button) and verifies the signature
against the stored public key and device id. **No PIN is used or prompted at login** (the MKAUTH PIN set by `enroll` guards
`revoke` and renames, not `authenticate`). Presence of the key plus a button press is the whole check.

## Install the prebuilt module

```sh
curl -fsSL https://get.mewis.me/esp32-security-key.sh | sh -s -- --pam
```

installs `multikey` and, from the same release, `pam_multikey.so` (both checked against `SHA256SUMS`), the module into the directory
that holds `pam_unix.so`, through `sudo` when needed. At run time it needs `libpam0g`, `libpcsclite1` and a running `pcscd`.
**It does not enable the module**: nothing in `/etc/pam.d` is changed. Continue with *Enrol*, *Test first, safely* and *Safe rollout
rules* below. `sh -s -- --uninstall --pam` removes the module again but refuses while a service file still names it; all options are in
[RELEASES.md](RELEASES.md#install-script).

## Build

On Linux with `libpam0g-dev` and `libpcsclite-dev` (Debian/Ubuntu names) and `pcscd` running:

```sh
cd host
cargo build --release -p multikey-pam
```

The artifact is `target/release/libpam_multikey.so`; PAM expects the name `pam_multikey.so`. Install it:

```sh
sudo install -o root -g root -m 0644 target/release/libpam_multikey.so /lib/security/pam_multikey.so
```

Use your distribution's PAM module directory (`/lib/security`, `/lib64/security`, `/usr/lib/x86_64-linux-gnu/security`).
`multikey-pam` is deliberately not in the workspace `default-members`, so plain `cargo test` on other OSes never links
libpam; run `cargo test -p multikey-pam` for the logic tests.

## Enrol

```sh
multikey readers
sudo multikey mkauth enroll --user alice   # creates the key, sets the MKAUTH PIN, asks before writing the trust store
multikey mkauth list                       # /etc/multikey/trusted.toml, keep it root-owned, mode 0644 or stricter
```

The trust store must be writable only by root: anyone who can edit it can trust their own key.

## Module arguments

| Argument | Meaning |
|---|---|
| `trust_store=/path` | Trust store file (default `/etc/multikey/trusted.toml`) |
| `timeout=N` | Bound on the authenticate call, seconds, 1–60 (default 20) |
| `debug` | Debug lines to syslog (`LOG_AUTHPRIV`); never includes nonces, signatures or keys |

## Test first, safely

`sudo tools/pam_test.sh --i-understand` creates a throw-away service `/etc/pam.d/multikey-test` (only
`auth sufficient pam_multikey.so …` and `auth required pam_deny.so`), runs `pamtester multikey-test $USER authenticate`
and removes the file on exit. It never edits login, sudo, sshd or system-auth. Pending hardware: not yet run.

## Failure semantics

| Situation | PAM result | Effect |
|---|---|---|
| Valid signature, trusted key and device id match | `PAM_SUCCESS` | `sufficient` ends the stack with success |
| Empty user name / user not obtainable | `PAM_USER_UNKNOWN` | next module |
| No entry for the user in the trust store, store missing/unreadable/invalid | `PAM_AUTHINFO_UNAVAIL` | falls through to the password line |
| No pcscd, no reader, key unplugged or removed mid-auth, applet missing, device not enrolled | `PAM_AUTHINFO_UNAVAIL` | falls through |
| No button press (device `6300`) or timeout | `PAM_AUTHINFO_UNAVAIL` | falls through |
| Signature invalid, device key/id differs from the trusted entry | `PAM_AUTH_ERR` | not success; `sufficient` still falls through, `required` fails |
| Any panic in the module | `PAM_AUTHINFO_UNAVAIL` | falls through |

The module never returns a hard failure for environmental problems, so the password path keeps working without the key.
`pam_sm_setcred` returns `PAM_SUCCESS`; `pam_sm_acct_mgmt` and `pam_sm_chauthtok` return `PAM_IGNORE`.

## Stacking and threat notes

- **`sufficient` makes the key a single-factor replacement for the password.** The challenge needs only possession
  plus a button press; there is no PIN or biometric. Anyone holding the key, including someone who finds it, can
  authenticate as the enrolled user (a person at the keyboard also needs the physical key, but nothing else).
- Two-factor stack (password **and** key):
  ```
  auth required pam_unix.so
  auth required pam_multikey.so
  ```
  Here a missing key (`PAM_AUTHINFO_UNAVAIL`) denies login, so keep a recovery path (below) and do not use this on the
  only account of a machine you cannot reach otherwise.
- Convenience stack (key alone is enough, password still works): `auth sufficient pam_multikey.so` placed **above** the
  password line, only after a successful `pam_test.sh` run.
- The module is only as strong as the trust store and the firmware (ESP32-S3 is not a secure element; see
  [SECURITY.md](SECURITY.md)). No replay state is kept on the device; freshness comes from the host nonce.
- A malicious process running as the same user can request a challenge while the user presses the button for
  something else. Button presses are not bound to a purpose.

## Safe rollout rules

1. Open a **root shell and leave it open** (and a second one) before changing any file in `/etc/pam.d/`.
2. Run `sudo tools/pam_test.sh --i-understand` and confirm both a success (key plugged, button pressed) and a fall-through
   (key unplugged).
3. Only then add the line to one service, never first to `login`/`sudo` of a machine you cannot recover. Prefer a VM or
   a spare machine; test `sudo` from the open root shell's neighbour terminal.
4. Keep the password line below it.

## Recovery

If a login is broken: use the still-open root shell, or boot to a recovery/single-user shell (or a live USB, mount the
root filesystem) and delete the `pam_multikey.so` line from the affected file in `/etc/pam.d/`. Nothing else is
modified by this project; the module stores no state outside the trust store.
