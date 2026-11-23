// Live events of the key: what pico-fido's `event_send` pushes while a passkey operation runs. They arrive as CCID_EVENT
// (0x7F) messages on the vendor-class interface that WebCcid already reads; this module decodes the payload, the bytes
// after the 10-byte CCID header (host/multikey-proto/src/events.rs is the Rust twin and tests/unit/key-events.test.ts
// decodes the same frames):
//
//   op (1) | result (1) | total length (1) | { type (1) | len (1) | value }...
//
// Text fields are what the relying party sent: they can be cut short by the firmware and can end inside a UTF-8
// sequence, and they are untrusted. Control and bidirectional-formatting characters become U+FFFD.

export type KeyEventOp = "make-credential" | "get-assertion" | "user-presence" | "other";
export type KeyEventResult = "pending" | "ok" | "error" | "other";

export interface KeyEvent {
  op: KeyEventOp;
  result: KeyEventResult;
  /** Relying party id, e.g. `github.com`. */
  rpId?: string;
  userName?: string;
  userDisplayName?: string;
  /** COSE algorithm identifier of a new credential. */
  algorithm?: number;
  /** WebAuthn authenticator-data flags (UP 0x01, UV 0x04, BE 0x08, BS 0x10, AT 0x40, ED 0x80). */
  authFlags?: number;
  /** CTAP2 status code of a failed operation. */
  error?: number;
  /** Credentials that matched a sign-in request. */
  credentialCount?: number;
  /** For a button wait: the operation that needs the press. */
  operation?: KeyEventOp;
}

const OPS: Record<number, KeyEventOp> = { 1: "make-credential", 2: "get-assertion", 3: "user-presence" };
const RESULTS: Record<number, KeyEventResult> = { 0: "pending", 1: "ok", 2: "error" };

/** The `bMessageType` of an event message. */
export const CCID_EVENT = 0x7f;

const unsafe = (c: number) =>
  c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x200e || c === 0x200f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);

/** Lossy UTF-8 with control and bidirectional-formatting characters replaced, so a site cannot spoof the display. */
export function sanitizeText(bytes: Uint8Array): string {
  return Array.from(new TextDecoder().decode(bytes), (ch) => (unsafe(ch.codePointAt(0) as number) ? "\ufffd" : ch)).join("");
}

/** Decodes one event payload; throws on a malformed one. Unknown fields are skipped. */
export function parseKeyEvent(payload: Uint8Array): KeyEvent {
  if (payload.length < 3 || payload[2] !== payload.length) throw new Error(`malformed key event (${payload.length} bytes)`);
  const ev: KeyEvent = { op: OPS[payload[0] as number] ?? "other", result: RESULTS[payload[1] as number] ?? "other" };
  const one = (v: Uint8Array) => {
    if (v.length !== 1) throw new Error("key event field has the wrong length");
    return v[0] as number;
  };
  let rest = payload.subarray(3);
  while (rest.length > 0) {
    if (rest.length < 2 || rest.length < 2 + (rest[1] as number)) throw new Error("truncated key event field");
    const tag = rest[0] as number;
    const v = rest.subarray(2, 2 + (rest[1] as number));
    rest = rest.subarray(2 + (rest[1] as number));
    switch (tag) {
      case 1:
        ev.rpId = sanitizeText(v);
        break;
      case 2:
        ev.userName = sanitizeText(v);
        break;
      case 3:
        ev.userDisplayName = sanitizeText(v);
        break;
      case 4:
        if (v.length !== 4) throw new Error("key event field has the wrong length");
        ev.algorithm = ((v[0] as number) << 24) | ((v[1] as number) << 16) | ((v[2] as number) << 8) | (v[3] as number);
        break;
      case 5:
        ev.authFlags = one(v);
        break;
      case 6:
        ev.error = one(v);
        break;
      case 7:
        ev.credentialCount = one(v);
        break;
      case 8:
        ev.operation = OPS[one(v)] ?? "other";
        break;
      default:
        break; // a field from a newer firmware
    }
  }
  return ev;
}

export const userPresent = (e: KeyEvent) => (e.authFlags === undefined ? undefined : (e.authFlags & 0x01) !== 0);
export const userVerified = (e: KeyEvent) => (e.authFlags === undefined ? undefined : (e.authFlags & 0x04) !== 0);

const ALGORITHMS: Record<number, string> = { [-7]: "ES256", [-8]: "EdDSA", [-35]: "ES384", [-36]: "ES512", [-47]: "ES256K", [-257]: "RS256" };

/** Name of a COSE algorithm identifier. */
export function algorithmName(alg: number): string | null {
  return ALGORITHMS[alg] ?? null;
}

// CTAP2 status codes (`CTAP2_ERR_*`, pico-fido/src/fido/ctap.h). Spec identifiers: shown as code, not translated.
const CTAP_ERRORS: Record<number, string> = {
  0x11: "CBOR_UNEXPECTED_TYPE",
  0x12: "INVALID_CBOR",
  0x14: "MISSING_PARAMETER",
  0x15: "LIMIT_EXCEEDED",
  0x19: "CREDENTIAL_EXCLUDED",
  0x21: "PROCESSING",
  0x22: "INVALID_CREDENTIAL",
  0x23: "USER_ACTION_PENDING",
  0x24: "OPERATION_PENDING",
  0x25: "NO_OPERATIONS",
  0x26: "UNSUPPORTED_ALGORITHM",
  0x27: "OPERATION_DENIED",
  0x28: "KEY_STORE_FULL",
  0x2b: "UNSUPPORTED_OPTION",
  0x2c: "INVALID_OPTION",
  0x2d: "KEEPALIVE_CANCEL",
  0x2e: "NO_CREDENTIALS",
  0x2f: "USER_ACTION_TIMEOUT",
  0x30: "NOT_ALLOWED",
  0x31: "PIN_INVALID",
  0x32: "PIN_BLOCKED",
  0x33: "PIN_AUTH_INVALID",
  0x34: "PIN_AUTH_BLOCKED",
  0x35: "PIN_NOT_SET",
  0x36: "PUAT_REQUIRED",
  0x37: "PIN_POLICY_VIOLATION",
  0x39: "REQUEST_TOO_LARGE",
  0x3a: "ACTION_TIMEOUT",
  0x3b: "UP_REQUIRED",
  0x3c: "UV_BLOCKED",
  0x3d: "INTEGRITY_FAILURE",
  0x3e: "INVALID_SUBCOMMAND",
  0x3f: "UV_INVALID",
  0x40: "UNAUTHORIZED_PERMISSION",
};

/** Name of a CTAP2 status code, without the `CTAP2_ERR_` prefix. */
export function ctapErrorName(code: number): string | null {
  return CTAP_ERRORS[code] ?? null;
}
