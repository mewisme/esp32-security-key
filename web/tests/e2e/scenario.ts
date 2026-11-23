// Simulated board behaviour for the e2e build. Specs set it with
//   page.addInitScript((s) => localStorage.setItem("multikeys-e2e-scenario", JSON.stringify(s)), scenario)
export interface Scenario {
  chip?: string;
  flashSize?: string | null;
  /** Quad or octal flash as read from eFuse (default quad). */
  flashType?: "quad" | "octal";
  /** Chip features reported by esptool (default: an N16R8, i.e. Wi-Fi, BLE and 8 MB embedded PSRAM). */
  features?: string[];
  /** Which release the fake server publishes: the schema-2 release with every profile (default) or the legacy v0.2.0 shape. */
  release?: "v2" | "legacy-v1";
  /** Milliseconds the simulated flash write waits per chunk (default 15); raise it to look at the install stage. */
  writeDelayMs?: number;
  port?: "native" | "uart";
  chooser?: "ok" | "cancel";
  connectError?: boolean;
  device?: "blank" | "fido-0.1.0-dev" | "fido-0.2.0" | "foreign";
  disconnectAt?: number;
  checker?: "ok" | "throw";
  key?: { name?: string; custom?: boolean; renameSupported?: boolean; enrolledPin?: string; button?: "press" | "timeout"; reenumerate?: "ok" | "never" };
}

export const SCENARIO_KEY = "multikeys-e2e-scenario";

export function readScenario(): Scenario {
  try {
    return JSON.parse(localStorage.getItem(SCENARIO_KEY) ?? "{}") as Scenario;
  } catch {
    return {};
  }
}
