// Authenticator data (WebAuthn level 3, section 6.1): rpIdHash, flags, signature counter and, when a credential was
// created, its AAGUID, ID and public key.
import { decodeCborPrefix } from "./cbor";

export interface AuthFlags {
  /** User present: the key was touched. */
  up: boolean;
  /** User verified: the key checked a PIN or biometric. */
  uv: boolean;
  /** Backup eligible. */
  be: boolean;
  /** Backed up. */
  bs: boolean;
  /** Attested credential data follows. */
  at: boolean;
  /** Extension data follows. */
  ed: boolean;
}

export interface AuthData {
  rpIdHash: Uint8Array;
  flags: AuthFlags;
  signCount: number;
  aaguid?: string;
  credentialId?: Uint8Array;
  cosePublicKey?: Map<number, unknown>;
}

const HEADER = 37;

function uuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseAuthData(b: Uint8Array): AuthData {
  if (b.length < HEADER) throw new Error("authdata");
  const flagByte = b[32]!;
  const flags: AuthFlags = {
    up: (flagByte & 0x01) !== 0,
    uv: (flagByte & 0x04) !== 0,
    be: (flagByte & 0x08) !== 0,
    bs: (flagByte & 0x10) !== 0,
    at: (flagByte & 0x40) !== 0,
    ed: (flagByte & 0x80) !== 0,
  };
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: AuthData = { rpIdHash: b.slice(0, 32), flags, signCount: view.getUint32(33) };
  if (!flags.at) return out;

  if (b.length < HEADER + 18) throw new Error("authdata");
  out.aaguid = uuid(b.subarray(HEADER, HEADER + 16));
  const idLength = view.getUint16(HEADER + 16);
  const idStart = HEADER + 18;
  if (b.length < idStart + idLength) throw new Error("authdata");
  out.credentialId = b.slice(idStart, idStart + idLength);
  const key = decodeCborPrefix(b.subarray(idStart + idLength)).value;
  if (!(key instanceof Map)) throw new Error("authdata");
  out.cosePublicKey = key as Map<number, unknown>;
  return out;
}
