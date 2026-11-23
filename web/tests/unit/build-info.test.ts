import { describe, expect, it } from "vitest";
import { matchPublished } from "@/lib/device/build-match";
import { buildInfoApdu, chipModelName, parseBuildInfo, resetReasonName } from "@/lib/device/mkauth";
import type { CatalogRelease } from "@/lib/firmware/catalog";
import { validateManifest } from "@/lib/firmware/manifest";
import { formatUptime } from "@/lib/format";
import { makeFirmware } from "../fixtures/firmware";

// Built by hand from the spec (docs/PROTOCOLS.md), like host/multikey-proto/tests/build_info.rs.
const entry = (tag: number, value: ArrayLike<number>) => [tag, value.length, ...Array.from(value)];
const text = (s: string) => Array.from(new TextEncoder().encode(s));

function full(): Uint8Array {
  return Uint8Array.from([
    0x01,
    ...entry(0x01, text("multikey-fido")),
    ...entry(0x02, text("0.3.0")),
    ...entry(0x03, text("v5.5.6")),
    ...entry(0x04, text("281fae077113+dirty")),
    ...entry(0x05, new Array(32).fill(0xab)),
    ...entry(0x06, new Array(32).fill(0xcd)),
    ...entry(0x07, text("16MB")),
    ...entry(0x08, [0x01, 0x00, 0x00, 0x00]),
    ...entry(0x09, [0x02]),
    ...entry(0x0a, [0x09, 0x00, 0x00, 0x02]),
    ...entry(0x0b, [0x01]),
    ...entry(0x0c, [0x00, 0x00, 0x01, 0x2c]),
    ...entry(0x0d, [0x00, 0x02, 0x00, 0x00, ...text("factory")]),
  ]);
}

describe("parseBuildInfo", () => {
  it("reads every field", () => {
    const i = parseBuildInfo(full());
    expect(i).toEqual({
      project: "multikey-fido",
      version: "0.3.0",
      idfVersion: "v5.5.6",
      commit: "281fae077113+dirty",
      imageSha256: "ab".repeat(32),
      elfSha256: "cd".repeat(32),
      flashBuiltFor: "16MB",
      flashChipBytes: 16 * 1024 * 1024,
      flashEncryption: false,
      secureBoot: true,
      chipModel: 9,
      chipRevision: 0,
      chipCores: 2,
      resetReason: 1,
      uptimeSeconds: 300,
      partitionOffset: 0x20000,
      partitionLabel: "factory",
    });
    expect(chipModelName(9)).toBe("ESP32-S3");
    expect(resetReasonName(1)).toBe("power-on");
  });

  it("accepts a subset and skips unknown tags", () => {
    const i = parseBuildInfo(Uint8Array.from([0x01, ...entry(0x02, text("0.4.0")), ...entry(0x7e, text("from the future"))]));
    expect(i).toEqual({ version: "0.4.0" });
  });

  it("rejects malformed responses", () => {
    expect(() => parseBuildInfo(new Uint8Array(0))).toThrow();
    expect(() => parseBuildInfo(Uint8Array.from([0x02]))).toThrow(/format/);
    expect(() => parseBuildInfo(full().subarray(0, full().length - 3))).toThrow(); // truncated entry
    expect(() => parseBuildInfo(Uint8Array.from([0x01, 0x02]))).toThrow(); // tag without a length
    expect(() => parseBuildInfo(Uint8Array.from([0x01, ...entry(2, text("1")), ...entry(2, text("2"))]))).toThrow(/repeated/);
    expect(() => parseBuildInfo(Uint8Array.from([0x01, ...entry(0x05, new Array(31).fill(0))]))).toThrow(/length/);
    expect(() => parseBuildInfo(Uint8Array.from([0x01, ...entry(0x08, [0, 0, 0])]))).toThrow(/length/);
  });

  it("refuses text that could inject control characters or non-ASCII", () => {
    for (const bad of [[0x30, 0x1b, 0x5b, 0x32, 0x4a], [0x76, 0xc3, 0xa9], [0x74, 0x09]]) {
      expect(() => parseBuildInfo(Uint8Array.from([0x01, ...entry(0x02, bad)]))).toThrow(/ASCII/);
    }
  });

  it("builds a plain read APDU", () => {
    expect([...buildInfoApdu()]).toEqual([0x80, 0x07, 0x00, 0x00, 0x00]);
  });
});

describe("matchPublished", () => {
  async function releases(): Promise<{ list: CatalogRelease[]; appSha: Record<string, string> }> {
    const fw = await makeFirmware();
    const manifest = validateManifest(fw.manifest, fw.manifest.tag, false);
    const appSha: Record<string, string> = {};
    for (const b of manifest.builds) appSha[b.profile_id] = b.images.find((i) => i.role === "app")!.sha256;
    return { list: [{ tag: manifest.tag, name: "r", prerelease: false, publishedAt: null, notesUrl: null, manifest, authentication: { status: "unsigned" } }], appSha };
  }

  it("matches the app image of exactly one build, whatever the letter case", async () => {
    const { list, appSha } = await releases();
    const m = matchPublished(appSha["esp32s3-4mb"]!.toUpperCase(), list);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ profileId: "esp32s3-4mb", flashSize: "4MB" });
  });

  it("does not match an unknown image, nor a bootloader hash", async () => {
    const { list } = await releases();
    expect(matchPublished("00".repeat(32), list)).toEqual([]);
    const boot = list[0]!.manifest.builds[0]!.images.find((i) => i.role === "bootloader")!.sha256;
    expect(matchPublished(boot, list)).toEqual([]);
  });
});

describe("formatUptime", () => {
  it("uses units that read the same in every language", () => {
    expect(formatUptime(5)).toBe("5 s");
    expect(formatUptime(185)).toBe("3 min 5 s");
    expect(formatUptime(7500)).toBe("2 h 5 min");
  });
});
