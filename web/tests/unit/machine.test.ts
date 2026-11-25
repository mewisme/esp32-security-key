import { describe, expect, it } from "vitest";
import type { InstallDecision } from "@/lib/flashing/install-mode";
import { type FlashEvent, type FlashState, flashReducer, initialState } from "@/lib/flashing/machine";

const chip = { chipName: "ESP32-S3", description: "ESP32-S3", features: [], mac: null, flashSize: "16MB", flashType: "quad" as const, secureDownloadMode: false };
const decision = (acks: InstallDecision["acks"] = ["dev-firmware"]): InstallDecision => ({
  mode: "switch-image",
  allowed: true,
  acks,
  writes: [],
  reason: "",
});

const run = (events: FlashEvent[], from: FlashState = initialState) => events.reduce(flashReducer, from);

const COMPATIBLE: FlashEvent = { type: "COMPATIBLE", buildId: "esp32s3-16mb-fido-dev", profileId: "esp32s3-16mb", support: "reference-config" };

const TO_CONFIRM: FlashEvent[] = [
  { type: "START" },
  { type: "BROWSER_OK" },
  { type: "HARDWARE_CONFIRMED" },
  { type: "FIRMWARE_SELECTED", tag: "v0.2.0", image: "fido" },
  { type: "PORT_GRANTED", info: {} },
  { type: "CONNECTED" },
  { type: "CHIP_DETECTED", chip },
  COMPATIBLE,
  { type: "MANIFEST_READY" },
  { type: "DOWNLOADED" },
  { type: "INTEGRITY_OK" },
  { type: "SAFETY_DECIDED", decision: decision(["dev-firmware", "switch-image"]) },
];

describe("flashReducer", () => {
  it("happy path reaches completed with every milestone", () => {
    const s = run([
      ...TO_CONFIRM,
      { type: "CONFIRMED", acks: ["dev-firmware", "switch-image"] },
      { type: "PROGRESS", written: 5, total: 10 },
      { type: "WRITTEN" },
      { type: "FLASH_VERIFIED" },
      { type: "REBOOTED" },
      { type: "DEVICE_DETECTED", info: { productName: "MultiKeys Security Key", manufacturerName: null, serialNumber: null } },
    ]);
    expect(s.phase).toBe("completed");
    expect(s.milestones).toEqual({ downloaded: true, integrityVerified: true, written: true, flashVerified: true, deviceDetected: true });
  });

  it("FIRMWARE_SELECTED stores the release and image but no build: the build follows the board", () => {
    const s = run(TO_CONFIRM.slice(0, 4));
    expect(s.phase).toBe("requesting-permission");
    expect([s.tag, s.image, s.buildId, s.profileId, s.support]).toEqual(["v0.2.0", "fido", null, null, null]);
  });

  it("COMPATIBLE stores the build, profile and support level", () => {
    const s = run(TO_CONFIRM.slice(0, 8));
    expect(s.phase).toBe("fetching-metadata");
    expect([s.buildId, s.profileId, s.support]).toEqual(["esp32s3-16mb-fido-dev", "esp32s3-16mb", "reference-config"]);
  });

  it("ignores CANCEL while flashing and verifying", () => {
    const flashing = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "switch-image"] }]);
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
    const s = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "switch-image"] }, { type: "FAIL", code: "disconnected-during-flash", message: "x" }]);
    expect(s.phase).toBe("failed");
    expect(s.milestones.written).toBe(false);
    expect(s.error?.phase).toBe("flashing");
  });

  it("DEVICE_NOT_DETECTED -> completed without deviceDetected", () => {
    const s = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "switch-image"] }, { type: "WRITTEN" }, { type: "FLASH_VERIFIED" }, { type: "REBOOTED" }, { type: "DEVICE_NOT_DETECTED" }]);
    expect(s.phase).toBe("completed");
    expect(s.milestones.flashVerified).toBe(true);
    expect(s.milestones.deviceDetected).toBe(false);
  });

  it("cannot skip verification to completed", () => {
    const s = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "switch-image"] }, { type: "WRITTEN" }, { type: "REBOOTED" }, { type: "DEVICE_NOT_DETECTED" }]);
    expect(s.phase).toBe("verifying-flash");
  });

  it("blocked decision fails with storage-incompatible", () => {
    const s = run([...TO_CONFIRM.slice(0, -1), { type: "SAFETY_DECIDED", decision: { ...decision([]), mode: "blocked", allowed: false } }]);
    expect(s.phase).toBe("failed");
    expect(s.error?.code).toBe("storage-incompatible");
  });

  it("RETRY after a connection failure returns to device selection, keeps the release and clears the attempt", () => {
    const failed = run([...TO_CONFIRM.slice(0, 8), { type: "FAIL", code: "wrong-flash-size", message: "" }]);
    const s = run([{ type: "RETRY" }], failed);
    expect(s.phase).toBe("requesting-permission");
    expect(s.chip).toBeNull();
    expect([s.buildId, s.profileId, s.support]).toEqual([null, null, null]);
    expect(s.tag).toBe("v0.2.0");
    expect(s.image).toBe("fido");
  });

  it("ignores events that do not belong to the phase", () => {
    expect(run([{ type: "WRITTEN" }])).toBe(initialState);
  });
});

describe("BACK", () => {
  it("goes from firmware selection to the first stage and from device selection to firmware selection", () => {
    const atFirmware = run(TO_CONFIRM.slice(0, 3));
    expect(atFirmware.phase).toBe("firmware-selection");
    const first = run([{ type: "BACK" }], atFirmware);
    expect(first.phase).toBe("hardware-guidance");
    const again = run([{ type: "HARDWARE_CONFIRMED" }, { type: "FIRMWARE_SELECTED", tag: "v0.2.0", image: "fido" }, { type: "BACK" }], first);
    expect(again.phase).toBe("firmware-selection");
  });

  it("is ignored once the board is being talked to, and everywhere else", () => {
    for (const events of [TO_CONFIRM.slice(0, 5), TO_CONFIRM.slice(0, 8), TO_CONFIRM, [], TO_CONFIRM.slice(0, 2)]) {
      const before = run(events);
      expect(run([{ type: "BACK" }], before)).toBe(before);
    }
    const flashing = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "switch-image"] }]);
    expect(run([{ type: "BACK" }], flashing).phase).toBe("flashing");
  });
});

describe("CHANGE_FIRMWARE and DECISION_CHANGED", () => {
  it("CHANGE_FIRMWARE from awaiting-confirmation returns to firmware selection and clears the attempt but keeps the release", () => {
    const at = run(TO_CONFIRM);
    expect(at.phase).toBe("awaiting-confirmation");
    const s = run([{ type: "CHANGE_FIRMWARE" }], at);
    expect(s.phase).toBe("firmware-selection");
    expect([s.chip, s.decision, s.port, s.buildId, s.profileId, s.support]).toEqual([null, null, null, null, null, null]);
    expect(s.milestones).toEqual({ downloaded: false, integrityVerified: false, written: false, flashVerified: false, deviceDetected: false });
    expect(s.tag).toBe("v0.2.0");
    // The person can pick again and carry on from the start of the board stages.
    expect(run([{ type: "FIRMWARE_SELECTED", tag: "v0.3.0", image: "auto" }], s)).toMatchObject({ phase: "requesting-permission", tag: "v0.3.0", image: "auto" });
  });

  it("CHANGE_FIRMWARE is ignored while writing and in other phases", () => {
    const flashing = run([...TO_CONFIRM, { type: "CONFIRMED", acks: ["dev-firmware", "switch-image"] }]);
    expect(run([{ type: "CHANGE_FIRMWARE" }], flashing)).toBe(flashing);
    const earlier = run(TO_CONFIRM.slice(0, 8));
    expect(run([{ type: "CHANGE_FIRMWARE" }], earlier)).toBe(earlier);
  });

  it("DECISION_CHANGED to an allowed decision keeps the review and replaces the decision (the old acknowledgements no longer count)", () => {
    const next = decision(["dev-firmware", "switch-image", "switch-image-typed"]);
    const s = run([{ type: "DECISION_CHANGED", decision: next }], run(TO_CONFIRM));
    expect(s.phase).toBe("awaiting-confirmation");
    expect(s.decision).toBe(next);
    expect(run([{ type: "CONFIRMED", acks: ["dev-firmware", "switch-image"] }], s).phase).toBe("awaiting-confirmation");
    expect(run([{ type: "CONFIRMED", acks: next.acks }], s).phase).toBe("flashing");
  });

  it("DECISION_CHANGED to a refused decision fails with storage-incompatible", () => {
    const s = run([{ type: "DECISION_CHANGED", decision: { ...decision([]), mode: "blocked", allowed: false, reason: "layout" } }], run(TO_CONFIRM));
    expect(s.phase).toBe("failed");
    expect(s.error?.code).toBe("storage-incompatible");
  });

  it("a blocked decision with reason different-key fails with the different-key error code, on the first decision and on a re-read", () => {
    const blocked: InstallDecision = { ...decision([]), mode: "blocked", allowed: false, reason: "different-key" };
    const first = run([...TO_CONFIRM.slice(0, -1), { type: "SAFETY_DECIDED", decision: blocked }]);
    expect(first.phase).toBe("failed");
    expect(first.error?.code).toBe("different-key");
    const reread = run([{ type: "DECISION_CHANGED", decision: blocked }], run(TO_CONFIRM));
    expect(reread.phase).toBe("failed");
    expect(reread.error?.code).toBe("different-key");
  });
});
