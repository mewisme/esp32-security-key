import type { Phase } from "./flashing/machine";

/** The six installation stages; each one's title is `t.install.steps[id]` in src/i18n/messages. */
export const STEPS = ["get-started", "firmware", "connect", "review", "install", "finish"] as const;

export type StepId = (typeof STEPS)[number];

const STEP_OF: Record<Phase, number> = {
  idle: 0,
  "checking-browser": 0,
  "hardware-guidance": 0,
  "firmware-selection": 1,
  "requesting-permission": 2,
  connecting: 2,
  "detecting-chip": 2,
  "validating-compatibility": 2,
  "fetching-metadata": 2,
  downloading: 2,
  "verifying-integrity": 2,
  "checking-flash-safety": 2,
  "awaiting-confirmation": 3,
  flashing: 4,
  "verifying-flash": 4,
  rebooting: 4,
  "awaiting-reenumeration": 5,
  completed: 5,
  failed: 0,
  cancelled: 0,
};

/** Wizard step shown for a phase; a failure stays on the step where it happened. */
export function stepIndex(phase: Phase, errorPhase?: Phase): number {
  return phase === "failed" && errorPhase ? STEP_OF[errorPhase] : STEP_OF[phase];
}
