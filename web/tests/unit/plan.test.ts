import { beforeAll, describe, expect, it } from "vitest";
import type { AppUpdateInput } from "@/lib/flashing/app-update";
import type { InstallDecision } from "@/lib/flashing/install-mode";
import { md5Hex } from "@/lib/flashing/md5";
import { planFlash } from "@/lib/flashing/plan";
import { appImage, entry, type FirmwareFixture, makeFirmware, PARTITIONS, partitionTable } from "../fixtures/firmware";

let appOnly: FirmwareFixture;

beforeAll(async () => {
  appOnly = await makeFirmware({ appOnly: true, version: "0.3.3", tag: "v0.3.3", images: ["fido", "openpgp"] });
});

const desc = (version: string, project = "multikey-fido") => appImage(version, project).subarray(0, 256);

function input(over: Partial<AppUpdateInput> = {}, installed = "0.3.1"): AppUpdateInput {
  const build = appOnly.builds.find((b) => b.image === "fido" && b.profile_id === "esp32s3-16mb")!;
  const image = appOnly.images.app;
  return {
    table: partitionTable(),
    appDesc: desc(installed),
    bootHeader: appOnly.images.bootloader.slice(0, 16),
    installedAppMd5: md5Hex(appImage(installed)),
    targetAppMd5: md5Hex(image),
    targetAppHeader: image.slice(0, 16),
    build,
    tag: "v0.3.3",
    ...over,
  };
}

const offsets = (d: InstallDecision) => d.writes.map((w) => w.offset);
const FULL = [0, 0x8000, 0x20000];

describe("planFlash", () => {
  it("(a) an older compatible image of the same family -> app-update, one app write", () => {
    const d = planFlash(input());
    expect(d).toMatchObject({ mode: "app-update", allowed: true });
    expect(offsets(d)).toEqual([0x20000]);
    expect(d.acks).toEqual(["app-write-confirm"]);
    expect(d.appOnlyRefusal).toBeUndefined();
  });

  it("(b) the identical image -> app-reinstall, one app write", () => {
    const d = planFlash(input({ installedAppMd5: md5Hex(appOnly.images.app) }, "0.3.3"));
    expect(d).toMatchObject({ mode: "app-reinstall", allowed: true });
    expect(offsets(d)).toEqual([0x20000]);
  });

  it("(c) a newer installed image without a declared floor -> forced full update that says why the app-only path was refused", () => {
    const d = planFlash(input({}, "0.4.0"));
    expect(d).toMatchObject({ mode: "update-forced", allowed: true, appOnlyRefusal: { reason: "downgrade" } });
    expect(offsets(d)).toEqual(FULL);
    expect(d.acks).toContain("force-typed");
  });

  it("(d) a newer installed image whose release declares a floor -> app-downgrade, one app write", () => {
    const d = planFlash(input({ installedDowngradeFloor: "0.3.0" }, "0.4.0"));
    expect(d).toMatchObject({ mode: "app-downgrade", allowed: true });
    expect(offsets(d)).toEqual([0x20000]);
    expect(d.acks).toEqual(["app-write-confirm", "downgrade-confirm"]);
    expect(d.appOnlyRefusal).toBeUndefined();
  });

  it("(d') a floor above the target version does not allow the app-only downgrade", () => {
    const d = planFlash(input({ installedDowngradeFloor: "0.3.5" }, "0.4.0"));
    expect(d.mode).toBe("update-forced");
    expect(d.appOnlyRefusal?.reason).toBe("downgrade");
    expect(offsets(d)).toEqual(FULL);
  });

  it("(e) a compatible but not exact layout -> full update, with the layout as the reason", () => {
    const extra = entry("extra", 1, 6, 0x300000, 0x1000);
    const d = planFlash(input({ table: partitionTable({ extra: [extra] }) }));
    expect(d).toMatchObject({ mode: "update", allowed: true, appOnlyRefusal: { reason: "layout" } });
    expect(offsets(d)).toEqual(FULL);
  });

  it("(f) a blank board -> first-install", () => {
    const d = planFlash(input({ table: new Uint8Array(0xc00).fill(0xff), appDesc: new Uint8Array(256).fill(0xff), installedAppMd5: null }));
    expect(d).toMatchObject({ mode: "first-install", allowed: true });
    expect(offsets(d)).toEqual(FULL);
  });

  it("(g) a key that is not the one inspected is blocked with no fallback to a bigger write", () => {
    const d = planFlash(input({ baseline: { project: "multikey-fido", version: "0.3.2", flashSize: "16MB" } }));
    expect(d).toMatchObject({ mode: "blocked", allowed: false, reason: "different-key", writes: [] });
  });

  it("(h) the other MultiKeys family installed -> switch-image (full write, typed confirmation)", () => {
    const d = planFlash(input({ appDesc: desc("0.3.1", "multikey-openpgp") }));
    expect(d.mode).toBe("switch-image");
    expect(d.acks).toContain("switch-image-typed");
    expect(offsets(d)).toEqual(FULL);
  });

  it("(i) an app-* mode only ever writes the app image, clear of the bootloader, the table and every protected partition", () => {
    const protectedRanges = PARTITIONS.filter((p) => ["nvs", "phy_init", "part0"].includes(p.name));
    const cases: InstallDecision[] = [
      planFlash(input()),
      planFlash(input({ installedAppMd5: md5Hex(appOnly.images.app) }, "0.3.3")),
      planFlash(input({ installedDowngradeFloor: "0.3.0" }, "0.4.0")),
      planFlash(input({ installedAppMd5: "0".repeat(32) }, "0.3.3")),
    ];
    expect(cases.map((d) => d.mode)).toEqual(["app-update", "app-reinstall", "app-downgrade", "app-repair"]);
    for (const d of cases) {
      expect(d.writes).toHaveLength(1);
      const w = d.writes[0]!;
      expect(w.role).toBe("app");
      expect(w.offset).toBeGreaterThanOrEqual(0x20000);
      expect(protectedRanges.some((p) => w.offset < p.offset + p.size && w.offset + w.length > p.offset)).toBe(false);
    }
  });
});
