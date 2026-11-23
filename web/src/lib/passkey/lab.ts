// The passkey lab's WebAuthn calls and what it checks about their results. Everything is verified in the browser: no server,
// nothing stored. No user-visible text in here; the page maps ids (`LabCheckId`, `LabErrorId`) to words.
import { type AuthData, type AuthFlags, parseAuthData } from "./authdata";
import { equalBytes, randomBytes } from "./bytes";
import { decodeCbor } from "./cbor";
import { checkClientData, checkRpIdHash, importCoseEs256, UnsupportedAlgError, verifyAssertion } from "./verify";

export const LAB_RP_NAME = "MultiKeys Passkey Lab";
export const LAB_USER_NAME = "passkey-lab-test";
export const LAB_USER_DISPLAY = "MultiKeys test passkey";
/** How long the browser waits for a touch in the register and sign-in tests. */
export const TOUCH_TIMEOUT_MS = 30_000;
/** How long the "don't touch" test waits for the browser to give up. */
export const REFUSAL_TIMEOUT_MS = 15_000;

export type LabCheckId = "clientData" | "rpId" | "signature" | "userPresence" | "credential" | "counter" | "residentKey";

/** `ok: null` means the check could not be made (for example a counter that stays 0). */
export interface LabCheck {
  id: LabCheckId;
  ok: boolean | null;
}

export type LabErrorId = "cancelledOrTimeout" | "alreadyRegistered" | "notSupported" | "security" | "verification" | "unknown";

export interface LabCredential {
  id: Uint8Array;
  publicKey: CryptoKey;
  aaguid: string;
  flags: AuthFlags;
  signCount: number;
  transports: string[];
  /** What the browser reported for the `credProps` extension; null when it did not say. */
  discoverable: boolean | null;
  checks: LabCheck[];
}

export interface LabAssertion {
  credentialId: Uint8Array;
  flags: AuthFlags;
  signCount: number;
  /** null when the answer came from a different passkey than the one registered, so this key cannot verify it. */
  signatureValid: boolean | null;
  matched: boolean;
  /** null when both counters are 0: a key may report 0 forever. */
  counterIncreased: boolean | null;
  checks: LabCheck[];
}

/** One of this module's own checks failed (as opposed to the browser or the key refusing). */
export class LabVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabVerificationError";
  }
}

export function webAuthnSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
}

export function classifyWebAuthnError(e: unknown): LabErrorId {
  if (e instanceof LabVerificationError || e instanceof UnsupportedAlgError) return "verification";
  const name = typeof e === "object" && e !== null && "name" in e ? String(e.name) : "";
  switch (name) {
    case "NotAllowedError":
      return "cancelledOrTimeout";
    case "InvalidStateError":
      return "alreadyRegistered";
    case "NotSupportedError":
      return "notSupported";
    case "SecurityError":
      return "security";
    default:
      return typeof PublicKeyCredential === "undefined" ? "notSupported" : "unknown";
  }
}

function asBytes(buffer: ArrayBuffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}

function require_<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new LabVerificationError("missing field");
  return value;
}

function publicKeyCredential(c: Credential | null): PublicKeyCredential {
  if (!c || c.type !== "public-key") throw new LabVerificationError("no credential");
  return c as PublicKeyCredential;
}

function describeBasics(authData: AuthData, clientOk: boolean, rpOk: boolean): LabCheck[] {
  return [
    { id: "clientData", ok: clientOk },
    { id: "rpId", ok: rpOk },
    // A missing UP flag would mean the key does not wait for the BOOT button.
    { id: "userPresence", ok: authData.flags.up },
  ];
}

export async function register(): Promise<LabCredential> {
  if (!webAuthnSupported()) throw new DOMException("WebAuthn is not available", "NotSupportedError");
  const challenge = randomBytes(32);
  const rpId = location.hostname;
  // `hints` is newer than TypeScript's DOM types in some versions and ignored by browsers that do not know it.
  const options = {
    rp: { id: rpId, name: LAB_RP_NAME },
    user: { id: randomBytes(16), name: LAB_USER_NAME, displayName: LAB_USER_DISPLAY },
    challenge,
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: {
      authenticatorAttachment: "cross-platform",
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "discouraged",
    },
    attestation: "none",
    timeout: TOUCH_TIMEOUT_MS,
    hints: ["security-key"],
    extensions: { credProps: true },
  } satisfies PublicKeyCredentialCreationOptions & { hints: string[] };

  const credential = publicKeyCredential(await navigator.credentials.create({ publicKey: options }));
  const response = credential.response as AuthenticatorAttestationResponse;

  const attestation = decodeCbor(new Uint8Array(response.attestationObject));
  const authBytes = attestation instanceof Map ? attestation.get("authData") : undefined;
  if (!(authBytes instanceof Uint8Array)) throw new LabVerificationError("attestation");
  const authData = parseAuthData(authBytes);

  const clientOk = checkClientData(asBytes(response.clientDataJSON), { type: "webauthn.create", challenge, origin: location.origin }).ok;
  const rpOk = await checkRpIdHash(authData, rpId);
  const id = require_(authData.credentialId);
  const publicKey = await importCoseEs256(require_(authData.cosePublicKey));
  const discoverable = credential.getClientExtensionResults().credProps?.rk ?? null;

  return {
    id,
    publicKey,
    aaguid: require_(authData.aaguid),
    flags: authData.flags,
    signCount: authData.signCount,
    transports: response.getTransports?.() ?? [],
    discoverable,
    checks: [...describeBasics(authData, clientOk, rpOk), { id: "residentKey", ok: discoverable }],
  };
}

export interface SignInOptions {
  /** True: send no allow list, so the key picks a stored passkey by itself. */
  discoverable: boolean;
  timeoutMs: number;
  /** The counter the previous result reported; defaults to the one from registration. */
  previousSignCount?: number;
}

export async function signIn(cred: LabCredential, opts: SignInOptions): Promise<LabAssertion> {
  if (!webAuthnSupported()) throw new DOMException("WebAuthn is not available", "NotSupportedError");
  const challenge = randomBytes(32);
  const rpId = location.hostname;
  const options: PublicKeyCredentialRequestOptions = {
    rpId,
    challenge,
    timeout: opts.timeoutMs,
    userVerification: "discouraged",
    allowCredentials: opts.discoverable ? [] : [{ type: "public-key", id: cred.id as Uint8Array<ArrayBuffer> }],
  };

  const credential = publicKeyCredential(await navigator.credentials.get({ publicKey: options }));
  const response = credential.response as AuthenticatorAssertionResponse;
  const authBytes = asBytes(response.authenticatorData);
  const authData = parseAuthData(authBytes);

  const clientOk = checkClientData(asBytes(response.clientDataJSON), { type: "webauthn.get", challenge, origin: location.origin }).ok;
  const rpOk = await checkRpIdHash(authData, rpId);
  const credentialId = asBytes(credential.rawId);
  const matched = equalBytes(credentialId, cred.id);
  // Another passkey of this site on the same key would sign with a different private key: not ours to verify.
  const signatureValid = matched ? await verifyAssertion(cred.publicKey, authBytes, asBytes(response.clientDataJSON), new Uint8Array(response.signature)) : null;
  const previous = opts.previousSignCount ?? cred.signCount;
  const counterIncreased = previous === 0 && authData.signCount === 0 ? null : authData.signCount > previous;

  return {
    credentialId,
    flags: authData.flags,
    signCount: authData.signCount,
    signatureValid,
    matched,
    counterIncreased,
    checks: [
      ...describeBasics(authData, clientOk, rpOk).slice(0, 2),
      { id: "signature", ok: signatureValid },
      { id: "userPresence", ok: authData.flags.up },
      { id: "credential", ok: matched },
      { id: "counter", ok: counterIncreased },
    ],
  };
}
