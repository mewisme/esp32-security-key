# MultiKeys host tools (Rust)

Prebuilt `multikey` archives for Windows and Linux and the PAM module are on
[GitHub Releases](https://github.com/mewisme/esp32-security-key/releases) (from v0.2.0 next to the prebuilt firmware; install
firmware from the browser at https://multikeys.mewis.me). Build from source as below.

Crates:
- `multikey-proto` — MKAUTH v1 APDUs, parsers, transcript, P-256 verification. No I/O.
- `multikey-fido` — FIDO2 management (GetInfo, PIN, credential management) over USB HID via `ctap-hid-fido2` (pinned `=3.6.1`), behind an `Authenticator` trait with a mock.
- `multikey-host` — PC/SC transport (`pcsc`), `Device` operations, trust store, device inventory (feature `inventory`, used by the CLI; the PAM module does not link HID code).
- `multikey-cli` — the `multikey` binary.
- `multikey-pam` — the Linux PAM module `pam_multikey.so` (not in the default workspace members; links libpam on Linux only; see [docs/LINUX_PAM.md](../docs/LINUX_PAM.md)).

Spec: `docs/PROTOCOLS.md` ("MKAUTH v1"). Unit tests run against an in-memory mock device that signs with a public, TEST-ONLY key
(`multikey-proto` feature `test-key`); the commands were also run against a real key on one board (Windows 11), see
[docs/ROADMAP.md](../docs/ROADMAP.md) and `docs/hw-reports/`.

```
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

Linux needs `libpcsclite-dev` and `libudev-dev` to build (the HID transport links libudev) and `libpcsclite1`, `libudev1` and `pcscd` at runtime; Windows uses winscard.

## Trust store
Default `/etc/multikey/trusted.toml` (Linux), `%ProgramData%\MultiKeys\trusted.toml` (Windows) (tools up to 0.1.0 used `%ProgramData%\MultiKey\trusted.toml`; if only that file exists it is still used); override with `--trust-store`.
Keep it writable by root/Administrators only.

```toml
[[key]]
user = "alice"
pubkey_hex = "04…"      # 130 hex chars, uncompressed P-256 point
device_id_hex = "…"     # 32 hex chars
```
Duplicate users, bad hex lengths, a missing `04` prefix and unknown fields are rejected.

## CLI
`multikey device list | info | status | version`, `multikey fido info | pin status | pin set | pin change | credentials list | delete`,
`multikey mkauth status | enroll | auth | list | revoke`, `multikey device show | rename | reset-name | reenumerate`, `multikey readers`.
Read-only commands accept `--json`. Selection flags: `--device N`, `--reader TEXT`, `--hid-path PATH`. Full reference, exit codes
and the Windows elevation rule for FIDO HID: [docs/CLI.md](../docs/CLI.md). The old top-level `status|enroll|auth|list|revoke` still work (hidden aliases).

Rust 1.89 or newer is required (`rust-version`), because of the pinned `ctap-hid-fido2`.
