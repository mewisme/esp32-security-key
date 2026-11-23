// What the person chose before connecting (release, device name). Persisted per tab (sessionStorage) so Back/Continue
// and a reload keep it. Kept apart from the installer hook so pages that only read it (First use) don't pull in esptool-js.
import { validateDeviceName } from "./device/device-name";
import type { NameRequest } from "./device/mkauth";

export interface InstallerConfig {
  /** Release tag, or null for "the default release". */
  tag: string | null;
  image: "fido" | "openpgp";
  name: NameRequest;
}

export const CONFIG_KEY = "multikeys-installer-config";
export const DEFAULT_CONFIG: InstallerConfig = { tag: null, image: "fido", name: { mode: "keep" } };

/** Validates a stored config; anything unexpected (bad JSON, unknown mode, a name the key would refuse) -> the default. */
export function parseConfig(raw: string | null): InstallerConfig {
  if (!raw) return DEFAULT_CONFIG;
  try {
    const v = JSON.parse(raw) as { tag?: unknown; image?: unknown; name?: { mode?: unknown; name?: unknown } } | null;
    if (!v || typeof v !== "object") return DEFAULT_CONFIG;
    const tag = v.tag ?? null;
    const image = v.image === "fido" || v.image === "openpgp" ? v.image : null;
    if ((tag !== null && typeof tag !== "string") || !image || !v.name || typeof v.name !== "object") return DEFAULT_CONFIG;
    const { mode } = v.name;
    if (mode === "keep" || mode === "default") return { tag, image, name: { mode } };
    if (mode === "custom" && typeof v.name.name === "string" && validateDeviceName(v.name.name) === null) {
      return { tag, image, name: { mode, name: v.name.name } };
    }
  } catch {
    // fall through
  }
  return DEFAULT_CONFIG;
}

export function loadConfig(): InstallerConfig {
  try {
    return parseConfig(sessionStorage.getItem(CONFIG_KEY));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: InstallerConfig): void {
  try {
    sessionStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // storage unavailable: the choices simply don't survive a reload
  }
}
