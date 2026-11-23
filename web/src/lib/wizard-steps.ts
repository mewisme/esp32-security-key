import type { Phase } from "./flashing/machine";

export const STEPS = [
  "Welcome",
  "Hardware",
  "Firmware",
  "Connect",
  "Hardware check",
  "Firmware check",
  "Confirm",
  "Install",
  "Reconnect & verify",
  "First use",
] as const;

const STEP_OF: Record<Phase, number> = {
  idle: 0,
  "checking-browser": 1,
  "hardware-guidance": 1,
  "firmware-selection": 2,
  "requesting-permission": 3,
  connecting: 4,
  "detecting-chip": 4,
  "validating-compatibility": 4,
  "fetching-metadata": 5,
  downloading: 5,
  "verifying-integrity": 5,
  "checking-flash-safety": 5,
  "awaiting-confirmation": 6,
  flashing: 7,
  "verifying-flash": 7,
  rebooting: 8,
  "awaiting-reenumeration": 8,
  completed: 9,
  failed: 0,
  cancelled: 0,
};

/** Wizard step shown for a phase; a failure stays on the step where it happened. */
export function stepIndex(phase: Phase, errorPhase?: Phase): number {
  return phase === "failed" && errorPhase ? STEP_OF[errorPhase] : STEP_OF[phase];
}
