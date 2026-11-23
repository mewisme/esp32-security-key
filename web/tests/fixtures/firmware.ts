// Synthetic firmware releases used by unit and e2e tests: same shapes tools/package_firmware.py produces.
import { zipSync } from "fflate";
import { FALLBACK_DEFAULT_NAME } from "../../src/lib/device/device-name";
import { type HardwareProfile, policy } from "../../src/lib/firmware/policy";
import type { Build, Manifest, ManifestPartition } from "../../src/lib/firmware/types";

export const PARTITIONS: ManifestPartition[] = [
  { name: "nvs", type: "data", subtype: "nvs", offset: 0x11000, size: 0x6000 },
  { name: "phy_init", type: "data", subtype: "phy", offset: 0x17000, size: 0x1000 },
  { name: "factory", type: "app", subtype: "factory", offset: 0x20000, size: 0x1e0000 },
  { name: "part0", type: "0x40", subtype: "0x1", offset: 0x200000, size: 0x100000 },
];

const LAYOUT_ID = "mk16-6cd2ee28a4a9";
const SIZE_CODE: Record<string, number> = { "4MB": 2, "8MB": 3, "16MB": 4 };

function entry(label: string, type: number, subtype: number, offset: number, size: number): Uint8Array {
  const e = new Uint8Array(32);
  const v = new DataView(e.buffer);
  e.set([0xaa, 0x50, type, subtype]);
  v.setUint32(4, offset, true);
  v.setUint32(8, size, true);
  e.set(new TextEncoder().encode(label), 12);
  return e;
}

/** A partition table as stored at 0x8000 (0xC00 bytes, 0xFF padded). */
export function partitionTable(opts: { part0Offset?: number; terminated?: boolean } = {}): Uint8Array {
  const out = new Uint8Array(0xc00).fill(0xff);
  const rows = [
    entry("nvs", 1, 2, 0x11000, 0x6000),
    entry("phy_init", 1, 1, 0x17000, 0x1000),
    entry("factory", 0, 0, 0x20000, 0x1e0000),
    entry("part0", 0x40, 1, opts.part0Offset ?? 0x200000, 0x100000),
  ];
  rows.forEach((r, i) => out.set(r, i * 32));
  if (opts.terminated !== false) {
    out.set([0xeb, 0xeb], rows.length * 32);
  } else {
    // fill the remainder with valid-looking entries so no terminator is ever seen
    for (let i = rows.length; i < 0xc00 / 32; i++) out.set(entry(`x${i}`, 1, 1, 0x300000 + i * 0x1000, 0x1000), i * 32);
  }
  return out;
}

/** First bytes of an app image with an esp_app_desc_t for `project` / `version`. */
export function appImage(version: string, project = "multikey-fido", size = 0x4000): Uint8Array {
  const out = new Uint8Array(size).fill(0x5a);
  out.fill(0, 0, 0x120);
  out[0] = 0xe9;
  const d = 0x20;
  new DataView(out.buffer).setUint32(d, 0xabcd5432, true);
  const put = (s: string, at: number) => out.set(new TextEncoder().encode(s), d + at);
  put(version, 16);
  put(project, 48);
  put("12:00:00", 80);
  put("Nov 23 2026", 96);
  put("v5.5.6", 112);
  return out;
}

export async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  2);
}

/** A manifest build exactly as it is published (no normalisation fields). */
export type RawBuild = Omit<Build, "legacy" | "entry">;
export type RawManifest = Omit<Manifest, "builds"> & { builds: RawBuild[] };

export interface FirmwareFixture {
  /** The JSON a release serves as firmware-manifest.json. */
  manifest: RawManifest;
  /** Normalised build of the first (default 16 MB) profile. */
  build: Build;
  /** Normalised builds, in manifest order. */
  builds: Build[];
  /** Package zips by package file name. */
  zips: Map<string, Uint8Array>;
  /** Zip of `build`. */
  zip: Uint8Array;
  images: { bootloader: Uint8Array; table: Uint8Array; app: Uint8Array };
}

interface Options {
  version?: string;
  tag?: string;
  extraMember?: boolean;
}

type Common = Pick<
  RawBuild,
  | "image" | "project_name" | "version" | "title" | "chip" | "security_profile" | "idf_version" | "user_presence" | "led"
  | "partitions" | "layout_id" | "protected_partitions" | "repurpose_fill" | "update" | "install_modes"
>;

function common(version: string): Common {
  return {
    image: "fido",
    project_name: "multikey-fido",
    version,
    title: "MultiKeys FIDO2 — Development Firmware",
    chip: "ESP32-S3",
    security_profile: "development",
    idf_version: "v5.5.6",
    user_presence: { gpio: 0, active_low: true },
    led: "none",
    partitions: PARTITIONS,
    layout_id: LAYOUT_ID,
    protected_partitions: ["nvs", "phy_init", "part0"],
    repurpose_fill: ["nvs", "part0"],
    update: { data_preserving_from: "0.2.0" },
    install_modes: ["first-install", "update", "update-unverified", "switch-image", "replace-compatible-layout", "repurpose"],
  };
}

interface Packaged {
  /** The published entry: `entry` plus its images and package fields. */
  published: Record<string, unknown>;
  zip: Uint8Array;
  images: FirmwareFixture["images"];
}

/** Writes the zip for `entry` (firmware.json inside it is the published entry minus `package`). */
async function pack(entryNoImages: object, packageName: string, flashSize: string, opts: Options & { version: string }): Promise<Packaged> {
  const header = [0x02, (SIZE_CODE[flashSize]! << 4) | 0xf]; // image header bytes 2-3: dio, flash size | 80 MHz
  const bootloader = new Uint8Array(0x5000).fill(0x11);
  bootloader.set([0xe9, 0x03, ...header]);
  const table = partitionTable();
  const app = appImage(opts.version);
  app.set(header, 2);
  const withImages = {
    ...entryNoImages,
    images: [
      { role: "bootloader", file: "bootloader.bin", offset: 0, size: bootloader.length, sha256: await sha256(bootloader) },
      { role: "partition-table", file: "partition-table.bin", offset: 0x8000, size: table.length, sha256: await sha256(table) },
      { role: "app", file: "multikey-fido.bin", offset: 0x20000, size: app.length, sha256: await sha256(app) },
    ],
  };
  const root = packageName.replace(/\.zip$/, "");
  const enc = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    [`${root}/bootloader.bin`]: bootloader,
    [`${root}/partition-table.bin`]: table,
    [`${root}/multikey-fido.bin`]: app,
    [`${root}/firmware.json`]: enc.encode(canonicalJson(withImages) + "\n"),
    [`${root}/SHA256SUMS`]: enc.encode("sums\n"),
    [`${root}/LICENSE`]: enc.encode("AGPL\n"),
    [`${root}/NOTICE.txt`]: enc.encode("notice\n"),
    [`${root}/README.txt`]: enc.encode("readme\n"),
  };
  if (opts.extraMember) files[`${root}/extra.bin`] = new Uint8Array([1, 2, 3]);
  const zip = zipSync(files, { mtime: new Date("1980-01-01T00:00:00Z") });
  return {
    published: { ...withImages, package: { name: packageName, size: zip.length, sha256: await sha256(zip) } },
    zip,
    images: { bootloader, table, app },
  };
}

function v2Entry(version: string, prof: HardwareProfile): Omit<RawBuild, "package" | "images"> {
  return {
    ...common(version),
    id: `${prof.id}-fido-dev`,
    board: prof.board,
    flash_size: prof.flash_size,
    flash_mode: prof.flash_mode,
    flash_freq: prof.flash_freq,
    profile_id: prof.id,
    flash_interface: prof.flash_interface,
    psram_required: prof.psram_required,
    partition_schema: LAYOUT_ID,
    verified_hardware: prof.verified_hardware.map((v) => v.label),
    verification: prof.verification,
    usb: { vid: 0x303a, pid: 0x4002, webusb_landing_url: "https://multikeys.mewis.me", product_name: FALLBACK_DEFAULT_NAME, custom_name: true },
  };
}

/** A schema-2 release. `profiles` defaults to every profile of tools/flash_policy.json, the 16 MB one first. */
export async function makeFirmware(opts: Options & { profiles?: string[] } = {}): Promise<FirmwareFixture> {
  const version = opts.version ?? "0.2.0";
  const tag = opts.tag ?? `v${version}`;
  const ids = opts.profiles ?? [policy.default_profile, ...policy.profiles.map((p) => p.id).filter((id) => id !== policy.default_profile)];
  const packed: { raw: RawBuild; zip: Uint8Array; images: FirmwareFixture["images"] }[] = [];
  for (const id of ids) {
    const prof = policy.profiles.find((p) => p.id === id)!;
    const name = `multikey-firmware-v${version}-${prof.id}-fido-dev.zip`;
    const p = await pack(v2Entry(version, prof), name, prof.flash_size, { ...opts, version });
    packed.push({ raw: p.published as unknown as RawBuild, zip: p.zip, images: p.images });
  }
  const manifest: RawManifest = {
    schema: "multikeys-firmware-manifest",
    schema_version: 2,
    version,
    tag,
    source_commit: "a".repeat(40),
    repository: "mewisme/esp32-security-key",
    builds: packed.map((p) => p.raw).sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  const normalised = (raw: RawBuild): Build => ({ ...raw, legacy: false, entry: structuredClone(raw) as unknown as Record<string, unknown> });
  const first = packed[0]!;
  return {
    manifest,
    build: normalised(first.raw),
    builds: manifest.builds.map(normalised),
    zips: new Map(packed.map((p) => [p.raw.package.name, p.zip])),
    zip: first.zip,
    images: first.images,
  };
}

/** The published v0.2.0 shape: schema 1, one 16 MB build named for the N16R8 board, none of the schema-2 fields. */
export async function makeLegacyFirmware(opts: Options = {}): Promise<FirmwareFixture> {
  const version = opts.version ?? "0.2.0";
  const tag = opts.tag ?? `v${version}`;
  const name = `multikey-firmware-v${version}-esp32s3-n16r8-fido-dev.zip`;
  const { published, zip, images } = await pack(
    {
      ...common(version),
      id: "esp32s3-n16r8-fido-dev",
      board: "esp32s3-n16r8-boot-button",
      flash_size: "16MB",
      flash_mode: "dio",
      flash_freq: "80m",
      layout_id: LAYOUT_ID,
      verification: "build-verified",
      usb: { vid: 0x303a, pid: 0x4002, webusb_landing_url: "https://multikeys.mewis.me" },
    },
    name,
    "16MB",
    { ...opts, version },
  );
  const manifest = {
    schema: "multikeys-firmware-manifest",
    schema_version: 1,
    version,
    tag,
    source_commit: "a".repeat(40),
    repository: "mewisme/esp32-security-key",
    builds: [published],
  } as unknown as RawManifest;
  const build = {
    ...published,
    profile_id: "esp32s3-16mb",
    flash_interface: "quad",
    psram_required: false,
    partition_schema: LAYOUT_ID,
    verified_hardware: [],
    usb: { ...(published.usb as object), product_name: FALLBACK_DEFAULT_NAME, custom_name: true },
    legacy: true,
    entry: structuredClone(published),
  } as unknown as Build;
  return { manifest, build, builds: [build], zips: new Map([[name, zip]]), zip, images };
}
