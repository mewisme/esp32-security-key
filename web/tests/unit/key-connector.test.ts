import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionBusyError, WebUsbKeyConnector } from "@/lib/device/key-connector";
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

// A model of the USB stack that behaves like the browser where it matters for sessions: a pending transfer fails when
// the interface is released, a claim while another claim is open fails, and two reads at once are counted.
describe("one session at a time", () => {
  const BUTTON_WAIT = Uint8Array.from("7f120000000000010000030012080101010a6769746875622e636f6d".match(/../g)!.map((h) => Number.parseInt(h, 16)));
  const atr = Uint8Array.from([0x80, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0x3b]);
  const answer = (seq: number, data: number[]) => Uint8Array.from([0x80, data.length, 0, 0, 0, 0, seq, 0, 0, 0, ...data]);

  function usbKey() {
    const log: string[] = [];
    let claimed = false;
    let reading = 0;
    let maxReading = 0;
    let seq = 0;
    const waiting: ((e: Error) => void)[] = [];
    const queue: Uint8Array[] = [];
    let wake: (() => void) | null = null;
    const d = {
      serialNumber: "s1",
      productName: "K",
      manufacturerName: "M",
      opened: false,
      configuration: null as unknown,
      open: vi.fn(async () => {
        d.opened = true;
      }),
      selectConfiguration: vi.fn(async () => {
        d.configuration = { interfaces: [{ interfaceNumber: 3, alternate: { interfaceClass: 0xff, endpoints: [{ endpointNumber: 1, direction: "in", type: "bulk" }, { endpointNumber: 2, direction: "out", type: "bulk" }] } }] };
      }),
      claimInterface: vi.fn(async () => {
        if (claimed) throw new DOMException("The interface is already claimed.", "InvalidStateError");
        claimed = true;
        log.push("claim");
      }),
      releaseInterface: vi.fn(async () => {
        log.push("release");
        claimed = false;
        for (const fail of waiting.splice(0)) fail(new Error("The transfer was cancelled."));
        await new Promise((r) => setTimeout(r, 5));
      }),
      close: vi.fn(async () => {
        log.push("close");
        d.opened = false;
      }),
      transferOut: vi.fn(async (_ep: number, data: BufferSource) => {
        const b = new Uint8Array(data as Uint8Array);
        if (b[0] === 0x62) queue.push(atr);
        else if (b[0] === 0x6f) queue.push(answer(b[6]!, [0x90, 0x00]));
        seq = b[6]!;
        wake?.();
        return { status: "ok", bytesWritten: b.length };
      }),
      transferIn: vi.fn(async () => {
        reading += 1;
        maxReading = Math.max(maxReading, reading);
        try {
          while (!queue.length) {
            await new Promise<void>((resolve, reject) => {
              wake = resolve;
              waiting.push(reject);
            });
          }
          const r = queue.shift()!;
          return { status: "ok", data: new DataView(r.buffer, r.byteOffset, r.byteLength) };
        } finally {
          reading -= 1;
        }
      }),
    };
    return { d, log, push: (m: Uint8Array) => { queue.push(m); wake?.(); }, maxReading: () => maxReading, claimed: () => claimed, lastSeq: () => seq };
  }

  const connect = async (k: ReturnType<typeof usbKey>) => {
    fakeUsb(k.d as never);
    return new WebUsbKeyConnector().connect(1, 2);
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it("a command asked for right after the watcher was told to stop waits for it to release, then runs on its own claim", async () => {
    const k = usbKey();
    const c = await connect(k);
    const ctl = new AbortController();
    const watching = c.watchEvents(() => {}, ctl.signal);
    await settle();
    ctl.abort();
    const reply = c.transmit(Uint8Array.from([1]), 1000); // no await in between: the watcher is still cleaning up
    await watching;
    expect([...(await reply)]).toEqual([0x90, 0x00]);
    expect(k.maxReading()).toBe(1);
    expect(k.log.filter((e) => e === "claim")).toHaveLength(2);
    expect(k.log.filter((e) => e === "claim" || e === "release")).toEqual(["claim", "release", "claim"]);
  });

  it("refuses a command while it listens instead of reading at the same time", async () => {
    const k = usbKey();
    const c = await connect(k);
    const ctl = new AbortController();
    const watching = c.watchEvents(() => {}, ctl.signal);
    await settle();
    await expect(c.transmit(Uint8Array.from([1]), 1000)).rejects.toBeInstanceOf(SessionBusyError);
    await expect(c.watchEvents(() => {}, new AbortController().signal)).rejects.toBeInstanceOf(SessionBusyError);
    expect(k.maxReading()).toBe(1);
    ctl.abort();
    await watching;
    expect(k.claimed()).toBe(false);
  });

  it("rapid start, stop, start: every listener ends before the next one claims the interface, and no two reads overlap", async () => {
    const k = usbKey();
    const c = await connect(k);
    const events: string[] = [];
    const run = (name: string) => {
      const ctl = new AbortController();
      const p = c.watchEvents((e) => events.push(`${name}:${e.op}`), ctl.signal);
      return { ctl, p };
    };
    const a = run("a");
    await settle();
    a.ctl.abort();
    const b = run("b"); // asked for while a is still releasing
    await settle();
    k.push(BUTTON_WAIT); // b is the one listening now
    await settle();
    b.ctl.abort();
    const cc = run("c");
    await settle();
    cc.ctl.abort();
    await Promise.all([a.p, b.p, cc.p]);
    expect(k.maxReading()).toBe(1);
    expect(k.log.filter((e) => e === "claim")).toHaveLength(3);
    expect(k.log.filter((e) => e === "release")).toHaveLength(3);
    // claim/release strictly alternate: a new claim never starts before the previous release.
    k.log.filter((e) => e === "claim" || e === "release").forEach((e, i) => expect(e).toBe(i % 2 === 0 ? "claim" : "release"));
    expect(events).toEqual(["b:user-presence"]);
  });

  it("close() while listening ends the listener, releases the interface and closes the device", async () => {
    const k = usbKey();
    const c = await connect(k);
    const watching = c.watchEvents(() => {}, new AbortController().signal);
    await settle();
    await c.close();
    await watching;
    expect(k.claimed()).toBe(false);
    expect(k.log.at(-1)).toBe("close");
    expect(k.d.opened).toBe(false);
  });

  it("close() ends a command that is still waiting for its answer, without waiting for the timeout", async () => {
    const k = usbKey();
    k.d.transferOut.mockImplementation(async (_ep: number, data: BufferSource) => {
      const b = new Uint8Array(data as Uint8Array);
      if (b[0] === 0x62) k.push(atr); // power-on is answered, the command itself never is
      return { status: "ok", bytesWritten: b.length };
    });
    const c = await connect(k);
    const pending = c.transmit(Uint8Array.from([1]), 60_000);
    const failed = expect(pending).rejects.toBeDefined();
    await settle();
    await c.close();
    await failed;
    expect(k.claimed()).toBe(false);
  });

  it("reconnecting: a new connection to the same key claims only after the old one released", async () => {
    const k = usbKey();
    const first = await connect(k);
    const watching = first.watchEvents(() => {}, new AbortController().signal);
    await settle();
    const second = await connect(k);
    await first.close();
    await watching;
    expect([...(await second.transmit(Uint8Array.from([1]), 1000))]).toEqual([0x90, 0x00]);
    expect(k.maxReading()).toBe(1);
  });

  it("a command that never gets an answer does not block the next one, which starts on a fresh claim", async () => {
    vi.useFakeTimers();
    const k = usbKey();
    let first = true;
    k.d.transferOut.mockImplementation(async (_ep: number, data: BufferSource) => {
      const b = new Uint8Array(data as Uint8Array);
      if (b[0] === 0x62) k.push(atr);
      else if (b[0] === 0x6f && !first) k.push(answer(b[6]!, [0x90, 0x00]));
      else first = false;
      return { status: "ok", bytesWritten: b.length };
    });
    const c = await connect(k);
    const one = c.transmit(Uint8Array.from([1]), 1000);
    const lost = expect(one).rejects.toBeInstanceOf(NoAnswerError);
    const two = c.transmit(Uint8Array.from([2]), 1000);
    await vi.advanceTimersByTimeAsync(1010); // the timeout, then the 5 ms the interface takes to be released
    await lost;
    await vi.advanceTimersByTimeAsync(200);
    expect([...(await two)]).toEqual([0x90, 0x00]);
    expect(k.maxReading()).toBe(1);
  });
});
