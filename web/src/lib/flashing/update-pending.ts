// The record that an application write was started and not yet verified. It is the only thing that lets the next visit
// offer "repair" for an application whose descriptor is unreadable; without it such a key is refused as unknown.
// Version 2 records name the chip and the exact image (see checkPending in app-update.ts). A record from an older page
// (no `v`) is loaded as version 1: it is shown and can be discarded, but never justifies a repair.
import type { PendingUpdate } from "./app-update";

export const PENDING_KEY = "multikeys-pending-update";

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** Returns the record in the current shape, or null when it is not a pending-update record at all. */
export function parsePending(v: unknown): PendingUpdate | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    !isStr(o.project) ||
    !isStrOrNull(o.fromVersion) ||
    !isStr(o.toVersion) ||
    !isStr(o.tag) ||
    !isStr(o.profileId) ||
    !isStr(o.appSha256) ||
    !isStr(o.startedAt)
  ) {
    return null;
  }
  const base = { project: o.project, fromVersion: o.fromVersion, toVersion: o.toVersion, tag: o.tag, profileId: o.profileId, appSha256: o.appSha256, startedAt: o.startedAt };
  if (o.v === undefined) return { ...base, v: 1, imageFamily: null, chipMac: null };
  if (o.v !== 2 || (o.imageFamily !== "fido" && o.imageFamily !== "openpgp") || !isStrOrNull(o.chipMac)) return null;
  return { ...base, v: 2, imageFamily: o.imageFamily, chipMac: o.chipMac };
}

export function loadPending(): PendingUpdate | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? parsePending(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePending(p: PendingUpdate): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    // Storage may be unavailable (private mode): the update still works, only the repair hint is lost.
  }
}

export function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // see savePending
  }
}
