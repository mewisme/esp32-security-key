#!/usr/bin/env python3
"""Sign and verify a release's firmware-manifest.json with Ed25519 (docs/RELEASE_SIGNING.md).

  keygen                         print a new key pair (seed and public key, base64) to stdout; nothing is written
  public                         print the public key (base64) of the key in $MULTIKEYS_SIGNING_KEY
  sign MANIFEST [--key-id ID]    write MANIFEST.sig, signed with the 32-byte seed (base64) in $MULTIKEYS_SIGNING_KEY
  verify MANIFEST SIG --public B64   check a signature file against a public key

The private key is only ever read from the environment variable and is never written to disk by this tool. The
signature file is the format the site verifies (web/src/lib/firmware/signature.ts): JSON
{"v":1,"alg":"ed25519","key_id":...,"manifest_sha256":...,"sig":...} over the manifest's exact bytes.
Requires the `cryptography` package (tools/requirements.txt).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

ENV = "MULTIKEYS_SIGNING_KEY"


def _raw_public(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def _private_from_env() -> Ed25519PrivateKey:
    seed_b64 = os.environ.get(ENV, "").strip()
    if not seed_b64:
        raise SystemExit(f"{ENV} is not set; refusing to sign without the maintainer's key")
    try:
        seed = base64.b64decode(seed_b64, validate=True)
    except ValueError as e:
        raise SystemExit(f"{ENV} is not base64: {e}") from None
    if len(seed) != 32:
        raise SystemExit(f"{ENV} must be 32 bytes of base64 (an Ed25519 seed), got {len(seed)}")
    return Ed25519PrivateKey.from_private_bytes(seed)


def sign_bytes(manifest: bytes, key: Ed25519PrivateKey, key_id: str) -> str:
    """The signature file text for `manifest`."""
    doc = {
        "v": 1,
        "alg": "ed25519",
        "key_id": key_id,
        "manifest_sha256": hashlib.sha256(manifest).hexdigest(),
        "sig": base64.b64encode(key.sign(manifest)).decode("ascii"),
    }
    return json.dumps(doc, indent=2) + "\n"


def verify_bytes(manifest: bytes, sig_text: str, public_b64: str) -> str | None:
    """None when valid, otherwise why not."""
    try:
        doc = json.loads(sig_text)
        if doc.get("v") != 1 or doc.get("alg") != "ed25519":
            return "unsupported signature format or algorithm"
        if doc["manifest_sha256"] != hashlib.sha256(manifest).hexdigest():
            return "the signature was made for a different manifest"
        Ed25519PublicKey.from_public_bytes(base64.b64decode(public_b64, validate=True)).verify(
            base64.b64decode(doc["sig"], validate=True), manifest)
    except InvalidSignature:
        return "the signature does not match the manifest"
    except (ValueError, KeyError, TypeError) as e:
        return f"malformed signature file: {e}"
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("keygen")
    sub.add_parser("public")
    s = sub.add_parser("sign")
    s.add_argument("manifest", type=Path)
    s.add_argument("--key-id", required=True, help="the id the site lists in web/src/lib/firmware/release-keys.ts")
    v = sub.add_parser("verify")
    v.add_argument("manifest", type=Path)
    v.add_argument("sig", type=Path)
    v.add_argument("--public", required=True, help="base64 raw Ed25519 public key")
    args = ap.parse_args(argv)

    if args.cmd == "keygen":
        key = Ed25519PrivateKey.generate()
        seed = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        print(json.dumps({"seed_base64": base64.b64encode(seed).decode(), "public_base64": base64.b64encode(_raw_public(key)).decode()}, indent=2))
        print("Store the seed in the release secret store only; it is shown once and never written by this tool.", file=sys.stderr)
        return 0
    if args.cmd == "public":
        print(base64.b64encode(_raw_public(_private_from_env())).decode())
        return 0
    if args.cmd == "sign":
        manifest = args.manifest.read_bytes()
        out = args.manifest.with_name(args.manifest.name + ".sig")
        out.write_text(sign_bytes(manifest, _private_from_env(), args.key_id), encoding="utf-8")
        print(f"wrote {out}")
        return 0
    problem = verify_bytes(args.manifest.read_bytes(), args.sig.read_text(encoding="utf-8"), args.public)
    if problem:
        print(f"INVALID: {problem}", file=sys.stderr)
        return 1
    print("valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
