import { beforeAll, describe, expect, it } from "vitest";
import { fetchCatalog } from "@/lib/firmware/catalog";
import { sha256Hex } from "@/lib/firmware/download";
import type { ReleaseKey } from "@/lib/firmware/release-keys";
import { authenticateManifest, SignatureError, type SignatureFailure } from "@/lib/firmware/signature";
import vector from "../../../tests/vectors/manifest_signature.json" with { type: "json" };
import { makeFirmware } from "../fixtures/firmware";

// A throwaway key made here for the test; the site's real key list is empty until the maintainer provisions one.
let keys: ReleaseKey[];
let other: CryptoKeyPair;
let pair: CryptoKeyPair;

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : b)));
const bytes = (s: string) => new TextEncoder().encode(s);

async function generate(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
}

async function sign(manifest: Uint8Array, signer: CryptoKeyPair, over: Record<string, unknown> = {}): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, signer.privateKey, manifest as Uint8Array<ArrayBuffer>);
  return bytes(JSON.stringify({ v: 1, alg: "ed25519", key_id: "test-key", manifest_sha256: await sha256Hex(manifest), sig: b64(sig), ...over }));
}

beforeAll(async () => {
  pair = await generate();
  other = await generate();
  keys = [{ id: "test-key", publicKey: b64(await crypto.subtle.exportKey("raw", pair.publicKey)) }];
});

async function failure(tag: string, manifest: Uint8Array, signature: Uint8Array | null, requiredFrom: string | null = null): Promise<SignatureFailure> {
  try {
    await authenticateManifest({ tag, manifest, signature }, keys, requiredFrom);
  } catch (e) {
    if (e instanceof SignatureError) return e.state;
    throw e;
  }
  throw new Error("expected a signature failure");
}

describe("authenticateManifest", () => {
  const manifest = bytes('{"schema_version":2,"tag":"v0.4.0"}');

  it("accepts a valid signature by a trusted key", async () => {
    expect(await authenticateManifest({ tag: "v0.4.0", manifest, signature: await sign(manifest, pair) }, keys, null)).toEqual({ status: "signed", keyId: "test-key" });
  });

  it("marks a release with no signature as unsigned while none is required", async () => {
    expect(await authenticateManifest({ tag: "v0.3.3", manifest, signature: null }, keys, "0.4.0")).toEqual({ status: "unsigned" });
    expect(await authenticateManifest({ tag: "v0.4.0", manifest, signature: null }, keys, null)).toEqual({ status: "unsigned" });
  });

  it("refuses a missing signature from the first signed version on (stripping it must not downgrade a release)", async () => {
    expect(await failure("v0.4.0", manifest, null, "0.4.0")).toBe("missing");
    expect(await failure("v0.5.1", manifest, null, "0.4.0")).toBe("missing");
    expect(await failure("v0.4.0-rc.1", manifest, null, "0.4.0-rc.1")).toBe("missing");
    expect(await failure("not-a-version", manifest, null, "0.4.0")).toBe("missing");
  });

  it("refuses an altered manifest", async () => {
    const signature = await sign(manifest, pair);
    expect(await failure("v0.4.0", bytes('{"schema_version":2,"tag":"v0.4.1"}'), signature)).toBe("mismatched");
  });

  it("refuses a bad signature even when the hash field is right", async () => {
    const forged = await sign(manifest, other); // made by a key the site does not hold, claiming to be test-key
    expect(await failure("v0.4.0", manifest, forged)).toBe("invalid");
    const flipped = JSON.parse(new TextDecoder().decode(await sign(manifest, pair))) as { sig: string };
    const raw = Uint8Array.from(atob(flipped.sig), (c) => c.charCodeAt(0));
    raw[0] = raw[0]! ^ 1;
    expect(await failure("v0.4.0", manifest, await sign(manifest, pair, { sig: b64(raw) }))).toBe("invalid");
  });

  it("refuses a signature by a key the site does not trust, including when the list is empty", async () => {
    const signature = await sign(manifest, pair, { key_id: "someone-else" });
    expect(await failure("v0.4.0", manifest, signature)).toBe("unknown-key");
    await expect(authenticateManifest({ tag: "v0.4.0", manifest, signature: await sign(manifest, pair) }, [], null)).rejects.toMatchObject({ state: "unknown-key" });
  });

  it("refuses a signature file it cannot read or a format it does not know", async () => {
    for (const bad of [bytes("not json"), bytes("[]"), bytes(JSON.stringify({ v: 2, alg: "ed25519", key_id: "test-key", manifest_sha256: "", sig: "" })),
      bytes(JSON.stringify({ v: 1, alg: "rsa", key_id: "test-key", manifest_sha256: "", sig: "" })),
      bytes(JSON.stringify({ v: 1, alg: "ed25519", key_id: "test-key", manifest_sha256: "ab", sig: "AAAA" })),
      bytes(JSON.stringify({ v: 1, alg: "ed25519", key_id: "test-key", sig: "AAAA" })),
      bytes("<!doctype html><html></html>")]) {
      expect(await failure("v0.4.0", manifest, bad)).toBe("malformed");
    }
  });
});

describe("a signature made by tools/sign_manifest.py", () => {
  // tests/release/test_sign_manifest.py checks the vector is still what the tool produces; this checks the site accepts it.
  const trusted: ReleaseKey[] = [{ id: vector.key_id, publicKey: vector.public_base64 }];
  const manifest = bytes(vector.manifest);

  it("verifies in the site's verifier", async () => {
    expect(await authenticateManifest({ tag: "v9.9.9", manifest, signature: bytes(vector.signature_file) }, trusted, null)).toEqual({ status: "signed", keyId: vector.key_id });
  });

  it("stops verifying when one byte of the manifest changes", async () => {
    await expect(authenticateManifest({ tag: "v9.9.9", manifest: bytes(`${vector.manifest} `), signature: bytes(vector.signature_file) }, trusted, null)).rejects.toMatchObject({ state: "mismatched" });
  });
});

describe("fetchCatalog authentication", () => {
  async function serve(tags: string[], sigs: Record<string, "404" | "503" | Uint8Array>) {
    const fw = await makeFirmware({ version: "0.4.0", tag: "v0.4.0" });
    const manifestBytes = new TextEncoder().encode(JSON.stringify(fw.manifest));
    const fetchImpl = ((url: string) => {
      if (url === "/api/releases") return Promise.resolve(Response.json(tags.map((tag) => ({ tag, name: tag, prerelease: false, published_at: null, html_url: null }))));
      const m = /^\/api\/firmware\/(v[^/]+)\/(firmware-manifest\.json(?:\.sig)?)$/.exec(url);
      if (!m) return Promise.reject(new Error(`unexpected ${url}`));
      if (m[2] === "firmware-manifest.json") return Promise.resolve(new Response(manifestBytes));
      const s = sigs[m[1]!] ?? "404";
      if (s === "404") return Promise.resolve(new Response("{}", { status: 404 }));
      if (s === "503") return Promise.resolve(new Response("{}", { status: 503 }));
      return Promise.resolve(new Response(s as Uint8Array<ArrayBuffer>));
    }) as typeof fetch;
    return { fetchImpl, manifestBytes };
  }

  it("marks an unsigned release not authenticated and a validly signed one signed", async () => {
    const { fetchImpl, manifestBytes } = await serve(["v0.4.0"], {});
    expect((await fetchCatalog(fetchImpl, { keys, requiredFrom: null })).releases[0]?.authentication).toEqual({ status: "unsigned" });
    const signed = await serve(["v0.4.0"], { "v0.4.0": await sign(manifestBytes, pair) });
    expect((await fetchCatalog(signed.fetchImpl, { keys, requiredFrom: null })).releases[0]?.authentication).toEqual({ status: "signed", keyId: "test-key" });
  });

  it("rejects a release whose signature is invalid, unknown, or missing where required, and says why", async () => {
    const { manifestBytes } = await serve(["v0.4.0"], {});
    const forged = await serve(["v0.4.0"], { "v0.4.0": await sign(manifestBytes, other) });
    const c1 = await fetchCatalog(forged.fetchImpl, { keys, requiredFrom: null });
    expect(c1.releases).toEqual([]);
    expect(c1.rejected[0]?.detail).toContain("signature invalid");
    const unknown = await serve(["v0.4.0"], { "v0.4.0": await sign(manifestBytes, pair, { key_id: "x" }) });
    expect((await fetchCatalog(unknown.fetchImpl, { keys, requiredFrom: null })).rejected[0]?.detail).toContain("signature unknown-key");
    const missing = await serve(["v0.4.0"], {});
    const c3 = await fetchCatalog(missing.fetchImpl, { keys, requiredFrom: "0.4.0" });
    expect(c3.releases).toEqual([]);
    expect(c3.rejected[0]?.detail).toContain("signature missing");
  });

  it("refuses a release when the signature cannot be fetched (not 404) instead of treating it as unsigned", async () => {
    const down = await serve(["v0.4.0"], { "v0.4.0": "503" });
    const c = await fetchCatalog(down.fetchImpl, { keys, requiredFrom: null });
    expect(c.releases).toEqual([]);
    expect(c.rejected[0]?.detail).toContain("signature: HTTP 503");
  });

  it("with the site's own key list, a release signed by an unlisted key, or unsigned from the required version on, is refused", async () => {
    const { manifestBytes } = await serve(["v0.4.0"], {});
    const signed = await serve(["v0.4.0"], { "v0.4.0": await sign(manifestBytes, pair) });
    expect((await fetchCatalog(signed.fetchImpl)).rejected[0]?.detail).toContain("signature unknown-key");
    const unsignedNew = await serve(["v0.4.0"], {});
    expect((await fetchCatalog(unsignedNew.fetchImpl)).rejected[0]?.detail).toContain("signature missing");
  });
});
