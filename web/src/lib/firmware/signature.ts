// Authenticates a release's firmware-manifest.json against public keys built into the site (release-keys.ts).
//
// The manifest's SHA-256 values only prove that the zip files match the manifest; they say nothing about who wrote the
// manifest. A detached Ed25519 signature over the manifest's exact bytes does, provided the verifying key does not come
// from the same place as the manifest. Format (`firmware-manifest.json.sig`, JSON, format version 1):
//   { "v": 1, "alg": "ed25519", "key_id": "<id in release-keys.ts>", "manifest_sha256": "<hex>", "sig": "<base64>" }
// `sig` signs the manifest bytes as served (not a re-serialisation). An unknown `v` or `alg` is refused, so a future
// format is never read as this one.
import { FirmwareError } from "../errors/firmware-error";
import { sha256Hex } from "./download";
import { RELEASE_KEYS, type ReleaseKey, SIGNATURE_REQUIRED_FROM } from "./release-keys";
import { compareSemver } from "./version";

/** `signed`: valid signature by a trusted key. `unsigned`: a release from before signing, shown as not authenticated. */
export type Authentication = { status: "signed"; keyId: string } | { status: "unsigned" };

/** Why a release is refused: no signature where one is required, a bad or mismatched one, a key we do not trust, or no way to check. */
export type SignatureFailure = "missing" | "malformed" | "mismatched" | "invalid" | "unknown-key" | "unsupported-browser";

export class SignatureError extends FirmwareError {
  constructor(
    readonly state: SignatureFailure,
    detail: string,
  ) {
    super("manifest-invalid", `signature ${state}: ${detail}`);
  }
}

const b64 = (s: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

interface Envelope {
  keyId: string;
  manifestSha256: string;
  sig: Uint8Array;
}

function parseEnvelope(bytes: Uint8Array): Envelope {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SignatureError("malformed", "the signature file is not JSON");
  }
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (o.v !== 1 || o.alg !== "ed25519") throw new SignatureError("malformed", "unsupported signature format or algorithm");
  if (typeof o.key_id !== "string" || typeof o.manifest_sha256 !== "string" || typeof o.sig !== "string") {
    throw new SignatureError("malformed", "the signature file is missing a field");
  }
  const sig = b64(o.sig);
  if (!sig || sig.length !== 64) throw new SignatureError("malformed", "the signature is not 64 bytes of base64");
  return { keyId: o.key_id, manifestSha256: o.manifest_sha256.toLowerCase(), sig };
}

/**
 * Checks a manifest against its signature file. `signature` is null when the release has none (HTTP 404).
 * Returns the authentication state, or throws a SignatureError for every case that must not be trusted.
 */
export async function authenticateManifest(
  input: { tag: string; manifest: Uint8Array; signature: Uint8Array | null },
  keys: readonly ReleaseKey[] = RELEASE_KEYS,
  requiredFrom: string | null = SIGNATURE_REQUIRED_FROM,
): Promise<Authentication> {
  if (input.signature === null) {
    const must = requiredFrom !== null && (compareSemver(input.tag.replace(/^v/, ""), requiredFrom) ?? 1) >= 0;
    if (must) throw new SignatureError("missing", `releases from ${requiredFrom} on must be signed`);
    return { status: "unsigned" };
  }
  const env = parseEnvelope(input.signature);
  const key = keys.find((k) => k.id === env.keyId);
  if (!key) throw new SignatureError("unknown-key", `the key ${env.keyId} is not one this site trusts`);
  if ((await sha256Hex(input.manifest)) !== env.manifestSha256) {
    throw new SignatureError("mismatched", "the signature was made for a different manifest");
  }
  const raw = b64(key.publicKey);
  let verified: boolean;
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, { name: "Ed25519" }, false, ["verify"]);
    verified = await crypto.subtle.verify({ name: "Ed25519" }, cryptoKey, env.sig as Uint8Array<ArrayBuffer>, input.manifest as Uint8Array<ArrayBuffer>);
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotSupportedError") {
      throw new SignatureError("unsupported-browser", "this browser cannot verify Ed25519 signatures");
    }
    throw new SignatureError("invalid", e instanceof Error ? e.message : String(e));
  }
  if (!verified) throw new SignatureError("invalid", "the signature does not match the manifest");
  return { status: "signed", keyId: key.id };
}
