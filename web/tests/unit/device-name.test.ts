import { describe, expect, it } from "vitest";
import { DEVICE_NAME_MAX, FALLBACK_DEFAULT_NAME, validateDeviceName } from "@/lib/device/device-name";

describe("validateDeviceName", () => {
  it("accepts ordinary names", () => {
    expect(validateDeviceName("Mew's Security Key")).toBeNull();
    expect(validateDeviceName(FALLBACK_DEFAULT_NAME)).toBeNull();
    expect(validateDeviceName("A")).toBeNull();
    expect(validateDeviceName("Key #1 (work) - v2.0!")).toBeNull();
  });

  it("accepts exactly 31 characters and rejects 32", () => {
    expect(DEVICE_NAME_MAX).toBe(31);
    expect(validateDeviceName("x".repeat(31))).toBeNull();
    expect(validateDeviceName("x".repeat(32))).toBe("too-long");
  });

  it("rejects an empty name", () => {
    expect(validateDeviceName("")).toBe("empty");
  });

  it("rejects anything outside printable ASCII", () => {
    expect(validateDeviceName("Mêw")).toBe("not-ascii");
    expect(validateDeviceName("key 🔑")).toBe("not-ascii");
    expect(validateDeviceName("a\tb")).toBe("not-ascii");
    expect(validateDeviceName("a\nb")).toBe("not-ascii");
    expect(validateDeviceName("a\x7fb")).toBe("not-ascii");
  });

  it("rejects a space at either end", () => {
    expect(validateDeviceName(" Mew")).toBe("edge-space");
    expect(validateDeviceName("Mew ")).toBe("edge-space");
    expect(validateDeviceName(" ")).toBe("edge-space");
    expect(validateDeviceName("Me w")).toBeNull();
  });

  it("checks length before characters, as the firmware does", () => {
    expect(validateDeviceName("ê".repeat(40))).toBe("too-long");
  });
});
