# Release signing (firmware manifest authentication)

**Status: verification implemented; no release is signed and no signing key exists yet.** The release workflow does not
sign anything. Until it does, every release is shown in the installer and updater as **Not authenticated**.

## What this protects, and what it does not

`firmware-manifest.json` lists the SHA-256 of every firmware package. The web installer checks the downloaded zip files
against it. That proves the zip files match the manifest, not that the manifest is the one the maintainer published: whoever
can replace the manifest (a compromised GitHub account or release asset, the proxy in the Worker) can also replace the
hashes. A detached Ed25519 signature over the manifest, checked against a public key that ships **inside the deployed
site** (not with the release), closes that gap for releases that are signed.

It does not protect against a compromised signing key, a compromised site deployment (the key list lives in the site), or
a user who ignores the **Not authenticated** badge. The firmware images themselves are not signed; secure boot is a
separate, irreversible feature that MultiKeys does not enable.

## Format (version 1)

`firmware-manifest.json.sig`, a release asset next to the manifest:

```json
{ "v": 1, "alg": "ed25519", "key_id": "release-2026-a", "manifest_sha256": "<hex>", "sig": "<base64, 64 bytes>" }
```

`sig` signs the manifest's exact bytes as served (never a re-serialisation). The site refuses an unknown `v` or `alg`, so
a future format is never read as this one.

## What the site does

| Situation | Result |
|---|---|
| Valid signature by a key in `web/src/lib/firmware/release-keys.ts` | `Signed`, with the key id |
| No signature file (HTTP 404), release older than `SIGNATURE_REQUIRED_FROM` | `Not authenticated` (usable, clearly marked) |
| No signature file, release at or after `SIGNATURE_REQUIRED_FROM` | refused: `signature missing` |
| Signature made for another manifest (hash field differs, or the manifest was altered) | refused: `signature mismatched` |
| Signature does not verify | refused: `signature invalid` |
| `key_id` not in the site's list (including an empty list) | refused: `signature unknown-key` |
| Unreadable file, unknown format or algorithm | refused: `signature malformed` |
| Browser without WebCrypto Ed25519 and a signed release | refused: `signature unsupported-browser` |
| Signature file cannot be fetched for any reason other than 404 | refused (never treated as unsigned) |

A refused release is not offered anywhere; the reason appears under "Technical details" on the Releases page.

## One-time setup (maintainer)

1. Generate the key on a trusted machine: `python tools/sign_manifest.py keygen`. It prints the seed and the public key once
   and writes nothing. Store the **seed** only in the release secret store (a GitHub Environment secret named
   `MULTIKEYS_SIGNING_KEY`, base64 of the 32-byte seed) and in an offline backup. Never commit it, never put it in a workflow
   file or an artifact.
2. Add the **public** key to `RELEASE_KEYS` in `web/src/lib/firmware/release-keys.ts` with an id, and deploy the site first.
   A release must not be signed before the sites that verify it list the key.
3. Sign each release: `MULTIKEYS_SIGNING_KEY=<seed> python tools/sign_manifest.py sign dist/firmware-manifest.json --key-id <id>`
   and upload `firmware-manifest.json.sig` with the release assets. `python tools/sign_manifest.py verify <manifest> <sig>
   --public <base64>` checks it.
4. After the first signed release is published and verified on staging, set `SIGNATURE_REQUIRED_FROM` to that version so an
   unsigned copy can no longer stand in for it.

## Rotation and compromise

Add the new public key beside the old one, deploy, sign new releases with the new key, then remove the old key in a later
deploy once no release needs it. After a suspected key compromise remove the key at once: every release it signed becomes
`unknown-key` and is refused until it is re-signed with a new key.

## Not done (blocked on the maintainer)

- The signing key does not exist; `RELEASE_KEYS` is empty on purpose (no placeholder key is shipped).
- `.github/workflows/release.yml` does not sign or upload the `.sig` file. Adding that step needs the secret from step 1, and
  `tools/package_release.py` / the asset checks must list the new asset.
- `SIGNATURE_REQUIRED_FROM` stays `null`, so a signed release can still be replaced by an unsigned copy until step 4.
- Cross-implementation check: `tests/vectors/manifest_signature.json` (a public test seed, not a project key) is signed by
  `tools/sign_manifest.py` in `tests/release/test_sign_manifest.py` and verified by the site's verifier in
  `web/tests/unit/signature.test.ts`.
