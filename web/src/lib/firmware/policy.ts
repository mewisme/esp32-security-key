// The flash-safety policy shared with tools/flash_dev.py and tools/package_firmware.py.
import raw from "../../../../tools/flash_policy.json";
import type { ImageRole } from "./types";

export interface AllowedWrite {
  offset: number;
  role: ImageRole;
  max_size?: number;
  partition?: string;
}

export interface FlashPolicy {
  schema_version: 1;
  chip: string;
  flash_size: string;
  allowed_writes: AllowedWrite[];
  partition_table: { offset: number; read_length: number };
  app_descriptor: { offset: number; read_length: number };
  protected_partitions: string[];
  repurpose_fill: string[];
  credential_partition: { name: string; type: number; subtype: number };
  native_usb: { download: [number, number]; app: [number, number] };
  uart_bridges: [number, number, string][];
}

export const policy = raw as FlashPolicy;

/** Offset of esp_app_desc_t inside an app image (after the image header and first segment header). */
export const APP_DESC_IMAGE_OFFSET = 0x20;

export function appOffset(p: FlashPolicy = policy): number {
  const w = p.allowed_writes.find((x) => x.role === "app");
  if (!w) throw new Error("policy has no app write");
  return w.offset;
}
