// e2e-only UsbChecker, swapped in by vite.config.ts in --mode e2e.
import type { UsbChecker } from "@/lib/device/usb-checker";
import { readScenario } from "./scenario";

export function createUsbChecker(): UsbChecker {
  return {
    supported: () => true,
    async check() {
      if (readScenario().checker === "throw") throw Object.assign(new Error("No device selected."), { name: "NotFoundError" });
      return { productName: "MultiKeys Security Key", manufacturerName: "MultiKeys", serialNumber: null, landingUrl: "https://multikeys.mewis.me" };
    },
  };
}
