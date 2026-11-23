// The record that an application write was started and not yet verified. It is the only thing that lets the next visit
// offer "repair" for an application whose descriptor is unreadable; without it such a key is refused as unknown.
import type { PendingUpdate } from "./app-update";

export const PENDING_KEY = "multikeys-pending-update";

function isPending(v: unknown): v is PendingUpdate {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.project === "string" &&
    (o.fromVersion === null || typeof o.fromVersion === "string") &&
    typeof o.toVersion === "string" &&
    typeof o.tag === "string" &&
    typeof o.profileId === "string" &&
    typeof o.appSha256 === "string" &&
    typeof o.startedAt === "string"
  );
}

export function loadPending(): PendingUpdate | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return isPending(v) ? v : null;
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
