import { describe, expect, it, vi } from "vitest";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { NoAnswerError, WebCcid } from "@/lib/device/webccid";

type Reply = Uint8Array | "hang" | ((out: Uint8Array[]) => Uint8Array);

function msg(type: number, seq: number, data: number[] = [], b7 = 0, b8 = 0): Uint8Array {
  return Uint8Array.from([type, data.length & 0xff, data.length >> 8, 0, 0, 0, seq, b7, b8, 0, ...data]);
}

function fakeDevice(opts: { cls?: number; replies?: Reply[]; failClose?: boolean } = {}) {
  const sent: Uint8Array[] = [];
  const events: string[] = [];
  const replies = [...(opts.replies ?? [])];
  const endpoints = [
    { endpointNumber: 1, direction: "in", type: "bulk", packetSize: 64 },
    { endpointNumber: 2, direction: "out", type: "bulk", packetSize: 64 },
  ];
  const dev = {
    opened: false,
    configuration: null as unknown,
    open: vi.fn(async () => {
      dev.opened = true;
    }),
    selectConfiguration: vi.fn(async () => {
      dev.configuration = { interfaces: [{ interfaceNumber: 0, alternate: { interfaceClass: 0x0b, endpoints: [] } }, { interfaceNumber: 3, alternate: { interfaceClass: opts.cls ?? 0xff, endpoints } }] };
    }),
    claimInterface: vi.fn(async (n: number) => void events.push(`claim ${n}`)),
    releaseInterface: vi.fn(async (n: number) => {
      events.push(`release ${n}`);
      if (opts.failClose) throw new Error("gone");
    }),
    close: vi.fn(async () => {
      events.push("close");
      if (opts.failClose) throw new Error("gone");
    }),
    transferOut: vi.fn(async (_ep: number, data: BufferSource) => {
      sent.push(new Uint8Array(data as Uint8Array));
      return { status: "ok", bytesWritten: (data as Uint8Array).length };
    }),
    transferIn: vi.fn(async () => {
      const r = replies.shift();
      if (r === "hang") return new Promise<never>(() => {});
      if (!r) throw new Error("no scripted reply");
      const bytes = typeof r === "function" ? r(sent) : r;
      return { status: "ok", data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
    }),
  };
  return { dev, sent, events, usb: dev as unknown as USBDevice };
}

const atr = msg(0x80, 0, [0x3b, 0x00]);

describe("WebCcid", () => {
  it("claims the 0xFF interface and sends IccPowerOn first", async () => {
    const f = fakeDevice({ replies: [atr] });
    await WebCcid.open(f.usb);
    expect(f.dev.selectConfiguration).toHaveBeenCalledWith(1);
    expect(f.events).toEqual(["claim 3"]);
    expect([...f.sent[0]!]).toEqual([0x62, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("sends XfrBlock with LE length and increasing seq, returns the data", async () => {
    const apdu = new Uint8Array(300).fill(1);
    const f = fakeDevice({ replies: [atr, msg(0x80, 1, [9, 0x90, 0]), msg(0x80, 2, [0x90, 0])] });
    const c = await WebCcid.open(f.usb);
    expect([...(await c.transmit(apdu, 1000))]).toEqual([9, 0x90, 0]);
    expect([...f.sent[1]!.subarray(0, 10)]).toEqual([0x6f, 0x2c, 0x01, 0, 0, 0, 1, 0, 0, 0]);
    expect(f.sent[1]!.length).toBe(310);
    await c.transmit(Uint8Array.from([1]), 1000);
    expect(f.sent[2]![6]).toBe(2);
  });

  it("keeps reading through a time extension", async () => {
    const f = fakeDevice({ replies: [atr, msg(0x80, 1, [], 0x80, 1), msg(0x80, 1, [0x90, 0])] });
    const c = await WebCcid.open(f.usb);
    expect([...(await c.transmit(Uint8Array.from([1]), 1000))]).toEqual([0x90, 0]);
  });

  it("skips wrong-seq and non-DataBlock messages", async () => {
    const f = fakeDevice({ replies: [atr, msg(0x50, 0, [1]), msg(0x80, 7, [2]), msg(0x80, 1, [0x90, 0])] });
    const c = await WebCcid.open(f.usb);
    expect([...(await c.transmit(Uint8Array.from([1]), 1000))]).toEqual([0x90, 0]);
  });

  it("reassembles a response split across 64-byte packets", async () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const whole = msg(0x80, 1, data);
    const f = fakeDevice({ replies: [atr, whole.slice(0, 64), whole.slice(64)] });
    const c = await WebCcid.open(f.usb);
    expect([...(await c.transmit(Uint8Array.from([1]), 1000))]).toEqual(data);
  });

  it("maps a CCID error flag to name-failed", async () => {
    const f = fakeDevice({ replies: [atr, msg(0x80, 1, [], 0x40, 0xfe)] });
    const c = await WebCcid.open(f.usb);
    await expect(c.transmit(Uint8Array.from([1]), 1000)).rejects.toMatchObject({ code: "name-failed", detail: "CCID error 0xfe" });
  });

  it("throws name-transport-unavailable without a class 0xFF interface", async () => {
    const f = fakeDevice({ cls: 0x03 });
    await expect(WebCcid.open(f.usb)).rejects.toMatchObject({ code: "name-transport-unavailable" });
    expect(f.dev.claimInterface).not.toHaveBeenCalled();
  });

  it("rejects NoAnswerError, never a button timeout, when the key stays silent", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeDevice({ replies: [atr, "hang"] });
      const c = await WebCcid.open(f.usb);
      const p = c.transmit(Uint8Array.from([1]), 25000);
      const assertion = expect(p).rejects.toBeInstanceOf(FirmwareError);
      await vi.advanceTimersByTimeAsync(25000);
      await assertion;
      await expect(p).rejects.toMatchObject({ code: "name-transport-unavailable" });
      await expect(p).rejects.toBeInstanceOf(NoAnswerError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an abandoned exchange stops reading, so it cannot swallow the answer of the next one", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeDevice({ replies: [atr] });
      const c = await WebCcid.open(f.usb);
      let release: (reply: unknown) => void = () => {};
      f.dev.transferIn.mockImplementationOnce((() => new Promise((resolve) => (release = resolve))) as never);
      const p = c.transmit(Uint8Array.from([1]), 1000);
      const assertion = expect(p).rejects.toBeInstanceOf(NoAnswerError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      const reads = f.dev.transferIn.mock.calls.length;
      const lateTimeExtension = msg(0x80, 1, [], 0x80);
      release({ status: "ok", data: new DataView(lateTimeExtension.buffer) });
      await vi.advanceTimersByTimeAsync(10);
      expect(f.dev.transferIn.mock.calls.length).toBe(reads);
    } finally {
      vi.useRealTimers();
    }
  });

  it("close releases and closes, ignoring errors", async () => {
    const f = fakeDevice({ replies: [atr], failClose: true });
    const c = await WebCcid.open(f.usb);
    await expect(c.close()).resolves.toBeUndefined();
    expect(f.events).toEqual(["claim 3", "release 3", "close"]);
  });
});
