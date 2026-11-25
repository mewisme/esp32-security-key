// Every data-safety decision of the web installer lives here. Rules (docs/SECURITY.md, "Web installer trust model"):
//  1. blank flash                                  -> first-install
//  2. matching layout, same MultiKeys image        -> update (declared compatible) or update-forced (outside the range:
//     allowed only with the force-storage tick and FORCE typed; part0 is still never written)
//  3. matching layout, the other MultiKeys image   -> switch-image
//  4. matching layout, no / non-MultiKeys app      -> replace-compatible-layout
//  5. foreign layout, no MultiKeys app             -> repurpose (clears nvs + part0 first, typed confirmation)
//  6. foreign layout with a MultiKeys app          -> blocked (storage-incompatible)
//  7. every board needs (none is positively identified as the tested unit) the untested-hardware acknowledgement
//  8. an OpenPGP image (experimental, not hardware verified) needs the experimental-image acknowledgement, and a
//     switch between the two images also needs SWITCH typed (the FIDO2 / OpenPGP data areas are not interchangeable)
// Outside repurpose no write ever touches a protected partition. A table that cannot be read never gets here: the
// caller fails with `unsafe-layout`.
import { type FlashPolicy, policy as defaultPolicy, protectedNames, protectedRanges } from "../firmware/policy";
import type { Build } from "../firmware/types";
import { compareSemver } from "../firmware/version";
import type { AppDescriptor } from "./app-descriptor";
import type { TableResult } from "./partition-table";

export type InstallMode =
  | "first-install"
  | "update"
  | "update-forced"
  | "switch-image"
  | "replace-compatible-layout"
  | "repurpose"
  | "blocked";

export type AckId =
  | "dev-firmware"
  | "experimental-image"
  | "switch-image"
  | "switch-image-typed"
  | "replace-layout"
  | "repurpose-typed"
  | "force-storage"
  | "force-typed"
  | "untested-hardware"
  | "unsigned-release";

/** Acknowledgements the person gives by typing a word instead of ticking a box, with the word to type. */
export const TYPED_ACKS = { "repurpose-typed": "REPURPOSE", "switch-image-typed": "SWITCH", "force-typed": "FORCE" } as const;
export type TypedAckId = keyof typeof TYPED_ACKS;

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
  /** True unless the board is positively identified as the tested unit (see BOARD_IDENTITY_VERIFIED in compatibility/profiles.ts). */
  untestedHardware: boolean;
  /** True when the release manifest carries no valid signature: the person must acknowledge that first. */
  unsignedRelease?: boolean;
  policy?: FlashPolicy;
}): InstallDecision {
  const { table, app, build } = input;
  const p = input.policy ?? defaultPolicy;
  const acks = (...needed: AckId[]): AckId[] => [
    ...needed,
    ...(input.build.image === "openpgp" ? (["experimental-image"] as const) : []),
    ...(input.untestedHardware ? (["untested-hardware"] as const) : []),
    ...(input.unsignedRelease ? (["unsigned-release"] as const) : []),
  ];
  const images: Write[] = [...build.images]
    .sort((a, b) => a.offset - b.offset)
    .map((i) => ({ offset: i.offset, length: i.size, kind: "image", role: i.role }));
  const runsMultiKeys = !!app && app.project_name.startsWith("multikey-");

  if (table.status === "blank") {
    return { mode: "first-install", allowed: true, acks: acks("dev-firmware"), writes: images, reason: table.detail };
  }
  if (table.status === "match") {
    if (app && app.project_name === build.project_name) {
      const from = compareSemver(app.version, build.update.data_preserving_from);
      const to = compareSemver(app.version, build.version);
      if (from !== null && to !== null && from >= 0 && to <= 0) {
        return {
          mode: "update",
          allowed: true,
          acks: acks("dev-firmware"),
          writes: images,
          reason: `installed ${app.version} is within the declared data-compatible range ${build.update.data_preserving_from}..${build.version}`,
        };
      }
      // Not shown compatible (older than the declared range, newer than this release, or not a version). The
      // application-only update page refuses these. Here the person can force it: the three images are rewritten, the
      // storage area (part0) is not, and the keys in it may be unreadable afterwards.
      return {
        mode: "update-forced",
        allowed: true,
        acks: acks("dev-firmware", "force-storage", "force-typed"),
        writes: images,
        reason: `installed ${app.version ?? "an unreadable version"} is outside the declared data-compatible range ${build.update.data_preserving_from}..${build.version}`,
      };
    }
    if (runsMultiKeys) {
      return {
        mode: "switch-image",
        allowed: true,
        acks: acks("dev-firmware", "switch-image", "switch-image-typed"),
        writes: images,
        reason: `the board runs ${app!.project_name}, this firmware is ${build.project_name}`,
      };
    }
    return {
      mode: "replace-compatible-layout",
      allowed: true,
      acks: acks("dev-firmware", "replace-layout"),
      writes: images,
      reason: app ? `the board runs ${app.project_name}` : "no recognisable app on the board",
    };
  }
  // mismatch or garbage
  if (runsMultiKeys) {
    return { mode: "blocked", allowed: false, acks: [], writes: [], reason: "storage-incompatible" };
  }
  const fills: Write[] = build.partitions
    .filter((q) => build.repurpose_fill.includes(q.name) && protectedNames(p).includes(q.name))
    .map((q) => ({ offset: q.offset, length: q.size, kind: "fill" as const, role: q.name }));
  // A fill erases data: its range must be exactly the policy's range for that protected partition, never the manifest's word.
  const ranges = protectedRanges(p);
  for (const f of fills) {
    const r = ranges.find((x) => x.name === f.role);
    if (ranges.length && (!r || r.offset !== f.offset || r.size !== f.length)) {
      return { mode: "blocked", allowed: false, acks: [], writes: [], reason: `the manifest's ${f.role} range differs from the policy` };
    }
  }
  return {
    mode: "repurpose",
    allowed: true,
    acks: acks("dev-firmware", "repurpose-typed"),
    // Fills first: if interrupted, the foreign table is still in place and the next run is detected as repurpose again.
    writes: [...fills, ...images],
    reason: table.detail,
  };
}
