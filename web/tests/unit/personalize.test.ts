import { describe, expect, it } from "vitest";
import { FirmwareError } from "@/lib/errors/firmware-error";
import type { KeyConnection } from "@/lib/device/key-connector";
import { applyNameRequest, type NameStatus, type Timing } from "@/lib/device/personalize";
import { NoAnswerError } from "@/lib/device/webccid";

const enc = (s: string) => new TextEncoder().encode(s);
const sw = (data: number[], code: number) => Uint8Array.from([...data, code >> 8, code & 0xff]);
const nameResp = (flags: number, name: string) => sw([flags, ...enc(name)], 0x9000);
const info = (enrolled: boolean) => sw([1, enrolled ? 1 : 0, 0, ...new Array<number>(16).fill(1), ...(enrolled ? new Array<number>(65).fill(4) : [])], 0x9000);
const SELECT = sw([...enc("MKAUTH 1")], 0x9000);
const DEFAULT = "MultiKeys Security Key";
const PIN = "246810";

interface Opts {
  /** Answers in order; "silent" is a command the key never answers. */
  responses: (Uint8Array | "silent")[];
  reenum?: "ok" | "timeout";
  product?: string;
}

const NO_WAIT: Timing = { settleMs: 0, initialAttempts: 3, restartAttempts: 6, readTimeoutMs: 1, pauseMs: 0 };

function fake(o: Opts) {
  const sent: Uint8Array[] = [];
  const queue = [...o.responses];
  const conn: KeyConnection = {
    async identity() {
      return { productName: o.product ?? null, manufacturerName: null, serialNumber: "s" };
    },
    async transmit(apdu) {
      sent.push(apdu);
      const r = queue.shift();
      if (!r) throw new Error("unexpected transmit");
      if (r === "silent") throw new NoAnswerError("silent");
      return r;
    },
    async waitForReenumeration() {
      if (o.reenum === "timeout") throw new FirmwareError("name-not-verified", "timeout");
    },
    async watchEvents() {},
    async close() {},
  };
  return { conn, sent };
}

async function run(o: Opts, req: Parameters<typeof applyNameRequest>[1], pin: string | null = null) {
  const f = fake(o);
  const statuses: NameStatus[] = [];
  const out = await applyNameRequest(f.conn, req, DEFAULT, pin, (s) => statuses.push(s), NO_WAIT);
  return { ...f, out, statuses };
}

const custom = { mode: "custom", name: "Mew" } as const;
const ok = sw([], 0x9000);

describe("applyNameRequest", () => {
  it("keep does not transmit", async () => {
    const r = await run({ responses: [] }, { mode: "keep" });
    expect(r.out).toEqual({ status: "kept", name: null });
    expect(r.sent).toHaveLength(0);
    expect(r.statuses).toEqual([]);
  });

  it("verifies without writing when already correct (custom and default)", async () => {
    const a = await run({ responses: [SELECT, nameResp(5, "Mew")] }, custom);
    expect(a.out).toEqual({ status: "verified", name: "Mew" });
    expect(a.sent).toHaveLength(2);
    const b = await run({ responses: [SELECT, nameResp(4, DEFAULT)] }, { mode: "default" });
    expect(b.out.status).toBe("verified");
    expect(b.sent).toHaveLength(2);
  });

  it("asks for the PIN when enrolled, without writing", async () => {
    const r = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(true)] }, custom);
    expect(r.out.status).toBe("needs-pin");
    expect(r.sent).toHaveLength(3);
    expect(r.statuses).toEqual(["connecting"]);
  });

  it("writes, re-enumerates and verifies; PIN only in the SET APDU", async () => {
    const r = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(true), ok, SELECT, nameResp(5, "Mew")], product: "Mew" }, custom, PIN);
    expect(r.out).toEqual({ status: "verified", name: "Mew" });
    expect(r.statuses).toEqual(["connecting", "press-button", "reconnecting", "connecting"]);
    const pin = enc(PIN).join(",");
    const holders = r.sent.map((a, i) => [i, a.join(",").includes(pin)] as const).filter(([, h]) => h).map(([i]) => i);
    expect(holders).toEqual([3]);
    expect([...r.sent[3]!.subarray(0, 4)]).toEqual([0x80, 6, 1, 1]);
  });

  it("uses CLEAR for the default name", async () => {
    const r = await run({ responses: [SELECT, nameResp(5, "Mew"), info(false), ok, SELECT, nameResp(4, DEFAULT)], product: DEFAULT }, { mode: "default" });
    expect(r.out.status).toBe("verified");
    expect([...r.sent[3]!.subarray(0, 4)]).toEqual([0x80, 6, 2, 1]);
  });

  it("maps a wrong PIN with tries left", async () => {
    const r = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(true), sw([], 0x63c7)] }, custom, PIN);
    expect(r.out).toMatchObject({ status: "failed", error: "name-pin-wrong", triesLeft: 7 });
  });

  it("maps button timeout, rename disabled and blocked PIN", async () => {
    const t = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), sw([], 0x6300)] }, custom);
    expect(t.out).toMatchObject({ status: "failed", error: "name-button-timeout" });
    const d = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), sw([], 0x6985)] }, custom);
    expect(d.out).toMatchObject({ status: "failed", error: "name-rename-disabled" });
    const b = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(true), sw([], 0x6983)] }, custom, PIN);
    expect(b.out).toMatchObject({ status: "failed", error: "name-pin-blocked" });
  });

  it("fails with name-rename-disabled when the firmware cannot rename", async () => {
    const r = await run({ responses: [SELECT, nameResp(0, DEFAULT)] }, custom);
    expect(r.out).toMatchObject({ status: "failed", error: "name-rename-disabled" });
    expect(r.sent).toHaveLength(2);
  });

  it("fails on a bad SELECT", async () => {
    const r = await run({ responses: [sw([], 0x6a82)] }, custom);
    expect(r.out).toMatchObject({ status: "failed", error: "name-failed" });
  });

  it("reports unverified when the key does not come back", async () => {
    const r = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), ok], reenum: "timeout" }, custom);
    expect(r.out).toMatchObject({ status: "unverified", error: "name-not-verified" });
  });

  it("reports unverified when the name differs afterwards", async () => {
    const r = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), ok, SELECT, nameResp(5, "Mew")], product: DEFAULT }, custom);
    expect(r.out.status).toBe("unverified");
    const s = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), ok, SELECT, nameResp(4, DEFAULT)], product: "Mew" }, custom);
    expect(s.out.status).toBe("unverified");
    const p = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), ok, SELECT, nameResp(7, "Mew")], product: "Mew" }, custom);
    expect(p.out.status).toBe("unverified");
  });

  it("turns unexpected exceptions into failed/name-failed", async () => {
    const r = await run({ responses: [] }, custom);
    expect(r.out).toMatchObject({ status: "failed", error: "name-failed" });
  });

  it("reads again, on a fresh claim, while a restarted key stays silent", async () => {
    const r = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), ok, "silent", "silent", SELECT, nameResp(5, "Mew")], product: "Mew" }, custom);
    expect(r.out).toEqual({ status: "verified", name: "Mew" });
    expect(r.statuses).toEqual(["connecting", "press-button", "reconnecting", "connecting"]);
    expect(r.sent).toHaveLength(8);
  });

  it("reports the name as not confirmed, not a missed button, when the key never answers after accepting it", async () => {
    const r = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), ok, ...new Array<"silent">(6).fill("silent")], product: "Mew" }, custom);
    expect(r.out).toMatchObject({ status: "unverified", error: "name-not-verified" });
  });

  it("checks the name when the write itself got no answer: verified if it changed, no answer if it did not", async () => {
    const changed = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), "silent", SELECT, nameResp(5, "Mew")], product: "Mew" }, custom);
    expect(changed.out).toEqual({ status: "verified", name: "Mew" });
    const unchanged = await run({ responses: [SELECT, nameResp(4, DEFAULT), info(false), "silent", SELECT, nameResp(4, DEFAULT)], product: DEFAULT }, custom);
    expect(unchanged.out).toMatchObject({ status: "failed", error: "name-transport-unavailable" });
  });

  it("repeats a dropped first read before anything is written", async () => {
    const r = await run({ responses: ["silent", SELECT, nameResp(5, "Mew")] }, custom);
    expect(r.out).toEqual({ status: "verified", name: "Mew" });
    expect(r.sent).toHaveLength(3);
  });
});
