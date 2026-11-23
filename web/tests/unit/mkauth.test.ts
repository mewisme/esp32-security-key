import { describe, expect, it } from "vitest";
import { getInfoApdu, nameClearApdu, nameGetApdu, nameSetApdu, parseDeviceName, parseInfo, selectApdu, splitSw, swToNameError } from "@/lib/device/mkauth";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");
const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (n: number, v = 0) => new Uint8Array(n).fill(v);

describe("APDUs", () => {
  it("builds the byte-exact vectors", () => {
    expect(hex(nameSetApdu(new Uint8Array(0), "My Key", true))).toBe("80 06 01 01 07 00 4d 79 20 4b 65 79 00");
    expect(hex(nameClearApdu(enc("123456"), true))).toBe("80 06 02 01 07 06 31 32 33 34 35 36 00");
    expect(hex(nameClearApdu(new Uint8Array(0), false))).toBe("80 06 02 00 01 00 00");
  });

  it("builds SELECT, GET_INFO and GET", () => {
    expect(hex(selectApdu())).toBe("00 a4 04 00 08 f0 4d 4b 41 55 54 48 01");
    expect(hex(getInfoApdu())).toBe("80 01 00 00 00");
    expect(hex(nameGetApdu())).toBe("80 06 00 00 00");
  });

  it("rejects invalid names", () => {
    const none = new Uint8Array(0);
    for (const n of ["", "a".repeat(32), "Mêw", " x", "x ", "a\tb"]) expect(() => nameSetApdu(none, n, true)).toThrow();
    expect(() => nameSetApdu(none, "a".repeat(31), true)).not.toThrow();
  });

  it("checks PIN lengths", () => {
    for (const n of [1, 5, 64]) {
      expect(() => nameSetApdu(bytes(n, 0x31), "Key", true)).toThrow();
      expect(() => nameClearApdu(bytes(n, 0x31), true)).toThrow();
    }
    for (const n of [0, 6, 63]) expect(() => nameSetApdu(bytes(n, 0x31), "Key", true)).not.toThrow();
  });
});

describe("parseDeviceName", () => {
  it("decodes flags", () => {
    expect(parseDeviceName(Uint8Array.from([0x05, ...enc("Mew")]))).toEqual({ custom: true, reenumerationPending: false, renameSupported: true, name: "Mew" });
    expect(parseDeviceName(Uint8Array.from([0x02, ...enc("A")]))).toEqual({ custom: false, reenumerationPending: true, renameSupported: false, name: "A" });
    expect(parseDeviceName(Uint8Array.from([0x00, ...enc("A")])).renameSupported).toBe(false);
  });

  it("rejects bad lengths and flags", () => {
    expect(() => parseDeviceName(new Uint8Array(0))).toThrow();
    expect(() => parseDeviceName(Uint8Array.from([0x05]))).toThrow();
    expect(() => parseDeviceName(Uint8Array.from([0x05, ...enc("a".repeat(32))]))).toThrow();
    expect(parseDeviceName(Uint8Array.from([0x05, ...enc("a".repeat(31))])).name).toHaveLength(31);
    expect(() => parseDeviceName(Uint8Array.from([0x08, ...enc("a")]))).toThrow();
    expect(() => parseDeviceName(Uint8Array.from([0x05, 0xff, 0xfe]))).toThrow();
  });
});

describe("parseInfo", () => {
  const info = (state: number, tail: number) => Uint8Array.from([1, state, 0, ...bytes(16, 7), ...bytes(tail, 4)]);
  it("parses unenrolled and enrolled", () => {
    expect(parseInfo(info(0, 0))).toEqual({ enrolled: false, deviceId: bytes(16, 7) });
    expect(parseInfo(info(1, 65)).enrolled).toBe(true);
  });
  it("rejects bad lengths, version and state", () => {
    expect(() => parseInfo(info(0, 1))).toThrow();
    expect(() => parseInfo(info(1, 0))).toThrow();
    expect(() => parseInfo(bytes(18))).toThrow();
    expect(() => parseInfo(Uint8Array.from([2, ...info(0, 0).subarray(1)]))).toThrow();
    expect(() => parseInfo(info(2, 0))).toThrow();
  });
});

describe("status words", () => {
  it("splits", () => {
    expect(splitSw(Uint8Array.from([1, 2, 0x90, 0x00]))).toEqual({ data: Uint8Array.from([1, 2]), sw: 0x9000 });
    expect(splitSw(Uint8Array.from([0x63, 0xc3])).data).toHaveLength(0);
    expect(() => splitSw(Uint8Array.from([0x90]))).toThrow();
  });
  it("maps to errors", () => {
    expect(swToNameError(0x63c3)).toBe("name-pin-wrong");
    expect(swToNameError(0x63c0)).toBe("name-pin-wrong");
    expect(swToNameError(0x6985)).toBe("name-rename-disabled");
    expect(swToNameError(0x6300)).toBe("name-button-timeout");
    expect(swToNameError(0x6983)).toBe("name-pin-blocked");
    expect(swToNameError(0x6a80)).toBe("name-failed");
  });
});
