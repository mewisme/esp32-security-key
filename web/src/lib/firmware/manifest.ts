// Validates firmware-manifest.json before anything from it is used. Mirrors the checks in
// tools/package_firmware.py and tools/flash_dev.py:check_images; any failure is `manifest-invalid` (no bypass).
// Schema 2 (profile_id per build) is validated against tools/flash_policy.json; schema 1 (the published v0.2.0 manifest)
// is accepted through an explicit mapping and normalised into the same `Build` shape.
import { ASSET_RE } from "../../../worker/routes";
import { validateDeviceName } from "../device/device-name";
import { FirmwareError } from "../errors/firmware-error";
import { type FlashPolicy, policy as defaultPolicy, profileById, protectedNames, protectedRanges } from "./policy";
import type { Build, Manifest, Verification } from "./types";
import { parseSemver } from "./version";

const SHA256 = /^[0-9a-f]{64}$/;

// What a schema-1 build always was: 16 MB flash, the N16R8-named BOOT-button board, USB name from the build defaults.
const V1_FLASH_SIZE = "16MB";
const V1_BOARD = "esp32s3-n16r8-boot-button";
const V1_PRODUCT_NAME = "MultiKeys Security Key";

type Obj = Record<string, unknown>;

function fail(detail: string): never {
  throw new FirmwareError("manifest-invalid", detail);
}

function obj(v: unknown, where: string): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${where} is not an object`);
  return v as Obj;
}

function str(o: Obj, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== "string" || !v) fail(`${where}.${k} is not a non-empty string`);
  return v;
}

function int(o: Obj, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) fail(`${where}.${k} is not a non-negative integer`);
  return v;
}

function arr(o: Obj, k: string, where: string): unknown[] {
  const v = o[k];
  if (!Array.isArray(v)) fail(`${where}.${k} is not an array`);
  return v;
}

function strings(o: Obj, k: string, where: string): string[] {
  const a = arr(o, k, where);
  if (!a.every((x) => typeof x === "string")) fail(`${where}.${k} must contain strings`);
  return a as string[];
}

/** The hardware-profile part of a build: derived for schema 1, read and checked against the policy for schema 2. */
interface ProfileFields {
  profile_id: string;
  flash_interface: "quad";
  psram_required: boolean;
  partition_schema: string;
  verified_hardware: string[];
  verification: Verification;
  product_name: string;
  custom_name: boolean;
  /** The `hw` part of the package name this build must have. */
  assetHw: string;
}

function profileFieldsV1(b: Obj, where: string, p: FlashPolicy): ProfileFields {
  const id = str(b, "id", where);
  // Own keys only: "constructor" or "__proto__" must not resolve to something on Object.prototype.
  const profileId = Object.hasOwn(p.legacy_builds, id) ? p.legacy_builds[id] : undefined;
  if (!profileId || !profileById(profileId, p)) fail(`${where}.id ${id} is not a known schema-1 build`);
  if (b.flash_size !== V1_FLASH_SIZE) fail(`${where}.flash_size is ${String(b.flash_size)}, expected ${V1_FLASH_SIZE}`);
  if (b.board !== V1_BOARD) fail(`${where}.board is ${String(b.board)}, expected ${V1_BOARD}`);
  return {
    profile_id: profileId,
    flash_interface: "quad",
    psram_required: false,
    partition_schema: str(b, "layout_id", where),
    verified_hardware: [],
    verification: b.verification === "hardware-verified" ? "hardware-verified" : "build-verified",
    product_name: V1_PRODUCT_NAME,
    custom_name: true,
    assetHw: "n16r8",
  };
}

function profileFieldsV2(b: Obj, usb: Obj, where: string, p: FlashPolicy): ProfileFields {
  const profileId = str(b, "profile_id", where);
  const prof = profileById(profileId, p);
  if (!prof) fail(`${where}.profile_id ${profileId} is not a known hardware profile`);
  for (const k of ["flash_size", "flash_mode", "flash_freq", "flash_interface"] as const) {
    if (b[k] !== prof[k]) fail(`${where}.${k} is ${String(b[k])}, profile ${prof.id} needs ${prof[k]}`);
  }
  if (b.psram_required !== prof.psram_required) {
    fail(`${where}.psram_required is ${String(b.psram_required)}, profile ${prof.id} needs ${String(prof.psram_required)}`);
  }
  if (b.verification !== "hardware-verified" && b.verification !== "build-verified") {
    fail(`${where}.verification is ${String(b.verification)}`);
  }
  const productName = str(usb, "product_name", `${where}.usb`);
  if (validateDeviceName(productName) !== null) fail(`${where}.usb.product_name is not a valid device name`);
  if (typeof usb.custom_name !== "boolean") fail(`${where}.usb.custom_name is not a boolean`);
  return {
    profile_id: prof.id,
    flash_interface: "quad",
    psram_required: prof.psram_required,
    partition_schema: str(b, "partition_schema", where),
    verified_hardware: strings(b, "verified_hardware", where),
    verification: b.verification,
    product_name: productName,
    custom_name: usb.custom_name,
    assetHw: prof.id.replace("esp32s3-", ""),
  };
}

function validateBuild(raw: unknown, i: number, version: string, tag: string, schema: 1 | 2, p: FlashPolicy): Build {
  const where = `builds[${i}]`;
  const b = obj(raw, where);
  const entry = structuredClone(b);
  str(b, "id", where);
  const image = str(b, "image", where);
  if (image !== "fido" && image !== "openpgp") fail(`${where}.image ${image} is unknown`);
  if (str(b, "project_name", where) !== `multikey-${image}`) fail(`${where}.project_name does not match image`);
  if (str(b, "version", where) !== version) fail(`${where}.version differs from the manifest version`);
  str(b, "title", where);
  str(b, "board", where);
  if (b.chip !== p.chip) fail(`${where}.chip is ${String(b.chip)}, expected ${p.chip}`);
  str(b, "flash_mode", where);
  str(b, "flash_freq", where);
  if (b.security_profile !== "development") fail(`${where}.security_profile must be development`);
  const usb = obj(b.usb, `${where}.usb`);
  const vid = int(usb, "vid", `${where}.usb`);
  const pid = int(usb, "pid", `${where}.usb`);
  if (vid !== p.native_usb.app[0] || pid !== p.native_usb.app[1]) {
    fail(`${where}.usb is ${vid.toString(16)}:${pid.toString(16)}, the policy requires ${p.native_usb.app[0].toString(16)}:${p.native_usb.app[1].toString(16)}`);
  }
  const up = obj(b.user_presence, `${where}.user_presence`);
  int(up, "gpio", `${where}.user_presence`);
  const hw = schema === 1 ? profileFieldsV1(b, where, p) : profileFieldsV2(b, usb, where, p);

  const pkg = obj(b.package, `${where}.package`);
  const pkgName = str(pkg, "name", `${where}.package`);
  int(pkg, "size", `${where}.package`);
  if (!SHA256.test(str(pkg, "sha256", `${where}.package`))) fail(`${where}.package.sha256 is not lowercase hex`);
  const g = ASSET_RE.exec(pkgName)?.groups;
  if (!g || g.version !== version || g.image !== image || g.hw !== hw.assetHw) {
    fail(`${where}.package.name ${pkgName} is not allowed for ${tag}`);
  }

  const partitions = arr(b, "partitions", where).map((x, j) => {
    const w = `${where}.partitions[${j}]`;
    const q = obj(x, w);
    return { name: str(q, "name", w), type: str(q, "type", w), subtype: str(q, "subtype", w), offset: int(q, "offset", w), size: int(q, "size", w) };
  });
  const byName = new Map(partitions.map((q) => [q.name, q]));
  for (const name of protectedNames(p)) {
    if (!byName.has(name)) fail(`${where}.partitions has no ${name}`);
  }
  for (const r of protectedRanges(p)) {
    const q = byName.get(r.name)!;
    if (q.offset !== r.offset || q.size !== r.size) {
      fail(`${where}.partitions ${r.name} is at 0x${q.offset.toString(16)}+0x${q.size.toString(16)}, the policy requires 0x${r.offset.toString(16)}+0x${r.size.toString(16)}`);
    }
  }

  const images = arr(b, "images", where).map((x, j) => {
    const w = `${where}.images[${j}]`;
    const q = obj(x, w);
    const sha = str(q, "sha256", w);
    if (!SHA256.test(sha)) fail(`${w}.sha256 is not lowercase hex`);
    return { role: str(q, "role", w), file: str(q, "file", w), offset: int(q, "offset", w), size: int(q, "size", w), sha256: sha };
  });
  const want = p.allowed_writes.map((w) => `${w.role}@${w.offset}`).sort();
  const got = images.map((x) => `${x.role}@${x.offset}`).sort();
  if (want.join() !== got.join()) fail(`${where}.images must be exactly ${want.join(", ")} (got ${got.join(", ")})`);
  for (const img of images) {
    if (img.size === 0) fail(`${where}: ${img.file} is empty`);
    const rule = p.allowed_writes.find((w) => w.role === img.role)!;
    if (rule.max_size !== undefined && img.size > rule.max_size) fail(`${where}: ${img.file} is larger than ${rule.max_size} bytes`);
    if (rule.partition) {
      const part = byName.get(rule.partition);
      if (!part) fail(`${where}.partitions has no ${rule.partition}`);
      if (img.size > part.size) fail(`${where}: ${img.file} is larger than the ${rule.partition} partition`);
    }
    const end = img.offset + img.size;
    for (const name of protectedNames(p)) {
      const q = byName.get(name)!;
      if (img.offset < q.offset + q.size && end > q.offset) fail(`${where}: ${img.file} overlaps protected partition ${name}`);
    }
  }

  const fill = strings(b, "repurpose_fill", where);
  for (const name of fill) {
    if (!protectedNames(p).includes(name) || !byName.has(name)) fail(`${where}.repurpose_fill ${name} is not a protected partition`);
  }
  strings(b, "protected_partitions", where);
  const update = obj(b.update, `${where}.update`);
  if (!parseSemver(str(update, "data_preserving_from", `${where}.update`))) fail(`${where}.update.data_preserving_from is not semver`);
  if (update.downgrade_floor !== undefined && update.downgrade_floor !== null && (typeof update.downgrade_floor !== "string" || !parseSemver(update.downgrade_floor))) {
    fail(`${where}.update.downgrade_floor is not semver`);
  }
  if (update.app_only !== undefined && typeof update.app_only !== "boolean") fail(`${where}.update.app_only is not a boolean`);

  const { assetHw: _assetHw, product_name, custom_name, ...profileFields } = hw;
  void _assetHw;
  return {
    ...b,
    ...profileFields,
    usb: { ...usb, product_name, custom_name },
    legacy: schema === 1,
    entry,
  } as unknown as Build;
}

/**
 * Throws FirmwareError("manifest-invalid") unless `json` is a schema-1 or schema-2 manifest for `expectedTag` that only
 * writes the policy's allowed regions. Tag "local" (a developer's own build) is accepted only when `allowLocal` (dev server).
 */
export function validateManifest(
  json: unknown,
  expectedTag: string,
  allowLocal: boolean = import.meta.env.DEV,
  p: FlashPolicy = defaultPolicy,
): Manifest {
  const m = obj(json, "manifest");
  if (m.schema !== "multikeys-firmware-manifest") fail("schema is not multikeys-firmware-manifest");
  if (m.schema_version !== 1 && m.schema_version !== 2) fail(`unsupported schema_version ${String(m.schema_version)}`);
  const schema = m.schema_version;
  const tag = str(m, "tag", "manifest");
  const version = str(m, "version", "manifest");
  if (tag !== expectedTag) fail(`manifest tag ${tag} differs from release ${expectedTag}`);
  if (tag === "local") {
    if (!allowLocal) fail("local manifests are only accepted by the development server");
    if (!parseSemver(version)) fail("version is not semver");
  } else if (version !== tag.slice(1)) {
    fail(`version ${version} does not match tag ${tag}`);
  }
  str(m, "source_commit", "manifest");
  str(m, "repository", "manifest");
  const builds = arr(m, "builds", "manifest");
  if (!builds.length) fail("manifest has no builds");
  const validated = builds.map((b, i) => validateBuild(b, i, version, tag, schema, p));
  if (new Set(validated.map((b) => b.id)).size !== validated.length) fail("duplicate build ids");
  if (new Set(validated.map((b) => `${b.image}/${b.profile_id}`)).size !== validated.length) {
    fail("duplicate builds for one image and hardware profile");
  }
  return { ...m, builds: validated } as unknown as Manifest;
}
