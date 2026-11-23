import { describe, expect, it } from "vitest";
import type { InstallDecision } from "@/lib/flashing/install-mode";
import { type FlashEvent, type FlashState, flashReducer, initialState } from "@/lib/flashing/machine";

const chip = { chipName: "ESP32-S3", description: "ESP32-S3", features: [], mac: null, flashSize: "16MB", secureDownloadMode: false };
const decision = (acks: InstallDecision["acks"] = ["dev-firmware"]): InstallDecision => ({
  mode: "update-unverified",
  allowed: true,
  acks,
  writes: [],
  reason: "",
});

const run = (events: FlashEvent[], from: FlashState = initialState) => events.reduce(flashReducer, from);

const TO_CONFIRM: FlashEvent[] = [
  { type: "START" },
  { type: "BROWSER_OK" },
  { type: "HARDWARE_CONFIRMED", boardId: "esp32s3-n16r8-devkit" },
  { type: "FIRMWARE_SELECTED", tag: "v0.2.0", buildId: "b" },
  { type: "PORT_GRANTED", info: {} },
  { type: "CONNECTED" },
  { type: "CHIP_DETECTED", chip },
  { type: "COMPATIBLE" },
  { type: "MANIFEST_READY" },
  { type: "DOWNLOADED" },
  { type: "INTEGRITY_OK" },
  { type: "SAFETY_DECIDED", decision: decision(["dev-firmware", "update-unverified"]) },
];

describe("flashReducer", () => {
  it("happy path reaches completed with every milestone", () => {
    const s = run([
      ...TO_CONFIRM,
      { type: "CONFIRMED", acks: ["dev-firmware", "update-unverified"] },
      { type: "PROGRESS", written: 5, total: 10 },
      { type: "WRITTEN" },
      { type: "FLASH_VERIFIED" },
      { type: "REBOOTED" },
      { type: "DEVICE_DETECTED", info: { productName: "MultiKeys Security Key", manufacturerName: null, serialNumber: null, landingUrl: null } },
    ]);
    expect(s.phase).toBe("completed");
    expect(s.milestones).toEqual({ downloaded: true, integrityVerified: true, written: true, flashVerified: true, deviceDetected: true });
  });

  it("ignores CANCEL while flashing and verifying", () => {
    const flashing = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "update-unverified"] }]);
    expect(flashing.phase).toBe("flashing");
    expect(run([{ type: "CANCEL" }], flashing).phase).toBe("flashing");
    const verifying = run([{ type: "WRITTEN" }], flashing);
    expect(run([{ type: "CANCEL" }], verifying).phase).toBe("verifying-flash");
  });

  it("ignores CONFIRMED with missing acks", () => {
    const s = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware"] }]);
    expect(s.phase).toBe("awaiting-confirmation");
  });

  it("FAIL during flashing -> failed, not written", () => {
    const s = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "update-unverified"] }, { type: "FAIL", code: "disconnected-during-flash", message: "x" }]);
    expect(s.phase).toBe("failed");
    expect(s.milestones.written).toBe(false);
    expect(s.error?.phase).toBe("flashing");
  });

  it("DEVICE_NOT_DETECTED -> completed without deviceDetected", () => {
    const s = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "update-unverified"] }, { type: "WRITTEN" }, { type: "FLASH_VERIFIED" }, { type: "REBOOTED" }, { type: "DEVICE_NOT_DETECTED" }]);
    expect(s.phase).toBe("completed");
    expect(s.milestones.flashVerified).toBe(true);
    expect(s.milestones.deviceDetected).toBe(false);
  });

  it("cannot skip verification to completed", () => {
    const s = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "update-unverified"] }, { type: "WRITTEN" }, { type: "REBOOTED" }, { type: "DEVICE_NOT_DETECTED" }]);
    expect(s.phase).toBe("verifying-flash");
  });

  it("blocked decision fails with storage-incompatible", () => {
    const s = run([...TO_CONFIRM.slice(0, -1), { type: "SAFETY_DECIDED", decision: { ...decision([]), mode: "blocked", allowed: false } }]);
    expect(s.phase).toBe("failed");
    expect(s.error?.code).toBe("storage-incompatible");
  });

  it("RETRY after a connection failure returns to device selection and clears the attempt", () => {
    const failed = run([...TO_CONFIRM.slice(0, 6), { type: "FAIL", code: "not-download-mode", message: "" }]);
    const s = run([{ type: "RETRY" }], failed);
    expect(s.phase).toBe("requesting-permission");
    expect(s.chip).toBeNull();
    expect(s.tag).toBe("v0.2.0");
  });

  it("ignores events that do not belong to the phase", () => {
    expect(run([{ type: "WRITTEN" }])).toBe(initialState);
  });
});
