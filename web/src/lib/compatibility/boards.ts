// Board choices in the Hardware step. Kept in step with the compatibility table in docs/HARDWARE.md.
export type CompatibilityLevel = "verified" | "expected-compatible" | "unsupported" | "unknown";

export interface BoardProfile {
  id: string;
  label: string;
  level: CompatibilityLevel;
  note: string;
}

export const BOARDS: BoardProfile[] = [
  {
    id: "esp32s3-n16r8-devkit",
    label: "ESP32-S3 N16R8 devkit with two USB ports and a BOOT button",
    level: "verified",
    note: "The firmware has been tested on this board type (installed with the developer script).",
  },
  {
    id: "esp32s3-16mb-other",
    label: "Other ESP32-S3 board with 16 MB flash, a native USB connector and BOOT on GPIO0",
    level: "expected-compatible",
    note: "Should work; not tested. The installer checks the chip and flash size before writing anything.",
  },
  {
    id: "esp32s3-other-flash",
    label: "ESP32-S3 with 4 or 8 MB flash",
    level: "unsupported",
    note: "The firmware and its storage layout need 16 MB of flash.",
  },
  {
    id: "esp32-other-chip",
    label: "ESP32, ESP32-S2, ESP32-C3, ESP32-C6 or ESP32-H2",
    level: "unsupported",
    note: "MultiKeys only runs on the ESP32-S3.",
  },
  {
    id: "uart-only",
    label: "A board without a native USB connector (only a USB-to-serial chip)",
    level: "unsupported",
    note: "The key talks to the computer through the chip's own USB; a USB-to-serial chip can't do that.",
  },
  {
    id: "unknown",
    label: "I'm not sure",
    level: "unknown",
    note: "Look at the metal module: a marking like “N16R8” means 16 MB flash. You can continue; the chip and flash size are checked electronically before anything is written.",
  },
];

export const LEVEL_LABEL: Record<CompatibilityLevel, string> = {
  verified: "Tested",
  "expected-compatible": "Expected to work",
  unsupported: "Not supported",
  unknown: "Checked during install",
};
