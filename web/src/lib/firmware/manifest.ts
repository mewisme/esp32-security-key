// Validates firmware-manifest.json before anything from it is used. Mirrors the checks in
// tools/package_firmware.py and tools/flash_dev.py:check_images; any failure is `manifest-invalid` (no bypass).
import { ASSET_RE } from "../../../worker/routes";
import { FirmwareError } from "../errors/firmware-error";
import { type FlashPolicy, policy as defaultPolicy } from "./policy";
import type { Build, Manifest } from "./types";
import { parseSemver } from "./version";

const SHA256 = /^[0-9a-f]{64}$/;

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

function validateBuild(raw: unknown, i: number, version: string, tag: string, p: FlashPolicy): Build {
  const where = `builds[${i}]`;
  const b = obj(raw, where);
  str(b, "id", where);
  const image = str(b, "image", where);
  if (image !== "fido" && image !== "openpgp") fail(`${where}.image ${image} is unknown`);
  if (str(b, "project_name", where) !== `multikey-${image}`) fail(`${where}.project_name does not match image`);
  if (str(b, "version", where) !== version) fail(`${where}.version differs from the manifest version`);
  str(b, "title", where);
  str(b, "board", where);
  if (b.chip !== p.chip) fail(`${where}.chip is ${String(b.chip)}, expected ${p.chip}`);
  if (b.flash_size !== p.flash_size) fail(`${where}.flash_size is ${String(b.flash_size)}, expected ${p.flash_size}`);
  str(b, "flash_mode", where);
  str(b, "flash_freq", where);
  if (b.security_profile !== "development") fail(`${where}.security_profile must be development`);
  const usb = obj(b.usb, `${where}.usb`);
  int(usb, "vid", `${where}.usb`);
  int(usb, "pid", `${where}.usb`);
  const up = obj(b.user_presence, `${where}.user_presence`);
  int(up, "gpio", `${where}.user_presence`);

  const pkg = obj(b.package, `${where}.package`);
  const pkgName = str(pkg, "name", `${where}.package`);
  int(pkg, "size", `${where}.package`);
  if (!SHA256.test(str(pkg, "sha256", `${where}.package`))) fail(`${where}.package.sha256 is not lowercase hex`);
  const m = ASSET_RE.exec(pkgName);
  if (!m || m[2] !== version || m[3] !== image) fail(`${where}.package.name ${pkgName} is not allowed for ${tag}`);

  const partitions = arr(b, "partitions", where).map((x, j) => {
    const w = `${where}.partitions[${j}]`;
    const q = obj(x, w);
    return { name: str(q, "name", w), type: str(q, "type", w), subtype: str(q, "subtype", w), offset: int(q, "offset", w), size: int(q, "size", w) };
  });
  const byName = new Map(partitions.map((q) => [q.name, q]));
  for (const name of p.protected_partitions) {
    if (!byName.has(name)) fail(`${where}.partitions has no ${name}`);
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
    for (const name of p.protected_partitions) {
      const q = byName.get(name)!;
      if (img.offset < q.offset + q.size && end > q.offset) fail(`${where}: ${img.file} overlaps protected partition ${name}`);
    }
  }

  const fill = strings(b, "repurpose_fill", where);
  for (const name of fill) {
    if (!p.protected_partitions.includes(name) || !byName.has(name)) fail(`${where}.repurpose_fill ${name} is not a protected partition`);
  }
  strings(b, "protected_partitions", where);
  const update = obj(b.update, `${where}.update`);
  if (!parseSemver(str(update, "data_preserving_from", `${where}.update`))) fail(`${where}.update.data_preserving_from is not semver`);
  return b as unknown as Build;
}

/**
 * Throws FirmwareError("manifest-invalid") unless `json` is a schema-1 manifest for `expectedTag` that only writes the
 * policy's allowed regions. Tag "local" (a developer's own build) is accepted only when `allowLocal` (dev server).
 */
export function validateManifest(
  json: unknown,
  expectedTag: string,
  allowLocal: boolean = import.meta.env.DEV,
  p: FlashPolicy = defaultPolicy,
): Manifest {
  const m = obj(json, "manifest");
  if (m.schema !== "multikeys-firmware-manifest") fail("schema is not multikeys-firmware-manifest");
  if (m.schema_version !== 1) fail(`unsupported schema_version ${String(m.schema_version)}`);
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
  const validated = builds.map((b, i) => validateBuild(b, i, version, tag, p));
  if (new Set(validated.map((b) => b.id)).size !== validated.length) fail("duplicate build ids");
  return m as unknown as Manifest;
}
