import { describe, expect, it } from "vitest";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { downloadBuild, verifyPackage } from "@/lib/firmware/download";
import { makeFirmware } from "../fixtures/firmware";

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
