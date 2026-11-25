// Every safety decision of the application-only firmware update lives here (docs/SECURITY.md, "Application-only update").
// The update writes exactly one region: the app image inside the `factory` partition. It never touches the bootloader,
// the partition table, nvs, phy_init or part0, and it is not atomic (a single slot: an interrupted write leaves the key
// unbootable until the app is written again from download mode). It is allowed only when the release declares
// `update.app_only`, the device layout equals the release layout, and the installed image is the same MultiKeys family
// at a version whose stored data the release declares compatible. Anything not shown compatible is refused.
import { type FlashPolicy, policy as defaultPolicy, protectedNames } from "../firmware/policy";
import type { Build } from "../firmware/types";
import { compareSemver } from "../firmware/version";
import { parseAppDescriptor } from "./app-descriptor";
import type { AckId, Write } from "./install-mode";
import { parsePartitionTable } from "./partition-table";

export type AppUpdateOutcome =
  | "safe-update"
  | "repair"
  | "reinstall"
  | "downgrade"
  | "incompatible"
  | "unknown"
  | "different-family"
  | "not-multikeys"
  | "release-unsupported";

export type AppUpdateReason =
  | "ok"
  | "interrupted-write"
  | "same-version-different-image"
  | "downgrade"
  | "storage"
  | "layout"
  | "app-too-large"
  | "protected-overlap"
  | "flash-profile"
  | "different-family"
  | "reinstall"
  | "different-key"
  | "not-multikeys"
  | "release-unsupported"
  | "unreadable-bootloader"
  | "unreadable-descriptor"
  | "recovery-unverified"
  | "unparsable-version"
  | "downgrade-declared";

/**
 * Written before the app write starts and removed after the flash MD5 matched: its presence means a write may be
 * incomplete. `v` 2 records name the chip (ROM-mode MAC), the release and the exact application image; `v` 1 records
 * (older pages) do not, so they are kept only to be reported and discarded, never used to justify a repair.
 */
export interface PendingUpdate {
  v: 1 | 2;
  project: string;
  imageFamily: "fido" | "openpgp" | null;
  fromVersion: string | null;
  toVersion: string;
  tag: string;
  profileId: string;
  appSha256: string;
  /** ROM-mode MAC of the chip the write started on; null when it could not be read (then no recovery is offered). */
  chipMac: string | null;
  startedAt: string;
}

/** A record older than this no longer describes the key on the desk. */
export const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingCheck = { ok: true } | { ok: false; detail: string };

/**
 * Whether an interrupted-write record may justify rewriting an application that cannot be read. It must be a current
 * record for exactly this release, image family, profile and application SHA-256, made on a chip whose ROM-mode MAC
 * equals the one read now. The running firmware's WebUSB identity is not linked to the ROM MAC, so this proves
 * "the same chip as when the write started" as far as a MAC does (it is not a secret), and nothing when either MAC is
 * unknown; those cases are refused and the person is sent to the installer.
 */
export function checkPending(
  pending: PendingUpdate,
  build: Build,
  tag: string,
  appSha256: string,
  chipMac: string | null,
  now: number,
): PendingCheck {
  const no = (detail: string): PendingCheck => ({ ok: false, detail });
  if (pending.v !== 2) return no("the record was written by an older version of this page and does not identify the chip");
  const age = now - Date.parse(pending.startedAt);
  if (!Number.isFinite(age) || age < 0 || age > PENDING_MAX_AGE_MS) return no("the record is older than 7 days or has no valid date");
  if (pending.project !== build.project_name || pending.imageFamily !== build.image || pending.profileId !== build.profile_id) {
    return no(`the record is for ${pending.project} (${pending.profileId}), not for ${build.project_name} (${build.profile_id})`);
  }
  if (pending.tag !== tag || pending.appSha256 !== appSha256) return no(`the record is for ${pending.tag}; choose that release to recover`);
  if (pending.chipMac === null || chipMac === null) return no("the chip's MAC address could not be read, so it cannot be matched to the interrupted write");
  if (pending.chipMac.toLowerCase() !== chipMac.toLowerCase()) return no("the chip in download mode is not the chip the interrupted write started on");
  return { ok: true };
}

/** What the running firmware told the page over WebUSB before the key was put into download mode. */
export interface UpdateBaseline {
  project: string | null;
  version: string | null;
  flashSize: string | null;
}

export interface AppUpdateDecision {
  mode: "app-only-update" | "blocked";
  outcome: AppUpdateOutcome;
  allowed: boolean;
  reason: AppUpdateReason;
  /** English diagnostic for the details line. */
  detail: string;
  acks: AckId[];
  /** Length 0 or 1: the app image, role "app". */
  writes: Write[];
  installed: { project: string | null; version: string | null };
  target: { project: string; version: string; tag: string };
}

export interface AppUpdateInput {
  /** Bytes read at policy.partition_table.offset. */
  table: Uint8Array;
  /** Bytes read at policy.app_descriptor.offset. */
  appDesc: Uint8Array;
  /** First 16 bytes of the flash (the bootloader image header). */
  bootHeader: Uint8Array;
  /** MD5 of the flash at the app offset over the target image length, or null when it could not be read. */
  installedAppMd5: string | null;
  /** MD5 of the target app image as downloaded and verified. */
  targetAppMd5: string;
  /** First 16 bytes of the target app image. */
  targetAppHeader: Uint8Array;
  build: Build;
  /** Release tag the build comes from (the manifest's `tag`). */
  tag: string;
  pending?: PendingUpdate | null;
  /** MAC address of the chip in ROM download mode right now (esptool), or null when it could not be read. */
  chipMac?: string | null;
  /** Clock for the age of the pending record (milliseconds since the epoch); defaults to Date.now(). */
  now?: number;
  baseline?: UpdateBaseline | null;
  /** The board's flash size is not hardware verified (4 and 8 MB): the person must acknowledge it first. */
  untestedHardware?: boolean;
  /** True when the release manifest carries no valid signature: the person must acknowledge that first. */
  unsignedRelease?: boolean;
  /**
   * `update.downgrade_floor` of the release the installed application comes from (looked up by its version in the
   * catalog); null when that release is unknown or does not declare one.
   */
  installedDowngradeFloor?: string | null;
  policy?: FlashPolicy;
}

const IMAGE_MAGIC = 0xe9;
const TABLE_SECTOR = 0x1000;
const APP_PARTITION = "factory";

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function decideAppUpdate(input: AppUpdateInput): AppUpdateDecision {
  const { build, pending = null, baseline = null, untestedHardware = false, unsignedRelease = false } = input;
  const p = input.policy ?? defaultPolicy;
  const appImage = build.images.find((i) => i.role === "app");
  const rule = p.allowed_writes.find((w) => w.role === "app");
  const desc = parseAppDescriptor(input.appDesc);
  const installed = { project: desc?.project_name ?? null, version: desc?.version ?? null };
  const target = { project: build.project_name, version: build.version, tag: input.tag };

  const refuse = (outcome: AppUpdateOutcome, reason: AppUpdateReason, detail: string): AppUpdateDecision => ({
    mode: "blocked",
    outcome,
    allowed: false,
    reason,
    detail,
    acks: [],
    writes: [],
    installed,
    target,
  });

  // 1. The release must declare the capability; an absent field is never read as compatible.
  if (build.update.app_only !== true || !appImage || !rule || appImage.offset !== rule.offset) {
    return refuse("release-unsupported", "release-unsupported", `release ${build.version} does not declare an application-only update`);
  }
  if (rule.max_size !== undefined && appImage.size > rule.max_size) {
    return refuse("release-unsupported", "release-unsupported", `app image is larger than ${rule.max_size} bytes`);
  }

  // 2. The device layout must be this release's layout entry for entry (not merely compatible in its protected
  //    partitions), with the app partition where the image goes.
  const table = parsePartitionTable(input.table, build.partitions, p, build.flash_size);
  if (table.status === "blank" || table.status === "garbage") {
    return refuse("not-multikeys", "not-multikeys", table.detail);
  }
  if (table.status !== "match" || !table.entries) return refuse("incompatible", "layout", table.detail);
  if (!table.exact) return refuse("incompatible", "layout", table.layoutDetail ?? table.detail);
  const factory = table.entries.get(APP_PARTITION);
  if (!factory || factory.type !== 0 || factory.offset !== appImage.offset) {
    return refuse("incompatible", "layout", `the device has no app partition "${APP_PARTITION}" at 0x${appImage.offset.toString(16)}`);
  }
  if (appImage.size > factory.size) {
    return refuse("incompatible", "app-too-large", `app image ${appImage.size} bytes, partition ${factory.size} bytes`);
  }

  // 3. Defence in depth: the single write must stay clear of the bootloader, the table and every protected partition.
  const start = appImage.offset;
  const end = start + appImage.size;
  if (start < p.partition_table.offset + TABLE_SECTOR) {
    return refuse("incompatible", "protected-overlap", "the write would reach the bootloader or the partition table");
  }
  for (const name of protectedNames(p)) {
    const e = table.entries.get(name);
    if (!e || overlaps(start, end, e.offset, e.offset + e.size)) {
      return refuse("incompatible", "protected-overlap", `the write would reach ${name}`);
    }
  }

  // 4. The bootloader on the key and the new app must be for the same flash size.
  const boot = input.bootHeader;
  const head = input.targetAppHeader;
  if (boot.length < 4 || boot[0] !== IMAGE_MAGIC) {
    return refuse("unknown", "unreadable-bootloader", "the bootloader image header is missing");
  }
  if (head.length < 4 || head[0] !== IMAGE_MAGIC || head[3]! >> 4 !== boot[3]! >> 4) {
    return refuse("incompatible", "flash-profile", "the flash size in the bootloader differs from the flash size of this build");
  }

  // 5. The installed app: valid descriptor, a MultiKeys image, the family of this build, the key that was inspected.
  const inst = installed.version;
  if (!desc || !inst) {
    if (pending === null) return refuse("unknown", "unreadable-descriptor", "the installed application has no readable descriptor");
    const check = checkPending(pending, build, input.tag, appImage.sha256, input.chipMac ?? null, input.now ?? Date.now());
    if (!check.ok) return refuse("unknown", "recovery-unverified", check.detail);
    return {
      mode: "app-only-update",
      outcome: "repair",
      allowed: true,
      reason: "interrupted-write",
      detail: "an earlier application write of this release did not finish on this chip",
      acks: acksFor("repair", build, untestedHardware, unsignedRelease),
      writes: [appWrite(appImage)],
      installed,
      target,
    };
  }
  if (!desc.project_name.startsWith("multikey-")) {
    return refuse("not-multikeys", "not-multikeys", `installed application is ${desc.project_name}`);
  }
  if (baseline && ((baseline.version !== null && baseline.version !== desc.version) || (baseline.project !== null && baseline.project !== desc.project_name) ||
    (baseline.flashSize !== null && baseline.flashSize !== build.flash_size))) {
    return refuse("unknown", "different-key", "the key in download mode differs from the key that was inspected");
  }
  if (desc.project_name !== build.project_name) {
    return refuse("different-family", "different-family", `installed ${desc.project_name}, this build is ${build.project_name}`);
  }

  // 6. The flash content, not the version string, says whether there is anything to do.
  if (input.installedAppMd5 !== null && input.installedAppMd5 === input.targetAppMd5) {
    // Nothing differs, so this is only ever a deliberate rewrite of the same application: the same single app write,
    // with the same layout, family and flash-size checks as above, and the person confirms it.
    return {
      mode: "app-only-update",
      outcome: "reinstall",
      allowed: true,
      reason: "reinstall",
      detail: `installed ${inst} is byte-identical to this build; the application is written again`,
      acks: acksFor("reinstall", build, untestedHardware, unsignedRelease),
      writes: [appWrite(appImage)],
      installed,
      target,
    };
  }

  // 7. Version order and the release's declared data compatibility.
  const order = compareSemver(inst, build.version);
  if (order === null) return refuse("unknown", "unparsable-version", `installed version ${inst} is not a version number`);
  if (order > 0) {
    // Newer than this release: allowed only when the INSTALLED release declared that the data it writes stays readable
    // down to this version (`update.downgrade_floor`, looked up by the caller). Absent or higher than this version: refused.
    const floor = input.installedDowngradeFloor ?? null;
    if (floor === null || (compareSemver(build.version, floor) ?? -1) < 0) {
      return refuse(
        "downgrade",
        "downgrade",
        floor === null
          ? `installed ${inst} does not declare that older versions can read its data`
          : `installed ${inst} declares its data readable only down to ${floor}, not ${build.version}`,
      );
    }
    return {
      mode: "app-only-update",
      outcome: "downgrade",
      allowed: true,
      reason: "downgrade-declared",
      detail: `${inst} to ${build.version}; the installed release declares its data readable down to ${floor}`,
      acks: acksFor("downgrade", build, untestedHardware, unsignedRelease),
      writes: [appWrite(appImage)],
      installed,
      target,
    };
  }
  if (order === 0) {
    return {
      mode: "app-only-update",
      outcome: "repair",
      allowed: true,
      reason: "same-version-different-image",
      detail: `installed ${inst} has the same version as this build but different content`,
      acks: acksFor("repair", build, untestedHardware, unsignedRelease),
      writes: [appWrite(appImage)],
      installed,
      target,
    };
  }
  const from = compareSemver(inst, build.update.data_preserving_from);
  if (from === null || from < 0) {
    return refuse("incompatible", "storage", `installed ${inst} is older than ${build.update.data_preserving_from}, the oldest version whose stored data this release declares compatible`);
  }

  // 8. Compatible.
  return {
    mode: "app-only-update",
    outcome: "safe-update",
    allowed: true,
    reason: "ok",
    detail: `${inst} to ${build.version}`,
    acks: acksFor("safe-update", build, untestedHardware, unsignedRelease),
    writes: [appWrite(appImage)],
    installed,
    target,
  };
}

function appWrite(image: { offset: number; size: number }): Write {
  return { offset: image.offset, length: image.size, kind: "image", role: "app" };
}

function acksFor(outcome: "safe-update" | "repair" | "reinstall" | "downgrade", build: Build, untestedHardware: boolean, unsignedRelease: boolean): AckId[] {
  const acks: AckId[] = ["app-write-confirm"];
  if (outcome === "downgrade") acks.push("downgrade-confirm");
  if (untestedHardware) acks.push("untested-hardware");
  if (build.image === "openpgp") acks.push("experimental-image");
  if (unsignedRelease) acks.push("unsigned-release");
  if (outcome === "repair") acks.push("repair-typed");
  return acks;
}
