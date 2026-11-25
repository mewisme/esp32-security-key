// The one decision the flash page shows: what to do with the board that is connected, from what was read of it.
// It combines the two rule sets, and never widens either:
//   - decideAppUpdate (app-update.ts): writes only the app image. Chosen whenever it is allowed: first install of nothing,
//     update, reinstall of the same image, repair, and downgrade declared safe by the installed release.
//   - decideInstallMode (install-mode.ts): the full write (bootloader, partition table, app) and every mode that needs a
//     typed confirmation. Offered, never applied silently, when the application-only path is refused (the reason is kept in
//     `appOnlyRefusal` so the page can say why). Its acknowledgements are unchanged.
// A key that is not the one that was inspected is the exception: that stops the flow instead of falling back.
import { parseAppDescriptor } from "./app-descriptor";
import { type AppUpdateDecision, type AppUpdateInput, decideAppUpdate } from "./app-update";
import { decideInstallMode, type InstallDecision, type InstallMode } from "./install-mode";
import { parsePartitionTable } from "./partition-table";

export type PlanInput = AppUpdateInput;

const APP_MODE: Partial<Record<AppUpdateDecision["outcome"], InstallMode>> = {
  "safe-update": "app-update",
  reinstall: "app-reinstall",
  downgrade: "app-downgrade",
  repair: "app-repair",
};

export function planFlash(input: PlanInput): InstallDecision {
  const { build } = input;
  const table = parsePartitionTable(input.table, build.partitions, input.policy, build.flash_size);
  const app = parseAppDescriptor(input.appDesc);
  const full = decideInstallMode({
    table,
    app,
    build,
    untestedHardware: input.untestedHardware ?? false,
    unsignedRelease: input.unsignedRelease,
    policy: input.policy,
  });

  const appOnly = decideAppUpdate(input);
  const mode = APP_MODE[appOnly.outcome];
  if (appOnly.allowed && mode) {
    return { mode, allowed: true, acks: appOnly.acks, writes: appOnly.writes, reason: appOnly.detail };
  }
  // Another key than the one inspected: never fall back to a bigger write on it.
  if (appOnly.reason === "different-key") {
    return { mode: "blocked", allowed: false, acks: [], writes: [], reason: appOnly.reason };
  }
  // The application-only path was refused. On a board whose layout matches, the full write is what remains; say why.
  if (table.status === "match" && full.mode !== "blocked") {
    return { ...full, appOnlyRefusal: { reason: appOnly.reason, detail: appOnly.detail } };
  }
  return full;
}
