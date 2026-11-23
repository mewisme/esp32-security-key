// The compatibility matrix shown on the home page; kept identical to the table in docs/HARDWARE.md.
export type MatrixLevel = "hardware-verified" | "build-verified" | "expected-compatible" | "experimental" | "unsupported";

export interface MatrixRow {
  id: string;
  hardware: string;
  detail: string;
  level: MatrixLevel;
}

export const MATRIX: MatrixRow[] = [
  { id: "esp32s3-n16r8", hardware: "ESP32-S3 N16R8", detail: "16 MB quad flash, 8 MB PSRAM (unused)", level: "hardware-verified" },
  {
    id: "esp32s3-16mb",
    hardware: "Other ESP32-S3 with 16 MB quad flash",
    detail: "Native USB connector and a BOOT button on GPIO0",
    level: "expected-compatible",
  },
  {
    id: "esp32s3-8mb",
    hardware: "ESP32-S3 with 8 MB quad flash (N8, N8R2, N8R8)",
    detail: "Builds and passes every image check; not run on a board yet",
    level: "build-verified",
  },
  {
    id: "esp32s3-4mb",
    hardware: "ESP32-S3 with 4 MB quad flash (N4, N4R2)",
    detail: "Builds and passes every image check; not run on a board yet",
    level: "build-verified",
  },
  {
    id: "esp32s3-2mb",
    hardware: "ESP32-S3 with 2 MB flash",
    detail: "Does not fit the 3 MB storage layout",
    level: "unsupported",
  },
  {
    id: "esp32s3-octal",
    hardware: "Octal-flash modules (ESP32-S3-WROOM-2, e.g. N16R8V, N32R8V)",
    detail: "Only quad-SPI flash is supported",
    level: "unsupported",
  },
  { id: "other-chips", hardware: "ESP32, ESP32-S2, -C3, -C6, -H2", detail: "MultiKeys only runs on the ESP32-S3", level: "unsupported" },
  {
    id: "no-native-usb",
    hardware: "Boards without a native USB connector",
    detail: "The key talks to the computer through the chip's own USB",
    level: "unsupported",
  },
];

export type MatrixBadgeVariant = "success-light" | "info-light" | "warning-light" | "destructive-light";

export const LEVEL_BADGE: Record<MatrixLevel, MatrixBadgeVariant> = {
  "hardware-verified": "success-light",
  "expected-compatible": "info-light",
  "build-verified": "warning-light",
  experimental: "warning-light",
  unsupported: "destructive-light",
};

export const LEVEL_TEXT: Record<MatrixLevel, string> = {
  "hardware-verified": "Hardware verified",
  "build-verified": "Build verified",
  "expected-compatible": "Expected compatible",
  experimental: "Experimental",
  unsupported: "Unsupported",
};
