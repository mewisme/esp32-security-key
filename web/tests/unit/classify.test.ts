import { describe, expect, it } from "vitest";
import { classifyError, DisconnectedError } from "@/lib/errors/classify";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { compareSemver } from "@/lib/firmware/version";

const dom = (name: string) => Object.assign(new Error(name), { name });

describe("classifyError", () => {
  it("maps chooser outcomes", () => {
    expect(classifyError(dom("NotFoundError"), "requesting-permission")).toBe("no-device-selected");
    expect(classifyError(dom("SecurityError"), "requesting-permission")).toBe("permission-denied");
  });

  it("maps a busy port and a silent chip", () => {
    expect(classifyError(dom("InvalidStateError"), "connecting")).toBe("port-busy");
    expect(classifyError(new Error("Failed to connect"), "connecting")).toBe("not-download-mode");
    expect(classifyError(new Error("timeout"), "detecting-chip")).toBe("not-download-mode");
  });

  it("distinguishes disconnects during and outside a write", () => {
    expect(classifyError(new DisconnectedError(), "flashing")).toBe("disconnected-during-flash");
    expect(classifyError(new DisconnectedError(), "verifying-flash")).toBe("disconnected-during-flash");
    expect(classifyError(new DisconnectedError(), "downloading")).toBe("device-disconnected");
  });

  it("maps write, verify and reboot failures", () => {
    expect(classifyError(new Error("x"), "flashing")).toBe("flash-write-failed");
    expect(classifyError(new Error("x"), "verifying-flash")).toBe("flash-verify-failed");
    expect(classifyError(new Error("x"), "rebooting")).toBe("reboot-failed");
    expect(classifyError(new Error("x"), "checking-flash-safety")).toBe("unsafe-layout");
  });

  it("keeps a FirmwareError's own code", () => {
    expect(classifyError(new FirmwareError("wrong-flash-size", "8MB"), "validating-compatibility")).toBe("wrong-flash-size");
  });
});

describe("compareSemver", () => {
  it("orders releases and pre-releases", () => {
    expect(compareSemver("0.2.0", "0.2.0")).toBe(0);
    expect(compareSemver("0.2.0-dev", "0.2.0")).toBe(-1);
    expect(compareSemver("0.10.0", "0.2.0")).toBe(1);
    expect(compareSemver("0.2.0-rc.2", "0.2.0-rc.10")).toBe(-1);
    expect(compareSemver("1.89", "0.2.0")).toBeNull();
  });
});
