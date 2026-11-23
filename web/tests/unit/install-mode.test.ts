import { describe, expect, it } from "vitest";
import type { AppDescriptor } from "@/lib/flashing/app-descriptor";
import { decideInstallMode } from "@/lib/flashing/install-mode";
import type { TableResult } from "@/lib/flashing/partition-table";
import { makeFirmware, PARTITIONS } from "../fixtures/firmware";

const { build } = await makeFirmware();
const app = (version: string, project = "multikey-fido"): AppDescriptor => ({ version, project_name: project, time: "", date: "", idf_ver: "" });
const T = (status: TableResult["status"]): TableResult => ({ status, detail: status });

const protectedRanges = PARTITIONS.filter((p) => ["nvs", "phy_init", "part0"].includes(p.name));
const touchesProtected = (w: { offset: number; length: number }) =>
  protectedRanges.some((p) => w.offset < p.offset + p.size && w.offset + w.length > p.offset);

describe("decideInstallMode", () => {
  it("blank -> first-install", () => {
    const d = decideInstallMode({ table: T("blank"), app: null, build });
    expect(d.mode).toBe("first-install");
    expect(d.acks).toEqual(["dev-firmware"]);
    expect(d.writes.map((w) => w.offset)).toEqual([0, 0x8000, 0x20000]);
  });

  it("match + fido 0.2.0 -> update", () => {
    expect(decideInstallMode({ table: T("match"), app: app("0.2.0"), build }).mode).toBe("update");
  });

  it("match + 0.1.0-dev -> update-unverified with its ack", () => {
    const d = decideInstallMode({ table: T("match"), app: app("0.1.0-dev"), build });
    expect(d.mode).toBe("update-unverified");
    expect(d.acks).toContain("update-unverified");
  });

  it("match + newer 0.3.0 (downgrade) -> update-unverified", () => {
    expect(decideInstallMode({ table: T("match"), app: app("0.3.0"), build }).mode).toBe("update-unverified");
  });

  it("match + non-semver version -> update-unverified", () => {
    expect(decideInstallMode({ table: T("match"), app: app("1.89"), build }).mode).toBe("update-unverified");
  });

  it("match + openpgp -> switch-image", () => {
    const d = decideInstallMode({ table: T("match"), app: app("0.2.0", "multikey-openpgp"), build });
    expect(d.mode).toBe("switch-image");
    expect(d.acks).toContain("switch-image");
  });

  it("match + no app -> replace-compatible-layout", () => {
    const d = decideInstallMode({ table: T("match"), app: null, build });
    expect(d.mode).toBe("replace-compatible-layout");
    expect(d.acks).toContain("replace-layout");
  });

  it("mismatch + foreign app -> repurpose: fill nvs, fill part0, bootloader, table, app", () => {
    const d = decideInstallMode({ table: T("mismatch"), app: app("1.0", "esp-demo"), build });
    expect(d.mode).toBe("repurpose");
    expect(d.acks).toContain("repurpose-typed");
    expect(d.writes.map((w) => `${w.kind}:${w.role}@${w.offset}+${w.length}`)).toEqual([
      `fill:nvs@${0x11000}+${0x6000}`,
      `fill:part0@${0x200000}+${0x100000}`,
      "image:bootloader@0+20480",
      `image:partition-table@${0x8000}+3072`,
      `image:app@${0x20000}+${0x4000}`,
    ]);
  });

  it("garbage + no app -> repurpose", () => {
    expect(decideInstallMode({ table: T("garbage"), app: null, build }).mode).toBe("repurpose");
  });

  it("mismatch + MultiKeys app -> blocked storage-incompatible", () => {
    const d = decideInstallMode({ table: T("mismatch"), app: app("0.2.0"), build });
    expect(d).toMatchObject({ mode: "blocked", allowed: false, reason: "storage-incompatible", writes: [] });
  });

  it("never writes a protected partition outside repurpose", () => {
    for (const [table, a] of [
      ["blank", null],
      ["match", app("0.2.0")],
      ["match", app("0.1.0-dev")],
      ["match", app("0.2.0", "multikey-openpgp")],
      ["match", null],
      ["mismatch", app("0.2.0")],
    ] as const) {
      const d = decideInstallMode({ table: T(table), app: a, build });
      expect(d.mode).not.toBe("repurpose");
      expect(d.writes.filter(touchesProtected)).toEqual([]);
    }
  });
});
