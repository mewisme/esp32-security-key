import { describe, expect, it } from "vitest";
import { parseAuthData } from "@/lib/passkey/authdata";
import { concat, sha256, toBase64Url } from "@/lib/passkey/bytes";
import { decodeCbor } from "@/lib/passkey/cbor";
import { classifyWebAuthnError, LabVerificationError } from "@/lib/passkey/lab";
import { checkClientData, checkRpIdHash, derToRaw, importCoseEs256, UnsupportedAlgError, verifyAssertion } from "@/lib/passkey/verify";

// A tiny CBOR encoder, enough to build what an authenticator sends.
function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  return [(major << 5) | 25, n >> 8, n & 0xff];
}
const uint = (n: number) => Uint8Array.from(head(0, n));
const nint = (n: number) => Uint8Array.from(head(1, -1 - n));
const bstr = (b: Uint8Array) => concat(Uint8Array.from(head(2, b.length)), b);
const tstr = (s: string) => {
  const b = new TextEncoder().encode(s);
  return concat(Uint8Array.from(head(3, b.length)), b);
};
const map = (...pairs: Uint8Array[]) => concat(Uint8Array.from(head(5, pairs.length / 2)), ...pairs);

async function makeKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { pair, x: raw.slice(1, 33), y: raw.slice(33) };
}

const cose = (x: Uint8Array, y: Uint8Array, alg = -7) => map(uint(1), uint(2), uint(3), nint(alg), nint(-1), uint(1), nint(-2), bstr(x), nint(-3), bstr(y));

function toDer(raw: Uint8Array): Uint8Array {
  const int = (v: Uint8Array) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    const body = v.subarray(i);
    const padded = body[0]! & 0x80 ? concat(Uint8Array.of(0), body) : body;
    return concat(Uint8Array.of(0x02, padded.length), padded);
  };
  const body = concat(int(raw.subarray(0, 32)), int(raw.subarray(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

describe("decodeCbor", () => {
  it("reads an attestation object built by hand", async () => {
    const { x, y } = await makeKey();
    const aaguid = new Uint8Array(16).fill(0xab);
    const credId = Uint8Array.of(1, 2, 3, 4);
    const authData = concat(await sha256("example.test"), Uint8Array.of(0x45, 0, 0, 0, 7), aaguid, Uint8Array.of(0, 4), credId, cose(x, y));
    const object = map(tstr("fmt"), tstr("none"), tstr("attStmt"), map(), tstr("authData"), bstr(authData));

    const decoded = decodeCbor(object);
    expect(decoded).toBeInstanceOf(Map);
    const m = decoded as Map<unknown, unknown>;
    expect(m.get("fmt")).toBe("none");
    expect((m.get("attStmt") as Map<unknown, unknown>).size).toBe(0);
    expect(m.get("authData")).toEqual(authData);

    const parsed = parseAuthData(m.get("authData") as Uint8Array);
    expect(parsed.aaguid).toBe("abababab-abab-abab-abab-abababababab");
    expect(parsed.credentialId).toEqual(credId);
    expect(parsed.signCount).toBe(7);
    expect(parsed.cosePublicKey?.get(-2)).toEqual(x);
  });

  it("reads negative integers and rejects unsupported or truncated input", () => {
    expect(decodeCbor(nint(-8))).toBe(-8);
    expect(() => decodeCbor(Uint8Array.of(0xf5))).toThrow("cbor"); // simple value `true`
    expect(() => decodeCbor(Uint8Array.of(0x58, 5, 1, 2))).toThrow("cbor"); // bytes cut short
    expect(() => decodeCbor(Uint8Array.of(0x00, 0x00))).toThrow("cbor"); // trailing bytes
    expect(() => decodeCbor(Uint8Array.of(0x9f))).toThrow("cbor"); // indefinite length
  });
});

describe("parseAuthData", () => {
  it("reads the flag byte 0x45 as UP, UV and AT", async () => {
    const { x, y } = await makeKey();
    const data = concat(await sha256("example.test"), Uint8Array.of(0x45, 0, 0, 0, 0), new Uint8Array(16), Uint8Array.of(0, 1, 9), cose(x, y));
    expect(parseAuthData(data).flags).toEqual({ up: true, uv: true, be: false, bs: false, at: true, ed: false });
  });

  it("reads backup flags and the counter without credential data", async () => {
    const data = concat(await sha256("example.test"), Uint8Array.of(0x19, 0, 0, 1, 2));
    const parsed = parseAuthData(data);
    expect(parsed.flags).toMatchObject({ up: true, be: true, bs: true, at: false });
    expect(parsed.signCount).toBe(258);
    expect(parsed.credentialId).toBeUndefined();
  });
});

describe("importCoseEs256", () => {
  it("accepts ES256 and refuses other algorithms", async () => {
    const { x, y } = await makeKey();
    await expect(importCoseEs256(decodeCbor(cose(x, y)) as Map<number, unknown>)).resolves.toBeDefined();
    await expect(importCoseEs256(decodeCbor(cose(x, y, -8)) as Map<number, unknown>)).rejects.toBeInstanceOf(UnsupportedAlgError);
  });
});

describe("verifyAssertion", () => {
  async function signed() {
    const { pair, x, y } = await makeKey();
    const authData = concat(await sha256("example.test"), Uint8Array.of(0x01, 0, 0, 0, 1));
    const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: "abc", origin: "https://example.test" }));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, concat(authData, await sha256(clientData))));
    const pub = await importCoseEs256(decodeCbor(cose(x, y)) as Map<number, unknown>);
    return { pub, authData, clientData, raw };
  }

  it("accepts a DER signature from WebCrypto and rejects a flipped authData byte", async () => {
    const { pub, authData, clientData, raw } = await signed();
    expect(await verifyAssertion(pub, authData, clientData, toDer(raw))).toBe(true);
    const flipped = authData.slice();
    flipped[36] = flipped[36]! ^ 1;
    expect(await verifyAssertion(pub, flipped, clientData, toDer(raw))).toBe(false);
  });

  it("treats a malformed signature as invalid", async () => {
    const { pub, authData, clientData } = await signed();
    expect(await verifyAssertion(pub, authData, clientData, Uint8Array.of(1, 2, 3))).toBe(false);
  });

  it("converts DER integers with and without a leading zero to 32 bytes each", () => {
    const r = new Uint8Array(32).fill(0xff);
    const s = new Uint8Array(32);
    s[31] = 5;
    expect(derToRaw(toDer(concat(r, s)))).toEqual(concat(r, s));
  });
});

describe("checkClientData", () => {
  const challenge = Uint8Array.of(1, 2, 3, 4);
  const json = (over: Record<string, unknown>) =>
    new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: toBase64Url(challenge), origin: "https://example.test", ...over }));
  const expected = { type: "webauthn.get", challenge, origin: "https://example.test" } as const;

  it("accepts matching client data", () => {
    expect(checkClientData(json({}), expected)).toEqual({ ok: true });
  });

  it("names the field that is wrong", () => {
    expect(checkClientData(json({ challenge: "AAAA" }), expected)).toEqual({ ok: false, problem: "challenge" });
    expect(checkClientData(json({ type: "webauthn.create" }), expected)).toEqual({ ok: false, problem: "type" });
    expect(checkClientData(json({ origin: "https://evil.test" }), expected)).toEqual({ ok: false, problem: "origin" });
  });
});

describe("checkRpIdHash", () => {
  it("compares against the SHA-256 of the RP ID", async () => {
    const data = parseAuthData(concat(await sha256("example.test"), Uint8Array.of(0x01, 0, 0, 0, 0)));
    expect(await checkRpIdHash(data, "example.test")).toBe(true);
    expect(await checkRpIdHash(data, "other.test")).toBe(false);
  });
});

describe("classifyWebAuthnError", () => {
  it("maps DOMException names to the lab's error ids", () => {
    expect(classifyWebAuthnError(new DOMException("x", "NotAllowedError"))).toBe("cancelledOrTimeout");
    expect(classifyWebAuthnError(new DOMException("x", "InvalidStateError"))).toBe("alreadyRegistered");
    expect(classifyWebAuthnError(new DOMException("x", "NotSupportedError"))).toBe("notSupported");
    expect(classifyWebAuthnError(new DOMException("x", "SecurityError"))).toBe("security");
    expect(classifyWebAuthnError(new LabVerificationError("x"))).toBe("verification");
    expect(classifyWebAuthnError(new UnsupportedAlgError())).toBe("verification");
  });
});
