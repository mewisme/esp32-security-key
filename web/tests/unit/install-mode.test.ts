import { describe, expect, it } from "vitest";
import type { AppDescriptor } from "@/lib/flashing/app-descriptor";
import { decideInstallMode } from "@/lib/flashing/install-mode";
import type { TableResult } from "@/lib/flashing/partition-table";
import { makeFirmware, PARTITIONS } from "../fixtures/firmware";

const { build } = await makeFirmware();
const app = (version: string, project = "multikey-fido"): AppDescriptor => ({ version, project_name: project, time: "", date: "", idf_ver: "" });
const T = (status: TableResult["status"]): TableResult => ({ status, detail: status });
const decide = (input: { table: TableResult; app: AppDescriptor | null; untestedHardware?: boolean }) =>
  decideInstallMode({ build, untestedHardware: false, ...input });

const protectedRanges = PARTITIONS.filter((p) => ["nvs", "phy_init", "part0"].includes(p.name));
const touchesProtected = (w: { offset: number; length: number }) =>
  protectedRanges.some((p) => w.offset < p.offset + p.size && w.offset + w.length > p.offset);

describe("decideInstallMode", () => {
  it("blank -> first-install", () => {
    const d = decide({ table: T("blank"), app: null });
    expect(d.mode).toBe("first-install");
    expect(d.acks).toEqual(["dev-firmware"]);
    expect(d.writes.map((w) => w.offset)).toEqual([0, 0x8000, 0x20000]);
  });

  it("match + fido 0.2.0 -> update", () => {
    expect(decide({ table: T("match"), app: app("0.2.0") }).mode).toBe("update");
  });

  it.each([
    ["0.1.0-dev (older than the declared data-compatible range)", "0.1.0-dev"],
    ["0.3.0 (newer than this release: a downgrade)", "0.3.0"],
    ["1.89 (not a version number)", "1.89"],
  ])("match + %s -> update-forced: three images, never a protected region, needs the tick and FORCE typed", (_label, version) => {
    const d = decide({ table: T("match"), app: app(version) });
    expect(d).toMatchObject({ mode: "update-forced", allowed: true });
    expect(d.acks).toEqual(["dev-firmware", "force-storage", "force-typed"]);
    expect(d.writes.map((w) => w.offset)).toEqual([0, 0x8000, 0x20000]);
    expect(d.writes.some(touchesProtected)).toBe(false);
  });

  it("match + openpgp -> switch-image, which also needs SWITCH typed", () => {
    const d = decide({ table: T("match"), app: app("0.2.0", "multikey-openpgp") });
    expect(d.mode).toBe("switch-image");
    expect(d.acks).toEqual(["dev-firmware", "switch-image", "switch-image-typed"]);
  });

  it("an OpenPGP build needs the experimental acknowledgement in every installing mode", async () => {
    const pgp = (await makeFirmware({ images: ["openpgp"] })).build;
    const run = (table: TableResult, a: AppDescriptor | null, untestedHardware = false) =>
      decideInstallMode({ build: pgp, untestedHardware, table, app: a });
    expect(run(T("blank"), null).acks).toEqual(["dev-firmware", "experimental-image"]);
    expect(run(T("match"), app("0.2.0", "multikey-openpgp")).mode).toBe("update");
    expect(run(T("match"), app("0.2.0", "multikey-openpgp")).acks).toEqual(["dev-firmware", "experimental-image"]);
    expect(run(T("match"), app("0.2.0")).acks).toEqual(["dev-firmware", "switch-image", "switch-image-typed", "experimental-image"]);
    expect(run(T("mismatch"), app("1.0", "esp-demo")).acks).toContain("experimental-image");
    expect(run(T("blank"), null, true).acks).toEqual(["dev-firmware", "experimental-image", "untested-hardware"]);
  });

  it("a FIDO2 build never asks for the experimental acknowledgement", () => {
    expect(decide({ table: T("blank"), app: null }).acks).not.toContain("experimental-image");
  });

  it("match + no app -> replace-compatible-layout", () => {
    const d = decide({ table: T("match"), app: null });
    expect(d.mode).toBe("replace-compatible-layout");
    expect(d.acks).toContain("replace-layout");
  });

  it("mismatch + foreign app -> repurpose: fill nvs, fill part0, bootloader, table, app", () => {
    const d = decide({ table: T("mismatch"), app: app("1.0", "esp-demo") });
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
    expect(decide({ table: T("garbage"), app: null }).mode).toBe("repurpose");
  });

  it("mismatch + MultiKeys app -> blocked storage-incompatible", () => {
    const d = decide({ table: T("mismatch"), app: app("0.2.0") });
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
      const d = decide({ table: T(table), app: a });
      expect(d.mode).not.toBe("repurpose");
      expect(d.writes.filter(touchesProtected)).toEqual([]);
    }
  });
});

describe("decideInstallMode on hardware that is not verified", () => {
  const CASES: [string, TableResult, AppDescriptor | null][] = [
    ["first-install", T("blank"), null],
    ["update", T("match"), app("0.2.0")],
    ["switch-image", T("match"), app("0.2.0", "multikey-openpgp")],
    ["replace-compatible-layout", T("match"), null],
    ["repurpose", T("mismatch"), app("1.0", "esp-demo")],
  ];

  it.each(CASES)("%s additionally needs untested-hardware", (mode, table, a) => {
    const plain = decide({ table, app: a });
    const untested = decide({ table, app: a, untestedHardware: true });
    expect(untested.mode).toBe(mode);
    expect(untested.acks).toEqual([...plain.acks, "untested-hardware"]);
    expect(untested.writes).toEqual(plain.writes);
  });

  it("does not add an acknowledgement to a blocked install", () => {
    const d = decide({ table: T("mismatch"), app: app("0.2.0"), untestedHardware: true });
    expect(d).toMatchObject({ mode: "blocked", allowed: false, acks: [] });
  });
});
