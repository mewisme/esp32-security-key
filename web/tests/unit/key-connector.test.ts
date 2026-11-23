import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeUrlDescriptor, WebUsbKeyConnector } from "@/lib/device/key-connector";

const enc = (s: string) => new TextEncoder().encode(s);

function dev(serial: string, extra: Record<string, unknown> = {}) {
  return { serialNumber: serial, productName: "K", manufacturerName: "M", opened: false, close: vi.fn(async () => {}), open: vi.fn(async () => {}), ...extra };
}

function fakeUsb(initial: ReturnType<typeof dev>) {
  const usb = Object.assign(new EventTarget(), {
    listed: [] as unknown[],
    getDevices: async () => usb.listed,
    requestDevice: vi.fn(async () => initial),
  });
  vi.stubGlobal("navigator", { usb });
  return usb;
}

const fire = (usb: EventTarget, type: "connect" | "disconnect", device: unknown) => usb.dispatchEvent(Object.assign(new Event(type), { device }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("decodeUrlDescriptor", () => {
  it("decodes https and http", () => {
    expect(decodeUrlDescriptor(Uint8Array.from([3 + 5, 3, 1, ...enc("a.com")]))).toBe("https://a.com");
    expect(decodeUrlDescriptor(Uint8Array.from([3 + 5, 3, 0, ...enc("a.com")]))).toBe("http://a.com");
  });
  it("rejects malformed", () => {
    expect(decodeUrlDescriptor(Uint8Array.from([3, 2, 1]))).toBeNull();
    expect(decodeUrlDescriptor(Uint8Array.from([9, 3, 1]))).toBeNull();
    expect(decodeUrlDescriptor(new Uint8Array(2))).toBeNull();
  });
});

describe("WebUsbKeyConnector", () => {
  it("supported() reflects navigator.usb", () => {
    vi.stubGlobal("navigator", {});
    expect(new WebUsbKeyConnector().supported()).toBe(false);
    fakeUsb(dev("a"));
    expect(new WebUsbKeyConnector().supported()).toBe(true);
  });

  it("identity() reads strings and the landing URL without closing a device it did not open", async () => {
    const d = dev("a", {
      opened: true,
      controlTransferIn: vi.fn(async () => ({ status: "ok", data: new DataView(Uint8Array.from([3 + 5, 3, 1, ...enc("a.com")]).buffer) })),
    });
    fakeUsb(d);
    const c = await new WebUsbKeyConnector().connect(1, 2);
    expect(await c.identity()).toMatchObject({ productName: "K", serialNumber: "a", landingUrl: "https://a.com" });
    expect(d.close).not.toHaveBeenCalled();
  });

  it("waitForReenumeration resolves on a connect event with the same serial and swaps the device", async () => {
    const old = dev("s1");
    const next = dev("s1", { productName: "New" });
    const usb = fakeUsb(old);
    const c = await new WebUsbKeyConnector().connect(1, 2);
    const p = c.waitForReenumeration(10000);
    fire(usb, "connect", dev("other"));
    fire(usb, "connect", next);
    await p;
    expect((await c.identity()).productName).toBe("New");
  });

  it("resolves immediately when the device is already listed after a disconnect", async () => {
    const old = dev("s1");
    const usb = fakeUsb(old);
    const c = await new WebUsbKeyConnector().connect(1, 2);
    const p = c.waitForReenumeration(10000);
    usb.listed = [dev("s1", { productName: "Back" })];
    fire(usb, "disconnect", old);
    await p;
    expect((await c.identity()).productName).toBe("Back");
  });

  it("rejects name-not-verified on timeout", async () => {
    vi.useFakeTimers();
    const usb = fakeUsb(dev("s1"));
    void usb;
    const c = await new WebUsbKeyConnector().connect(1, 2);
    const p = c.waitForReenumeration(10000);
    const assertion = expect(p).rejects.toMatchObject({ code: "name-not-verified" });
    await vi.advanceTimersByTimeAsync(10000);
    await assertion;
  });
});
