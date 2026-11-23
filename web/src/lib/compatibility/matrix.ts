// The compatibility matrix shown on the home page: rows and levels mirror the table in docs/HARDWARE.md. The words
// (hardware, detail, level names) are in src/i18n/messages (`matrix`, `levels`).
export type MatrixLevel = "hardware-verified" | "build-verified" | "expected-compatible" | "experimental" | "unsupported";

export type MatrixRowId =
  | "esp32s3-n16r8"
  | "esp32s3-16mb"
  | "esp32s3-8mb"
  | "esp32s3-4mb"
  | "esp32s3-2mb"
  | "esp32s3-octal"
  | "other-chips"
  | "no-native-usb";

export interface MatrixRow {
  id: MatrixRowId;
  level: MatrixLevel;
}

export const MATRIX: MatrixRow[] = [
  { id: "esp32s3-n16r8", level: "hardware-verified" },
  { id: "esp32s3-16mb", level: "expected-compatible" },
  { id: "esp32s3-8mb", level: "build-verified" },
  { id: "esp32s3-4mb", level: "build-verified" },
  { id: "esp32s3-2mb", level: "unsupported" },
  { id: "esp32s3-octal", level: "unsupported" },
  { id: "other-chips", level: "unsupported" },
  { id: "no-native-usb", level: "unsupported" },
];

export type MatrixBadgeVariant = "success-light" | "info-light" | "warning-light" | "destructive-light";

export const LEVEL_BADGE: Record<MatrixLevel, MatrixBadgeVariant> = {
  "hardware-verified": "success-light",
  "expected-compatible": "info-light",
  "build-verified": "warning-light",
  experimental: "warning-light",
  unsupported: "destructive-light",
};
