import { describe, expect, it } from "vitest";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { unzipSync, zipSync } from "fflate";
import { downloadBuild, MAX_MEMBER_BYTES, sha256Hex, verifyPackage } from "@/lib/firmware/download";
import { makeFirmware, makeLegacyFirmware } from "../fixtures/firmware";

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(FirmwareError);
    return (e as FirmwareError).code;
  }
  return "no error";
}

describe("download + integrity", () => {
  it("verifies a good package and returns the three images in offset order", async () => {
    const f = await makeFirmware();
    const imgs = await verifyPackage(f.zip, f.build);
    expect(imgs.map((i) => [i.role, i.offset, i.data.length])).toEqual([
      ["bootloader", 0, f.images.bootloader.length],
      ["partition-table", 0x8000, f.images.table.length],
      ["app", 0x20000, f.images.app.length],
    ]);
  });

  it("verifies every profile's package against its own entry", async () => {
    const f = await makeFirmware();
    expect(f.builds).toHaveLength(3);
    for (const b of f.builds) {
      const imgs = await verifyPackage(f.zips.get(b.package.name)!, b);
      expect(imgs).toHaveLength(3);
    }
  });

  it("verifies a legacy (schema 1) package: firmware.json is compared with the published entry, not the normalised build", async () => {
    const f = await makeLegacyFirmware();
    expect(f.build.legacy).toBe(true);
    expect(f.build.entry).not.toHaveProperty("profile_id");
    expect(await verifyPackage(f.zip, f.build)).toHaveLength(3);
  });

  it("a firmware.json that differs from the published entry -> manifest-invalid", async () => {
    const f = await makeFirmware();
    const build = structuredClone(f.build);
    build.entry.title = "Something else";
    expect(await code(verifyPackage(f.zip, build))).toBe("manifest-invalid");
  });

  it("one flipped byte -> checksum-mismatch", async () => {
    const f = await makeFirmware();
    const bad = f.zip.slice();
    bad[100] = bad[100]! ^ 1;
    expect(await code(verifyPackage(bad, f.build))).toBe("checksum-mismatch");
  });

  it("an extra member -> manifest-invalid", async () => {
    const f = await makeFirmware({ extraMember: true });
    expect(await code(verifyPackage(f.zip, f.build))).toBe("manifest-invalid");
  });

  it("an image whose hash differs from the manifest -> checksum-mismatch", async () => {
    const f = await makeFirmware();
    const build = structuredClone(f.build);
    build.images[2]!.sha256 = "0".repeat(64);
    expect(await code(verifyPackage(f.zip, build))).toBe("checksum-mismatch");
  });

  it("a partition table that moves part0 -> manifest-invalid", async () => {
    const f = await makeFirmware({ tableOpts: { part0Offset: 0x300000 } });
    expect(await code(verifyPackage(f.zip, f.build))).toBe("manifest-invalid");
  });

  it("a partition table that differs from the manifest layout -> manifest-invalid", async () => {
    const f = await makeFirmware({ tableOpts: { factorySize: 0x100000 } });
    expect(await code(verifyPackage(f.zip, f.build))).toBe("manifest-invalid");
  });

  it("a bootloader or app image with a bad header (magic, chip id, flash size) -> manifest-invalid", async () => {
    for (const [at, value] of [[0, 0x00], [12, 5], [3, 0x2f]] as const) {
      const f = await makeFirmware();
      const files = unzipSync(f.zip);
      const name = Object.keys(files).find((n) => n.endsWith("bootloader.bin"))!;
      const bad = files[name]!.slice();
      bad[at] = value;
      files[name] = bad;
      const zip = zipSync(files, { mtime: new Date("1980-01-01T00:00:00Z") });
      const build = structuredClone(f.build);
      build.images[0]!.sha256 = await sha256Hex(bad);
      build.package = { ...build.package, size: zip.length, sha256: await sha256Hex(zip) };
      expect(await code(verifyPackage(zip, build))).toBe("manifest-invalid");
    }
  });

  it("a zip member larger than 4 MiB is refused", async () => {
    const f = await makeFirmware({ licenseBytes: MAX_MEMBER_BYTES + 1 });
    expect(await code(verifyPackage(f.zip, f.build))).toBe("manifest-invalid");
    const ok = await makeFirmware({ licenseBytes: MAX_MEMBER_BYTES });
    expect(await verifyPackage(ok.zip, ok.build)).toHaveLength(3);
  });

  it("streams through fetch with progress", async () => {
    const f = await makeFirmware();
    const seen: number[] = [];
    const fake = (async (url: string) => {
      expect(url).toBe(`/api/firmware/v0.2.0/${f.build.package.name}`);
      return new Response(f.zip as Uint8Array<ArrayBuffer>);
    }) as unknown as typeof fetch;
    const imgs = await downloadBuild("v0.2.0", f.build, (r) => seen.push(r), fake);
    expect(imgs).toHaveLength(3);
    expect(seen.at(-1)).toBe(f.zip.length);
  });

  it("HTTP 404 -> firmware-unavailable", async () => {
    const f = await makeFirmware();
    const fake = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect(await code(downloadBuild("v0.2.0", f.build, () => {}, fake))).toBe("firmware-unavailable");
  });
});
