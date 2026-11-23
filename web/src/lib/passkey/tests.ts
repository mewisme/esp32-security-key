// The four tests of the Passkey lab and how each one is judged. The page only shows what comes back.
import {
  classifyWebAuthnError,
  type LabAssertion,
  type LabCheck,
  type LabCredential,
  type LabErrorId,
  REFUSAL_TIMEOUT_MS,
  register,
  signIn,
  TOUCH_TIMEOUT_MS,
} from "./lab";

export const TESTS = ["register", "signIn", "discoverable", "refusal"] as const;
export type TestId = (typeof TESTS)[number];

export type Detail =
  | { kind: "register"; credential: LabCredential }
  | { kind: "assertion"; assertion: LabAssertion }
  /** The refusal test: `assertion` is set only when a signature came back (the failure). */
  | { kind: "refusal"; assertion: LabAssertion | null }
  | { kind: "error"; error: LabErrorId };

export interface Outcome {
  test: TestId;
  passed: boolean;
  detail: Detail;
}

/** How long the browser waits for a touch in this test: what the key's countdown should run for. */
export function timeoutFor(test: TestId): number {
  return test === "refusal" ? REFUSAL_TIMEOUT_MS : TOUCH_TIMEOUT_MS;
}

/** A check that could not be made (`null`) does not fail a test; only a check that failed does. */
export function checksPass(checks: readonly LabCheck[]): boolean {
  return checks.every((c) => c.ok !== false);
}

/**
 * Runs one test. `credential` is the passkey made by Register (required by the other three); `previousSignCount` is the
 * counter the last result reported. A thrown error is turned into an `error` outcome, never rethrown.
 */
export async function runTest(test: TestId, credential: LabCredential | null, previousSignCount?: number): Promise<Outcome> {
  try {
    if (test === "register") {
      const created = await register();
      return { test, passed: checksPass(created.checks), detail: { kind: "register", credential: created } };
    }
    if (!credential) throw new Error("no credential to sign in with");
    if (test === "refusal") {
      // Asking for a signature that nobody touches the key for: a key that answers anyway does not enforce presence.
      const assertion = await signIn(credential, { discoverable: false, timeoutMs: REFUSAL_TIMEOUT_MS, previousSignCount });
      return { test, passed: false, detail: { kind: "refusal", assertion } };
    }
    const assertion = await signIn(credential, { discoverable: test === "discoverable", timeoutMs: TOUCH_TIMEOUT_MS, previousSignCount });
    return { test, passed: checksPass(assertion.checks), detail: { kind: "assertion", assertion } };
  } catch (e) {
    const error = classifyWebAuthnError(e);
    if (test === "refusal" && error === "cancelledOrTimeout") return { test, passed: true, detail: { kind: "refusal", assertion: null } };
    return { test, passed: false, detail: { kind: "error", error } };
  }
}
