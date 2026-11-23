import { describe, expect, it } from "vitest";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { validateManifest } from "@/lib/firmware/manifest";
import type { Build, Manifest } from "@/lib/firmware/types";
import { makeFirmware } from "../fixtures/firmware";

async function rejects(mutate: (m: Manifest, b: Build) => void, tag = "v0.2.0") {
  const { manifest } = await makeFirmware();
  const m = structuredClone(manifest);
  mutate(m, m.builds[0]!);
  try {
    validateManifest(m, tag, false);
  } catch (e) {
    expect(e).toBeInstanceOf(FirmwareError);
    expect((e as FirmwareError).code).toBe("manifest-invalid");
    return (e as FirmwareError).detail;
  }
  throw new Error("expected manifest-invalid");
}

describe("validateManifest", () => {
  it("accepts a valid manifest", async () => {
    const { manifest } = await makeFirmware();
    expect(validateManifest(manifest, "v0.2.0", false).builds).toHaveLength(1);
  });

  it("rejects an extra image over the credential partition", async () => {
    expect(
      await rejects((_m, b) => b.images.push({ role: "app", file: "x.bin", offset: 0x200000, size: 16, sha256: "0".repeat(64) })),
    ).toMatch(/images must be exactly/);
  });

  it("rejects an image that overlaps a protected partition", async () => {
    expect(await rejects((_m, b) => (b.images[1]!.size = 0x10000))).toMatch(/larger than|overlaps/);
    expect(await rejects((_m, b) => (b.images[2]!.size = 0x1f0000))).toMatch(/factory|overlaps/);
  });

  it("rejects a missing app", async () => {
    expect(await rejects((_m, b) => b.images.pop())).toMatch(/images must be exactly/);
  });

  it("rejects a 4MB flash build", async () => {
    expect(await rejects((_m, b) => (b.flash_size = "4MB"))).toMatch(/flash_size/);
  });

  it("rejects a bad sha256", async () => {
    expect(await rejects((_m, b) => (b.images[0]!.sha256 = "ABC"))).toMatch(/sha256/);
  });

  it("rejects a wrong tag", async () => {
    expect(await rejects(() => {}, "v0.3.0")).toMatch(/differs from release/);
  });

  it("rejects schema_version 2", async () => {
    expect(await rejects((m) => Object.assign(m, { schema_version: 2 }))).toMatch(/schema_version/);
  });

  it("rejects a package name for another version", async () => {
    expect(await rejects((_m, b) => (b.package.name = "multikey-firmware-v0.3.0-esp32s3-n16r8-fido-dev.zip"))).toMatch(/not allowed/);
  });

  it("rejects a non-development profile and a repurpose fill outside the protected set", async () => {
    expect(await rejects((_m, b) => Object.assign(b, { security_profile: "production" }))).toMatch(/security_profile/);
    expect(await rejects((_m, b) => b.repurpose_fill.push("factory"))).toMatch(/repurpose_fill/);
  });

  it("accepts tag local only on the dev server", async () => {
    const { manifest } = await makeFirmware({ version: "0.2.0-dev", tag: "local" });
    expect(() => validateManifest(manifest, "local", false)).toThrow(FirmwareError);
    expect(validateManifest(manifest, "local", true).tag).toBe("local");
  });
});
