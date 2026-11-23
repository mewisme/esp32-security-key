// Simulated board behaviour for the e2e build. Specs set it with
//   page.addInitScript((s) => localStorage.setItem("multikeys-e2e-scenario", JSON.stringify(s)), scenario)
export interface Scenario {
  chip?: string;
  flashSize?: string | null;
  port?: "native" | "uart";
  chooser?: "ok" | "cancel";
  connectError?: boolean;
  device?: "blank" | "fido-0.1.0-dev" | "fido-0.2.0" | "foreign";
  disconnectAt?: number;
  checker?: "ok" | "throw";
}

export const SCENARIO_KEY = "multikeys-e2e-scenario";

export function readScenario(): Scenario {
  try {
    return JSON.parse(localStorage.getItem(SCENARIO_KEY) ?? "{}") as Scenario;
  } catch {
    return {};
  }
}
