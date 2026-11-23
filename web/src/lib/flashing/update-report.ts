// What the page could check about the key after an application-only update, and nothing more. A field is null when it
// could not be checked (no baseline, firmware too old, key not read), never true by default.
import type { KeySnapshot } from "../device/key-snapshot";

export type UpdateVerdict = "verified" | "partial" | "unchecked" | "mismatch";

export interface UpdateReport {
  /** The key was read after the update. */
  reachable: boolean;
  /** The running image's SHA-256 equals the published app image. */
  imageMatches: boolean | null;
  /** The running version equals the published one. */
  versionMatches: boolean | null;
  /** The USB name equals the one read before. */
  nameUnchanged: boolean | null;
  /** MKAUTH enrollment state and device id equal the ones read before. */
  mkauthUnchanged: boolean | null;
  /** Version the key reports now. */
  installedVersion: string | null;
  /** FIDO credentials and the PIN are never read by this page; only the optional passkey test exercises them. */
  fidoChecked: false;
  verdict: UpdateVerdict;
}

const same = <T>(before: T | null, after: T | null): boolean | null => (before === null || after === null ? null : before === after);

export function buildReport(
  before: KeySnapshot | null,
  after: KeySnapshot | null,
  target: { version: string; appSha256: string },
): UpdateReport {
  if (!after) {
    return { reachable: false, imageMatches: null, versionMatches: null, nameUnchanged: null, mkauthUnchanged: null, installedVersion: null, fidoChecked: false, verdict: "unchecked" };
  }
  const imageMatches = after.build?.imageSha256 === undefined ? null : after.build.imageSha256 === target.appSha256;
  const versionMatches = after.build?.version === undefined ? null : after.build.version === target.version;
  const nameUnchanged = same(before?.name ?? null, after.name);
  const enrolled = same(before?.enrolled ?? null, after.enrolled);
  const deviceId = same(before?.deviceId ?? null, after.deviceId);
  const mkauthUnchanged = enrolled === false || deviceId === false ? false : enrolled === null || deviceId === null ? null : true;
  const checks = [imageMatches, versionMatches, nameUnchanged, mkauthUnchanged];
  const verdict: UpdateVerdict = checks.includes(false) ? "mismatch" : checks.every((c) => c === true) ? "verified" : "partial";
  return { reachable: true, imageMatches, versionMatches, nameUnchanged, mkauthUnchanged, installedVersion: after.build?.version ?? null, fidoChecked: false, verdict };
}
