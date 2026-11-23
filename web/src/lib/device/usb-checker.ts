// Read-only check of a running key over WebUSB: USB strings from the descriptor, then (best effort) the WebUSB landing
// page via GET_URL. It never sends anything else to the device.
import type { DeviceCheck } from "../flashing/machine";

export interface UsbChecker {
  supported(): boolean;
  check(vid: number, pid: number): Promise<DeviceCheck>;
}

/** WebUSB URL descriptor (bLength, bDescriptorType=3, bScheme, URL) -> URL; scheme 1 = https. */
export function decodeUrlDescriptor(bytes: Uint8Array): string | null {
  if (bytes.length < 3 || bytes[1] !== 3 || bytes[0]! > bytes.length) return null;
  const prefix = bytes[2] === 1 ? "https://" : bytes[2] === 0 ? "http://" : "";
  return prefix + new TextDecoder().decode(bytes.subarray(3, bytes[0]));
}

export class WebUsbChecker implements UsbChecker {
  supported(): boolean {
    return typeof navigator.usb?.requestDevice === "function";
  }

  async check(vid: number, pid: number): Promise<DeviceCheck> {
    const dev = await navigator.usb.requestDevice({ filters: [{ vendorId: vid, productId: pid }] });
    const result: DeviceCheck = {
      productName: dev.productName ?? null,
      manufacturerName: dev.manufacturerName ?? null,
      serialNumber: dev.serialNumber ?? null,
      landingUrl: null,
    };
    try {
      await dev.open();
      const r = await dev.controlTransferIn({ requestType: "vendor", recipient: "device", request: 1, value: 1, index: 2 }, 255);
      if (r.status === "ok" && r.data) result.landingUrl = decodeUrlDescriptor(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
    } catch {
      // Other interfaces are held by the HID/CCID drivers on many systems; the landing URL then stays "not checked".
    } finally {
      await dev.close().catch(() => {});
    }
    return result;
  }
}
