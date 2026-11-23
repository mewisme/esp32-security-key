# Releases

A release publishes the **host tools only**. No firmware is built or published: a firmware image needs the user's own
`sdkconfig.board`, VID/PID and GPIOs, and the development AAGUID/VID are placeholders ([docs/SECURITY.md](SECURITY.md)).
Flash from source with `tools/flash-dev.ps1` ([FLASHING_ADVANCED](FLASHING_ADVANCED.md)).

## Assets (v0.1.0 as the example)

| File | Contents |
|---|---|
| `multikey-v0.1.0-windows-x86_64.zip` | `multikey.exe` (static CRT), `LICENSE`, `THIRD_PARTY_LICENSES.txt`, `README.txt` |
| `multikey-v0.1.0-linux-x86_64.tar.gz` | `multikey`, same companions; built on Ubuntu 22.04 |
| `multikey-pam-v0.1.0-linux-x86_64.tar.gz` | `pam_multikey.so` (built as `libpam_multikey.so`, renamed), same companions |
| `SHA256SUMS` | SHA-256 of the three archives |

Each archive has one root directory and exactly those four files (asserted at packaging time). Archives are deterministic: sorted entries,
`SOURCE_DATE_EPOCH` = the tagged commit's time, zero owner ids.

## Verify a download

```powershell
Get-FileHash -Algorithm SHA256 .\multikey-v0.1.0-windows-x86_64.zip   # compare with SHA256SUMS
```
```sh
sha256sum -c SHA256SUMS --ignore-missing
```

No signature is published; the checksum file lives next to the assets in the same release and therefore protects against corruption, not
against a compromised release.

## Cutting a release

1. Bump `[workspace.package].version` in `host/Cargo.toml` (all crates share it), update `host/Cargo.lock` (`cargo build --locked` must pass).
2. Add `docs/releases/vX.Y.Z.md` (the release notes; the workflow refuses a tag without it).
3. Commit and push to `main`. The `release` workflow runs on `main` (build and verify, **no publishing**); wait for it to be green.
4. `git tag -a vX.Y.Z -m "multikey X.Y.Z"` and `git push origin vX.Y.Z`. **Only with the maintainer's explicit approval.** The tag push is what publishes.

A `-suffix` in the version (`0.2.0-rc.1`) publishes a pre-release.

## What the workflow checks (`.github/workflows/release.yml`)

| Job | Gate |
|---|---|
| `meta` | release script tests; all five host crates share one version; for a tag: it is `vMAJOR.MINOR.PATCH[-suffix]`, equals that version, `docs/releases/v<version>.md` exists, and no release for it exists yet |
| `build` (3 legs: Windows x86_64, Linux x86_64, PAM Linux x86_64) | `cargo fmt --check`, `clippy -D warnings`, tests, `--locked --release` build, packaging, then **the extracted archive** is exercised: `--version` equals `multikey <version>`, `--help` of every group, Windows: no Visual C++/UCRT DLL imports (`tools/check_pe_imports.py`); Linux: `ldd` resolves; PAM: `readelf` needs `libpam.so.0`/`libpcsclite.so.1`, `nm -D` defines `pam_sm_authenticate` and `pam_sm_setcred`, `dlopen` works, and a `pamtester` run with no key fails closed (exit 1) in a throwaway `/etc/pam.d/multikey-ci` that is deleted afterwards |
| `release` | only for `v*` tags and only if all legs succeeded; the only job with `contents: write`; downloads the three artifacts, requires exactly the three expected files, writes and checks `SHA256SUMS`, then `gh release create --verify-tag` (never `--clobber`, never an upload to an existing release) |

Pull requests, pushes to `main` and manual runs (`workflow_dispatch`) never reach `release`. Run the pipeline without publishing with
`gh workflow run release.yml --ref main`.

Third-party actions are pinned by commit SHA in `release.yml` and the `flash-script` CI job. Unpinned (open item): `actions/checkout@v4`
and `dtolnay/rust-toolchain@stable` in the older `ci.yml` jobs.

## Status

The workflow ran green on `main` (all three build legs, including the extracted-artifact checks, the static-CRT check and the PAM
fail-closed smoke test; the `release` job is skipped outside tags). The first tag is `v0.1.0`; see the repository's Releases page for what
was actually published.
