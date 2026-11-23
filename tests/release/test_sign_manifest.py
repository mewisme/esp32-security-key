import base64
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
try:
    import sign_manifest as sm
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    HAVE = True
except ImportError:  # the CI job installs cryptography; a bare local python may not have it
    HAVE = False

VECTOR = json.loads((ROOT / "tests" / "vectors" / "manifest_signature.json").read_text(encoding="utf-8"))


@unittest.skipUnless(HAVE, "cryptography is not installed")
class SignManifest(unittest.TestCase):
    def key(self):
        return Ed25519PrivateKey.from_private_bytes(base64.b64decode(VECTOR["seed_base64"]))

    def test_vector_is_what_the_tool_produces(self):
        sig = sm.sign_bytes(VECTOR["manifest"].encode(), self.key(), VECTOR["key_id"])
        self.assertEqual(sig, VECTOR["signature_file"])
        self.assertIsNone(sm.verify_bytes(VECTOR["manifest"].encode(), sig, VECTOR["public_base64"]))

    def test_altered_manifest_or_wrong_key_is_invalid(self):
        sig = VECTOR["signature_file"]
        self.assertIn("different manifest", sm.verify_bytes(VECTOR["manifest"].encode() + b" ", sig, VECTOR["public_base64"]))
        other = base64.b64encode(sm._raw_public(Ed25519PrivateKey.generate())).decode()
        self.assertIn("does not match", sm.verify_bytes(VECTOR["manifest"].encode(), sig, other))
        self.assertIn("malformed", sm.verify_bytes(VECTOR["manifest"].encode(), "not json", VECTOR["public_base64"]))

    def test_sign_needs_the_key_from_the_environment_and_writes_only_the_signature(self):
        with tempfile.TemporaryDirectory() as d:
            m = Path(d) / "firmware-manifest.json"
            m.write_bytes(VECTOR["manifest"].encode())
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop(sm.ENV, None)
                with self.assertRaises(SystemExit):
                    sm.main(["sign", str(m), "--key-id", "k"])
            self.assertEqual(os.listdir(d), ["firmware-manifest.json"])
            with mock.patch.dict(os.environ, {sm.ENV: VECTOR["seed_base64"]}):
                self.assertEqual(sm.main(["sign", str(m), "--key-id", VECTOR["key_id"]]), 0)
            self.assertEqual(sorted(os.listdir(d)), ["firmware-manifest.json", "firmware-manifest.json.sig"])
            self.assertEqual((Path(d) / "firmware-manifest.json.sig").read_text(encoding="utf-8"), VECTOR["signature_file"])

    def test_a_short_seed_is_refused(self):
        with mock.patch.dict(os.environ, {sm.ENV: base64.b64encode(b"short").decode()}):
            with self.assertRaises(SystemExit):
                sm.main(["public"])


if __name__ == "__main__":
    unittest.main()
