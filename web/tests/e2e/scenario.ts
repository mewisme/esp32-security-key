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
  key?: {
    name?: string;
    custom?: boolean;
    renameSupported?: boolean;
    enrolledPin?: string;
    button?: "press" | "timeout";
    reenumerate?: "ok" | "never";
    /** Reads the key leaves unanswered right after it restarted (the firmware drops a command while Windows probes it). */
    silentAfterRestart?: number;
    /** The write is applied, the key restarts, but its answer never reaches the page. */
    dropWriteAnswer?: boolean;
    /** MKAUTH INS 07. Absent: the key answers like the firmware that predates BUILD_INFO (status 6D00). */
    build?: { imageSha256?: string; version?: string; commit?: string; flashEncryption?: boolean; secureBoot?: boolean };
    /** Passkey events the key pushes while the page watches. `queued` ones were waiting in the key already. */
    events?: ScriptedEvent[];
  };
}

export interface ScriptedEvent {
  afterMs: number;
  queued?: boolean;
  op: "make-credential" | "get-assertion" | "user-presence";
  result: "pending" | "ok" | "error";
  rpId?: string;
  userName?: string;
  userDisplayName?: string;
  algorithm?: number;
  authFlags?: number;
  error?: number;
  credentialCount?: number;
  operation?: "make-credential" | "get-assertion";
}

export const SCENARIO_KEY = "multikeys-e2e-scenario";

export function readScenario(): Scenario {
  try {
    return JSON.parse(localStorage.getItem(SCENARIO_KEY) ?? "{}") as Scenario;
  } catch {
    return {};
  }
}
