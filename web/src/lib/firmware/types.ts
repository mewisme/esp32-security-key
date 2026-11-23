// firmware-manifest.json, as written by tools/package_firmware.py (schema_version 1).

export type ImageRole = "bootloader" | "partition-table" | "app";

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
  security_profile: "development";
  idf_version: string;
  user_presence: { gpio: number; active_low: boolean };
  led: string;
  usb: { vid: number; pid: number; webusb_landing_url: string };
  package: { name: string; size: number; sha256: string };
  images: ManifestImage[];
  partitions: ManifestPartition[];
  layout_id: string;
  protected_partitions: string[];
  repurpose_fill: string[];
  update: { data_preserving_from: string };
  install_modes: string[];
  verification: string;
}

export interface Manifest {
  schema: "multikeys-firmware-manifest";
  schema_version: 1;
  version: string;
  tag: string;
  source_commit: string;
  repository: string;
  builds: Build[];
}
