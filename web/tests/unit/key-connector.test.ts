import { afterEach, describe, expect, it, vi } from "vitest";
import { WebUsbKeyConnector } from "@/lib/device/key-connector";
import { NoAnswerError } from "@/lib/device/webccid";

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

describe("WebUsbKeyConnector", () => {
  it("supported() reflects navigator.usb", () => {
    vi.stubGlobal("navigator", {});
    expect(new WebUsbKeyConnector().supported()).toBe(false);
    fakeUsb(dev("a"));
    expect(new WebUsbKeyConnector().supported()).toBe(true);
  });

  it("identity() returns the USB strings the browser has without opening the device", async () => {
    const controlTransferIn = vi.fn();
    const d = dev("a", { controlTransferIn });
    fakeUsb(d);
    const c = await new WebUsbKeyConnector().connect(1, 2);
    expect(await c.identity()).toEqual({ productName: "K", manufacturerName: "M", serialNumber: "a" });
    expect(d.open).not.toHaveBeenCalled();
    expect(controlTransferIn).not.toHaveBeenCalled();
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

  describe("management channel", () => {
    const frame = (seq: number, data: number[] = [], b7 = 0) => Uint8Array.from([0x80, data.length, 0, 0, 0, 0, seq, b7, 0, 0, ...data]);
    const atr = frame(0, [0x3b]);

    function ccidDevice(serial: string, o: { failOpen?: boolean; replies?: (Uint8Array | "hang")[] }) {
      const replies = [...(o.replies ?? [])];
      const events: string[] = [];
      const d = {
        serialNumber: serial,
        productName: "K",
        manufacturerName: "M",
        opened: false,
        configuration: null as unknown,
        open: vi.fn(async () => {
          if (o.failOpen) throw new DOMException("The device was disconnected.", "NotFoundError");
          d.opened = true;
        }),
        selectConfiguration: vi.fn(async () => {
          d.configuration = { interfaces: [{ interfaceNumber: 3, alternate: { interfaceClass: 0xff, endpoints: [{ endpointNumber: 1, direction: "in", type: "bulk" }, { endpointNumber: 2, direction: "out", type: "bulk" }] } }] };
        }),
        claimInterface: vi.fn(async (n: number) => void events.push(`claim ${n}`)),
        releaseInterface: vi.fn(async (n: number) => void events.push(`release ${n}`)),
        close: vi.fn(async () => {
          events.push("close");
          d.opened = false;
        }),
        transferOut: vi.fn(async (_ep: number, data: BufferSource) => ({ status: "ok", bytesWritten: (data as Uint8Array).length })),
        transferIn: vi.fn(async () => {
          const r = replies.shift();
          if (r === "hang") return new Promise<never>(() => {});
          if (!r) throw new Error("no scripted reply");
          return { status: "ok", data: new DataView(r.buffer, r.byteOffset, r.byteLength) };
        }),
      };
      return { d, events };
    }

    it("a command the key never answers closes the claim, and the next command starts on a fresh one", async () => {
      vi.useFakeTimers();
      const k = ccidDevice("s1", { replies: [atr, "hang", atr, frame(1, [0x90, 0x00])] });
      fakeUsb(k.d as never);
      const c = await new WebUsbKeyConnector().connect(1, 2);
      const first = c.transmit(Uint8Array.from([1]), 1000);
      const assertion = expect(first).rejects.toBeInstanceOf(NoAnswerError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(k.events).toEqual(["claim 3", "release 3", "close"]);
      expect([...(await c.transmit(Uint8Array.from([1]), 1000))]).toEqual([0x90, 0x00]);
      expect(k.events).toEqual(["claim 3", "release 3", "close", "claim 3"]);
    });

    it("takes the device object the browser lists now when the one it holds cannot be opened (stale after a restart)", async () => {
      const stale = ccidDevice("s1", { failOpen: true });
      const fresh = ccidDevice("s1", { replies: [atr, frame(1, [0x90, 0x00])] });
      const usb = fakeUsb(stale.d as never);
      usb.listed = [fresh.d];
      const c = await new WebUsbKeyConnector().connect(1, 2);
      expect([...(await c.transmit(Uint8Array.from([1]), 1000))]).toEqual([0x90, 0x00]);
      expect(fresh.events).toEqual(["claim 3"]);
    });
  });
});
