// The flash-safety policy shared with tools/flash_dev.py and tools/package_firmware.py (schema_version 2).
import raw from "../../../../tools/flash_policy.json" with { type: "json" };
import type { ImageRole, Verification } from "./types";

export interface AllowedWrite {
  offset: number;
  role: ImageRole;
  max_size?: number;
  partition?: string;
}

/** One supported flash size. `chip_feature` is a prefix matched against esptool's chip features. */
export interface VerifiedHardware {
  label: string;
  chip_feature: string;
}

export interface HardwareProfile {
  id: string;
  label: string;
  flash_size: string;
  flash_mode: string;
  config_flash_mode: string;
  flash_freq: string;
  flash_interface: "quad";
  psram_required: boolean;
  board: string;
  verification: Verification;
  verified_hardware: VerifiedHardware[];
  release: boolean;
}

export interface FlashPolicy {
  schema_version: 2;
  chip: string;
  default_profile: string;
  profiles: HardwareProfile[];
  /** Schema-1 build ids (always 16 MB) -> the profile they now belong to. */
  legacy_builds: Record<string, string>;
  allowed_writes: AllowedWrite[];
  partition_table: { offset: number; read_length: number };
  app_descriptor: { offset: number; read_length: number };
  protected_partitions: string[];
  repurpose_fill: string[];
  credential_partition: { name: string; type: number; subtype: number };
  native_usb: { download: [number, number]; app: [number, number] };
  uart_bridges: [number, number, string][];
}

export const policy = raw as unknown as FlashPolicy;

/** Offset of esp_app_desc_t inside an app image (after the image header and first segment header). */
export const APP_DESC_IMAGE_OFFSET = 0x20;

export function appOffset(p: FlashPolicy = policy): number {
  const w = p.allowed_writes.find((x) => x.role === "app");
  if (!w) throw new Error("policy has no app write");
  return w.offset;
}

export function profileById(id: string, p: FlashPolicy = policy): HardwareProfile | undefined {
  return p.profiles.find((x) => x.id === id);
}

const megabytes = (size: string): number => Number.parseInt(size, 10);

/** Flash sizes of every profile, ascending: ["4MB", "8MB", "16MB"]. */
export function supportedFlashSizes(p: FlashPolicy = policy): string[] {
  return [...new Set(p.profiles.map((x) => x.flash_size))].sort((a, b) => megabytes(a) - megabytes(b));
}
