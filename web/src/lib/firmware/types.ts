// firmware-manifest.json as written by tools/package_firmware.py (schema_version 2). Schema-1 manifests (v0.2.0) are
// normalised into the same shape by validateManifest (see manifest.ts), so everything downstream reads one `Build`.

export type ImageRole = "bootloader" | "partition-table" | "app";

export type Verification = "hardware-verified" | "build-verified";

export interface ManifestImage {
  role: ImageRole;
  file: string;
  offset: number;
  size: number;
  sha256: string;
}

export interface ManifestPartition {
  name: string;
  type: string;
  subtype: string;
  offset: number;
  size: number;
}

export interface Build {
  id: string;
  image: "fido" | "openpgp";
  project_name: string;
  version: string;
  title: string;
  board: string;
  chip: string;
  flash_size: string;
  flash_mode: string;
  flash_freq: string;
  /** Hardware profile in tools/flash_policy.json (schema 1: derived from the legacy build id). */
  profile_id: string;
  flash_interface: "quad";
  psram_required: boolean;
  security_profile: "development";
  idf_version: string;
  user_presence: { gpio: number; active_low: boolean };
  led: string;
  usb: { vid: number; pid: number; webusb_landing_url: string; product_name: string; custom_name: boolean };
  package: { name: string; size: number; sha256: string };
  images: ManifestImage[];
  partitions: ManifestPartition[];
  layout_id: string;
  partition_schema: string;
  protected_partitions: string[];
  repurpose_fill: string[];
  /** `app_only`: the publisher states that only the app image (factory partition) may be rewritten on a compatible key. */
  update: { data_preserving_from: string; downgrade_floor?: string | null; app_only?: boolean };
  install_modes: string[];
  verified_hardware: string[];
  verification: Verification;
  /** True for a schema-1 manifest entry: its fields above were derived, not published. */
  legacy: boolean;
  /** The exact JSON entry as published (package included); firmware.json inside the zip must equal it minus `package`. */
  entry: Record<string, unknown>;
}

export interface Manifest {
  schema: "multikeys-firmware-manifest";
  schema_version: 1 | 2;
  version: string;
  tag: string;
  source_commit: string;
  repository: string;
  builds: Build[];
}
