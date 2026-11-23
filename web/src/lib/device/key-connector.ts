// A running key over WebUSB: identity (USB strings + WebUSB landing page, read-only) and the MKAUTH management channel
// (WebCCID). Re-enumeration after a rename is awaited through navigator.usb connect/disconnect events.
import { FirmwareError } from "../errors/firmware-error";
import type { DeviceCheck } from "../flashing/machine";
import { WebCcid } from "./webccid";

export interface KeyConnection {
  identity(): Promise<DeviceCheck>;
  transmit(apdu: Uint8Array, timeoutMs: number): Promise<Uint8Array>;
  waitForReenumeration(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

export interface KeyConnector {
  supported(): boolean;
  connect(vid: number, pid: number): Promise<KeyConnection>;
}

/** WebUSB URL descriptor (bLength, bDescriptorType=3, bScheme, URL) -> URL; scheme 1 = https. */
export function decodeUrlDescriptor(bytes: Uint8Array): string | null {
  if (bytes.length < 3 || bytes[1] !== 3 || bytes[0]! > bytes.length) return null;
  const prefix = bytes[2] === 1 ? "https://" : bytes[2] === 0 ? "http://" : "";
  return prefix + new TextDecoder().decode(bytes.subarray(3, bytes[0]));
}

class WebUsbKeyConnection implements KeyConnection {
  private ccid: WebCcid | null = null;

  constructor(private device: USBDevice) {}

  async identity(): Promise<DeviceCheck> {
    const dev = this.device;
    const result: DeviceCheck = {
      productName: dev.productName ?? null,
      manufacturerName: dev.manufacturerName ?? null,
      serialNumber: dev.serialNumber ?? null,
      landingUrl: null,
    };
    const wasOpen = dev.opened;
    try {
      if (!wasOpen) await dev.open();
      const r = await dev.controlTransferIn({ requestType: "vendor", recipient: "device", request: 1, value: 1, index: 2 }, 255);
      if (r.status === "ok" && r.data) result.landingUrl = decodeUrlDescriptor(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
    } catch {
      // Other interfaces are held by the HID/CCID drivers on many systems; the landing URL then stays "not checked".
    } finally {
      if (!wasOpen) await dev.close().catch(() => {});
    }
    return result;
  }

  async transmit(apdu: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    this.ccid ??= await WebCcid.open(this.device);
    return this.ccid.transmit(apdu, timeoutMs);
  }

  async waitForReenumeration(timeoutMs: number): Promise<void> {
    const serial = this.device.serialNumber;
    const usb = navigator.usb;
    // Listeners are attached synchronously, before anything is awaited, so no event can be missed.
    const wait = new Promise<void>((resolve, reject) => {
      let disconnected = false;
      const done = (fn: () => void) => {
        clearTimeout(timer);
        usb.removeEventListener("connect", onConnect);
        usb.removeEventListener("disconnect", onDisconnect);
        fn();
      };
      const onConnect = (e: Event) => {
        const d = (e as USBConnectionEvent).device;
        if (d.serialNumber === serial) done(() => {
          this.device = d;
          resolve();
        });
      };
      const onDisconnect = (e: Event) => {
        if ((e as USBConnectionEvent).device.serialNumber !== serial) return;
        disconnected = true;
        // The device may already be back by the time the event is delivered.
        void usb.getDevices().then((list) => {
          const back = list.find((d) => d.serialNumber === serial);
          if (disconnected && back) done(() => {
            this.device = back;
            resolve();
          });
        }, () => {});
      };
      const timer = setTimeout(
        () => done(() => reject(new FirmwareError("name-not-verified", `the key did not reappear within ${timeoutMs} ms`))),
        timeoutMs,
      );
      usb.addEventListener("connect", onConnect);
      usb.addEventListener("disconnect", onDisconnect);
    });
    await this.closeCcid();
    await this.device.close().catch(() => {});
    return wait;
  }

  async close(): Promise<void> {
    await this.closeCcid();
    await this.device.close().catch(() => {});
  }

  private async closeCcid(): Promise<void> {
    const c = this.ccid;
    this.ccid = null;
    await c?.close();
  }
}

export class WebUsbKeyConnector implements KeyConnector {
  supported(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.usb?.requestDevice === "function";
  }

  async connect(vid: number, pid: number): Promise<KeyConnection> {
    const dev = await navigator.usb.requestDevice({ filters: [{ vendorId: vid, productId: pid }] });
    return new WebUsbKeyConnection(dev);
  }
}
