// A running key over WebUSB: identity (USB strings + WebUSB landing page, read-only) and the MKAUTH management channel
// (WebCCID). Re-enumeration after a rename is awaited through navigator.usb connect/disconnect events.
import { FirmwareError } from "../errors/firmware-error";
import type { DeviceCheck } from "../flashing/machine";
import { type KeyEvent, parseKeyEvent } from "./key-events";
import { NoAnswerError, WebCcid } from "./webccid";

/** Events that arrive this soon after the interface is claimed were already queued in the key. */
const BACKLOG_WINDOW_MS = 500;

export interface KeyConnection {
  identity(): Promise<DeviceCheck>;
  transmit(apdu: Uint8Array, timeoutMs: number): Promise<Uint8Array>;
  waitForReenumeration(timeoutMs: number): Promise<void>;
  /**
   * Passkey activity the key reports (registration, sign-in, button wait). Events the key had queued come first, flagged
   * `backlog`; then live ones until `signal` aborts. The session cannot send commands meanwhile and is closed at the end.
   */
  watchEvents(onEvent: (event: KeyEvent, backlog: boolean) => void, signal: AbortSignal): Promise<void>;
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
    this.ccid ??= await this.openCcid();
    try {
      return await this.ccid.transmit(apdu, timeoutMs);
    } catch (e) {
      // The key stopped answering (it can drop a command while another interface is probing it): the abandoned exchange
      // must not keep reading, so the next call starts over with a fresh claim of the interface.
      if (e instanceof NoAnswerError) await this.closeCcid();
      throw e;
    }
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

  async watchEvents(onEvent: (event: KeyEvent, backlog: boolean) => void, signal: AbortSignal): Promise<void> {
    this.ccid ??= await this.openCcid();
    const ccid = this.ccid;
    // Whatever the key had queued is delivered within moments of claiming the interface; later events happened while
    // this page was watching. The key cannot say when a queued event happened, so the page does not pretend to know.
    const backlogUntil = Date.now() + BACKLOG_WINDOW_MS;
    const deliver = (payload: Uint8Array) => {
      try {
        onEvent(parseKeyEvent(payload), Date.now() < backlogUntil);
      } catch {
        // A malformed event is dropped: it must not end the watch.
      }
    };
    for (const payload of ccid.takeEvents()) deliver(payload);
    // A pending WebUSB read cannot be cancelled: closing the session makes it fail, which ends the loop.
    const onAbort = () => void this.closeCcid();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (!signal.aborted) deliver(await ccid.nextEvent());
    } catch (e) {
      if (!signal.aborted) throw e;
    } finally {
      signal.removeEventListener("abort", onAbort);
      await this.closeCcid();
    }
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

  private async openCcid(): Promise<WebCcid> {
    try {
      return await WebCcid.open(this.device);
    } catch (e) {
      // After a USB re-enumeration the device object held here can be stale: use the one the browser knows now.
      const list = await navigator.usb.getDevices().catch(() => [] as USBDevice[]);
      const current = list.find((d) => d.serialNumber === this.device.serialNumber);
      if (!current || current === this.device) throw e;
      this.device = current;
      return WebCcid.open(this.device);
    }
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
