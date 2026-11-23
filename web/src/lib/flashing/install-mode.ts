// Every data-safety decision of the web installer lives here. Rules (docs/SECURITY.md, "Web installer trust model"):
//  1. blank flash                                  -> first-install
//  2. matching layout, same MultiKeys image        -> update (declared compatible) or update-unverified
//  3. matching layout, the other MultiKeys image   -> switch-image
//  4. matching layout, no / non-MultiKeys app      -> replace-compatible-layout
//  5. foreign layout, no MultiKeys app             -> repurpose (clears nvs + part0 first, typed confirmation)
//  6. foreign layout with a MultiKeys app          -> blocked (storage-incompatible)
// Outside repurpose no write ever touches a protected partition. A table that cannot be read never gets here: the
// caller fails with `unsafe-layout`.
import { type FlashPolicy, policy as defaultPolicy } from "../firmware/policy";
import type { Build } from "../firmware/types";
import { compareSemver } from "../firmware/version";
import type { AppDescriptor } from "./app-descriptor";
import type { TableResult } from "./partition-table";

export type InstallMode =
  | "first-install"
  | "update"
  | "update-unverified"
  | "switch-image"
  | "replace-compatible-layout"
  | "repurpose"
  | "blocked";

export type AckId = "dev-firmware" | "update-unverified" | "switch-image" | "replace-layout" | "repurpose-typed";

export interface Write {
  offset: number;
  length: number;
  kind: "image" | "fill";
  role: string;
}

export interface InstallDecision {
  mode: InstallMode;
  allowed: boolean;
  acks: AckId[];
  writes: Write[];
  reason: string;
}

export function decideInstallMode(input: {
  table: TableResult;
  app: AppDescriptor | null;
  build: Build;
  policy?: FlashPolicy;
}): InstallDecision {
  const { table, app, build } = input;
  const p = input.policy ?? defaultPolicy;
  const images: Write[] = [...build.images]
    .sort((a, b) => a.offset - b.offset)
    .map((i) => ({ offset: i.offset, length: i.size, kind: "image", role: i.role }));
  const runsMultiKeys = !!app && app.project_name.startsWith("multikey-");

  if (table.status === "blank") {
    return { mode: "first-install", allowed: true, acks: ["dev-firmware"], writes: images, reason: table.detail };
  }
  if (table.status === "match") {
    if (app && app.project_name === build.project_name) {
      const from = compareSemver(app.version, build.update.data_preserving_from);
      const to = compareSemver(app.version, build.version);
      if (from !== null && to !== null && from >= 0 && to <= 0) {
        return {
          mode: "update",
          allowed: true,
          acks: ["dev-firmware"],
          writes: images,
          reason: `installed ${app.version} is within the declared data-compatible range ${build.update.data_preserving_from}..${build.version}`,
        };
      }
      return {
        mode: "update-unverified",
        allowed: true,
        acks: ["dev-firmware", "update-unverified"],
        writes: images,
        reason: `installed version ${app.version || "(unknown)"} is outside the declared data-compatible range ${build.update.data_preserving_from}..${build.version}`,
      };
    }
    if (runsMultiKeys) {
      return {
        mode: "switch-image",
        allowed: true,
        acks: ["dev-firmware", "switch-image"],
        writes: images,
        reason: `the board runs ${app!.project_name}, this firmware is ${build.project_name}`,
      };
    }
    return {
      mode: "replace-compatible-layout",
      allowed: true,
      acks: ["dev-firmware", "replace-layout"],
      writes: images,
      reason: app ? `the board runs ${app.project_name}` : "no recognisable app on the board",
    };
  }
  // mismatch or garbage
  if (runsMultiKeys) {
    return { mode: "blocked", allowed: false, acks: [], writes: [], reason: "storage-incompatible" };
  }
  const fills: Write[] = build.partitions
    .filter((q) => build.repurpose_fill.includes(q.name) && p.protected_partitions.includes(q.name))
    .map((q) => ({ offset: q.offset, length: q.size, kind: "fill" as const, role: q.name }));
  return {
    mode: "repurpose",
    allowed: true,
    acks: ["dev-firmware", "repurpose-typed"],
    // Fills first: if interrupted, the foreign table is still in place and the next run is detected as repurpose again.
    writes: [...fills, ...images],
    reason: table.detail,
  };
}
