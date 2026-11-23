// What the page can check about a WebAuthn result without a server: the client data, the RP ID hash and an ES256 signature.
import type { AuthData } from "./authdata";
import { concat, equalBytes, sha256, toBase64Url } from "./bytes";

/** The key's credential uses an algorithm this page cannot verify (it only knows ES256 on P-256). */
export class UnsupportedAlgError extends Error {
  constructor() {
    super("unsupported credential algorithm");
    this.name = "UnsupportedAlgError";
  }
}

const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;

/** Imports a COSE EC2 key (kty 2, alg -7 ES256, crv 1 P-256) as a WebCrypto verification key. */
export async function importCoseEs256(key: Map<number, unknown>): Promise<CryptoKey> {
  const x = key.get(COSE_X);
  const y = key.get(COSE_Y);
  if (
    key.get(COSE_KTY) !== 2 ||
    key.get(COSE_ALG) !== -7 ||
    key.get(COSE_CRV) !== 1 ||
    !(x instanceof Uint8Array) ||
    !(y instanceof Uint8Array) ||
    x.length !== 32 ||
    y.length !== 32
  ) {
    throw new UnsupportedAlgError();
  }
  const raw = concat(Uint8Array.of(0x04), x, y);
  return crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

/** A DER ECDSA signature (SEQUENCE of two INTEGERs) as the 64-byte r‖s that WebCrypto verifies. */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let at = 0;
  const byte = () => {
    const b = der[at++];
    if (b === undefined) throw new Error("der");
    return b;
  };
  const length = () => {
    const first = byte();
    if (first < 0x80) return first;
    if (first !== 0x81) throw new Error("der");
    return byte();
  };
  if (byte() !== 0x30) throw new Error("der");
  if (length() !== der.length - at) throw new Error("der");
  const out = new Uint8Array(64);
  for (const offset of [0, 32]) {
    if (byte() !== 0x02) throw new Error("der");
    const size = length();
    if (at + size > der.length) throw new Error("der");
    let integer = der.subarray(at, at + size);
    at += size;
    while (integer.length > 32 && integer[0] === 0) integer = integer.subarray(1);
    if (integer.length > 32) throw new Error("der");
    out.set(integer, offset + 32 - integer.length);
  }
  if (at !== der.length) throw new Error("der");
  return out;
}

/** Checks the signature over authData‖SHA-256(clientDataJSON). A malformed signature is simply invalid. */
export async function verifyAssertion(
  pub: CryptoKey,
  authData: Uint8Array<ArrayBuffer>,
  clientDataJSON: Uint8Array<ArrayBuffer>,
  derSig: Uint8Array,
): Promise<boolean> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = derToRaw(derSig);
  } catch {
    return false;
  }
  const signed = concat(authData, await sha256(clientDataJSON));
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, raw, signed);
}

export interface ExpectedClientData {
  type: "webauthn.create" | "webauthn.get";
  challenge: Uint8Array;
  origin: string;
}

export function checkClientData(json: Uint8Array, expected: ExpectedClientData): { ok: boolean; problem?: "type" | "challenge" | "origin" } {
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return { ok: false, problem: "type" };
  }
  const field = (key: string): unknown => (typeof data === "object" && data !== null && key in data ? Reflect.get(data, key) : undefined);
  if (field("type") !== expected.type) return { ok: false, problem: "type" };
  if (field("challenge") !== toBase64Url(expected.challenge)) return { ok: false, problem: "challenge" };
  if (field("origin") !== expected.origin) return { ok: false, problem: "origin" };
  return { ok: true };
}

export async function checkRpIdHash(authData: AuthData, rpId: string): Promise<boolean> {
  return equalBytes(authData.rpIdHash, await sha256(rpId));
}
