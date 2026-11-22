# MultiKey host tools (Rust)

Crates:
- `multikey-proto` — MKAUTH v1 APDUs, parsers, transcript, P-256 verification. No I/O.
- `multikey-host` — PC/SC transport (`pcsc`), `Device` operations, trust store.
- `multikey-cli` — the `multikey` binary.

Spec: `docs/PROTOCOLS.md` ("MKAUTH v1"). No hardware has been used; logic is tested against an
in-memory mock device that signs with a public, TEST-ONLY key (`multikey-proto` feature `test-key`).

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Linux needs `libpcsclite-dev` to build and `pcscd` at runtime; Windows uses winscard.

## Trust store
Default `/etc/multikey/trusted.toml` (Linux), `%ProgramData%\MultiKey\trusted.toml` (Windows); override with `--trust-store`.
Keep it writable by root/Administrators only.

```toml
[[key]]
user = "alice"
pubkey_hex = "04…"      # 130 hex chars, uncompressed P-256 point
device_id_hex = "…"     # 32 hex chars
```
Duplicate users, bad hex lengths, a missing `04` prefix and unknown fields are rejected.

## CLI
`multikey readers | status | enroll --user U [--yes] | auth --user U | list | revoke --user U`
(`--reader`, `--trust-store` where applicable). The PIN is read without echo.

Exit codes: 0 ok · 1 failure · 2 usage · 3 no device / PC/SC unavailable · 4 user-presence timeout.
