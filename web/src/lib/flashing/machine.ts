// The installer's state machine. Pure: the hook in hooks/useInstaller.ts performs the side effects and feeds events.
// Invariants: `completed` is only reachable after FLASH_VERIFIED; nothing cancels a write in progress; confirmation
// needs every acknowledgement the install decision requires.
import type { ErrorCode } from "../errors/catalog";
import type { ChipInfo, PortInfo } from "./driver";
import type { AckId, InstallDecision } from "./install-mode";

export const PHASES = [
  "idle",
  "checking-browser",
  "hardware-guidance",
  "firmware-selection",
  "requesting-permission",
  "connecting",
  "detecting-chip",
  "validating-compatibility",
  "fetching-metadata",
  "downloading",
  "verifying-integrity",
  "checking-flash-safety",
  "awaiting-confirmation",
  "flashing",
  "verifying-flash",
  "rebooting",
  "awaiting-reenumeration",
  "completed",
  "failed",
  "cancelled",
] as const;

export type Phase = (typeof PHASES)[number];

export interface Milestones {
  downloaded: boolean;
  integrityVerified: boolean;
  written: boolean;
  flashVerified: boolean;
  deviceDetected: boolean;
}

export interface DeviceCheck {
  productName: string | null;
  manufacturerName: string | null;
  serialNumber: string | null;
  landingUrl: string | null;
}

export interface FlashError {
  code: ErrorCode;
  message: string;
  phase: Phase;
}

export interface FlashState {
  phase: Phase;
  milestones: Milestones;
  boardId: string | null;
  tag: string | null;
  buildId: string | null;
  port: PortInfo | null;
  chip: ChipInfo | null;
  decision: InstallDecision | null;
  progress: { written: number; total: number };
  download: { received: number; total: number };
  device: DeviceCheck | null;
  error: FlashError | null;
}

export type FlashEvent =
  | { type: "START" }
  | { type: "BROWSER_OK" }
  | { type: "BROWSER_UNSUPPORTED"; code: ErrorCode }
  | { type: "HARDWARE_CONFIRMED"; boardId: string }
  | { type: "FIRMWARE_SELECTED"; tag: string; buildId: string }
  | { type: "PORT_GRANTED"; info: PortInfo }
  | { type: "CONNECTED" }
  | { type: "CHIP_DETECTED"; chip: ChipInfo }
  | { type: "COMPATIBLE" }
  | { type: "MANIFEST_READY" }
  | { type: "DOWNLOAD_PROGRESS"; received: number; total: number }
  | { type: "DOWNLOADED" }
  | { type: "INTEGRITY_OK" }
  | { type: "SAFETY_DECIDED"; decision: InstallDecision }
  | { type: "CONFIRMED"; acks: AckId[] }
  | { type: "PROGRESS"; written: number; total: number }
  | { type: "WRITTEN" }
  | { type: "FLASH_VERIFIED" }
  | { type: "REBOOTED" }
  | { type: "DEVICE_DETECTED"; info: DeviceCheck }
  | { type: "DEVICE_NOT_DETECTED" }
  | { type: "FAIL"; code: ErrorCode; message: string }
  | { type: "CANCEL" }
  | { type: "RETRY" }
  | { type: "RESET" };

const NO_MILESTONES: Milestones = {
  downloaded: false,
  integrityVerified: false,
  written: false,
  flashVerified: false,
  deviceDetected: false,
};

export const initialState: FlashState = {
  phase: "idle",
  milestones: NO_MILESTONES,
  boardId: null,
  tag: null,
  buildId: null,
  port: null,
  chip: null,
  decision: null,
  progress: { written: 0, total: 0 },
  download: { received: 0, total: 0 },
  device: null,
  error: null,
};

const TERMINAL: Phase[] = ["idle", "completed", "failed", "cancelled"];
/** A write in progress must not be abandoned half-way. */
const UNINTERRUPTIBLE: Phase[] = ["flashing", "verifying-flash"];

const at = (p: Phase) => PHASES.indexOf(p);

/** Clears everything that belongs to one attempt at talking to a board. */
function freshAttempt(s: FlashState, phase: Phase): FlashState {
  return {
    ...s,
    phase,
    milestones: NO_MILESTONES,
    port: null,
    chip: null,
    decision: null,
    progress: { written: 0, total: 0 },
    download: { received: 0, total: 0 },
    device: null,
    error: null,
  };
}

export function flashReducer(s: FlashState, e: FlashEvent): FlashState {
  if (e.type === "FAIL") {
    if (TERMINAL.includes(s.phase)) return s;
    return { ...s, phase: "failed", error: { code: e.code, message: e.message, phase: s.phase } };
  }
  if (e.type === "CANCEL") {
    if (TERMINAL.includes(s.phase) || UNINTERRUPTIBLE.includes(s.phase)) return s;
    return { ...s, phase: "cancelled" };
  }
  if (e.type === "RESET") {
    if (UNINTERRUPTIBLE.includes(s.phase)) return s;
    return initialState;
  }
  switch (s.phase) {
    case "idle":
      return e.type === "START" ? { ...s, phase: "checking-browser" } : s;
    case "checking-browser":
      if (e.type === "BROWSER_OK") return { ...s, phase: "hardware-guidance" };
      if (e.type === "BROWSER_UNSUPPORTED") return { ...s, phase: "failed", error: { code: e.code, message: e.code, phase: s.phase } };
      return s;
    case "hardware-guidance":
      return e.type === "HARDWARE_CONFIRMED" ? { ...s, phase: "firmware-selection", boardId: e.boardId } : s;
    case "firmware-selection":
      return e.type === "FIRMWARE_SELECTED" ? { ...s, phase: "requesting-permission", tag: e.tag, buildId: e.buildId } : s;
    case "requesting-permission":
      return e.type === "PORT_GRANTED" ? { ...s, phase: "connecting", port: e.info } : s;
    case "connecting":
      return e.type === "CONNECTED" ? { ...s, phase: "detecting-chip" } : s;
    case "detecting-chip":
      return e.type === "CHIP_DETECTED" ? { ...s, phase: "validating-compatibility", chip: e.chip } : s;
    case "validating-compatibility":
      return e.type === "COMPATIBLE" ? { ...s, phase: "fetching-metadata" } : s;
    case "fetching-metadata":
      return e.type === "MANIFEST_READY" ? { ...s, phase: "downloading" } : s;
    case "downloading":
      if (e.type === "DOWNLOAD_PROGRESS") return { ...s, download: { received: e.received, total: e.total } };
      if (e.type === "DOWNLOADED") return { ...s, phase: "verifying-integrity", milestones: { ...s.milestones, downloaded: true } };
      return s;
    case "verifying-integrity":
      return e.type === "INTEGRITY_OK"
        ? { ...s, phase: "checking-flash-safety", milestones: { ...s.milestones, integrityVerified: true } }
        : s;
    case "checking-flash-safety":
      if (e.type !== "SAFETY_DECIDED") return s;
      if (!e.decision.allowed) {
        return { ...s, phase: "failed", decision: e.decision, error: { code: "storage-incompatible", message: e.decision.reason, phase: s.phase } };
      }
      return { ...s, phase: "awaiting-confirmation", decision: e.decision };
    case "awaiting-confirmation":
      if (e.type !== "CONFIRMED" || !s.decision) return s;
      return s.decision.acks.every((a) => e.acks.includes(a)) ? { ...s, phase: "flashing", progress: { written: 0, total: 0 } } : s;
    case "flashing":
      if (e.type === "PROGRESS") return { ...s, progress: { written: e.written, total: e.total } };
      if (e.type === "WRITTEN") return { ...s, phase: "verifying-flash", milestones: { ...s.milestones, written: true } };
      return s;
    case "verifying-flash":
      return e.type === "FLASH_VERIFIED" ? { ...s, phase: "rebooting", milestones: { ...s.milestones, flashVerified: true } } : s;
    case "rebooting":
      return e.type === "REBOOTED" ? { ...s, phase: "awaiting-reenumeration" } : s;
    case "awaiting-reenumeration":
      if (!s.milestones.flashVerified) return s;
      if (e.type === "DEVICE_DETECTED") {
        return { ...s, phase: "completed", device: e.info, milestones: { ...s.milestones, deviceDetected: true } };
      }
      if (e.type === "DEVICE_NOT_DETECTED") return { ...s, phase: "completed", milestones: { ...s.milestones, deviceDetected: false } };
      return s;
    case "failed": {
      if (e.type !== "RETRY" || !s.error) return s;
      const failedAt = at(s.error.phase);
      if (failedAt < at("hardware-guidance")) return freshAttempt(s, "checking-browser");
      return freshAttempt(s, failedAt >= at("requesting-permission") ? "requesting-permission" : "firmware-selection");
    }
    default:
      return s;
  }
}
