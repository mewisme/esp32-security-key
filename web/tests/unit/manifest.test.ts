import { describe, expect, it } from "vitest";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { validateManifest } from "@/lib/firmware/manifest";
import { type FirmwareFixture, makeFirmware, makeLegacyFirmware, type RawBuild, type RawManifest } from "../fixtures/firmware";

async function rejects(mutate: (m: RawManifest, b: RawBuild) => void, tag = "v0.2.0", make: () => Promise<FirmwareFixture> = makeFirmware) {
  const { manifest } = await make();
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

const legacy = (mutate: (m: RawManifest, b: RawBuild) => void) => rejects(mutate, "v0.2.0", makeLegacyFirmware);

describe("validateManifest (schema 2)", () => {
  it("accepts a release with every hardware profile", async () => {
    const { manifest } = await makeFirmware();
    const m = validateManifest(manifest, "v0.2.0", false);
    expect(m.builds.map((b) => b.profile_id).sort()).toEqual(["esp32s3-16mb", "esp32s3-4mb", "esp32s3-8mb"]);
    expect(m.builds.every((b) => !b.legacy)).toBe(true);
    expect(m.builds[0]!.entry).toEqual(manifest.builds[0]);
  });

  it.each(["esp32s3-4mb", "esp32s3-8mb", "esp32s3-16mb"])("accepts a release with only %s", async (profile) => {
    const { manifest } = await makeFirmware({ profiles: [profile] });
    expect(validateManifest(manifest, "v0.2.0", false).builds.map((b) => b.profile_id)).toEqual([profile]);
  });

  it("accepts update.app_only true and an absent field, and rejects a non-boolean", async () => {
    const { manifest } = await makeFirmware({ appOnly: true });
    expect(validateManifest(manifest, "v0.2.0", false).builds.every((b) => b.update.app_only === true)).toBe(true);
    const plain = await makeFirmware();
    expect(validateManifest(plain.manifest, "v0.2.0", false).builds[0]!.update.app_only).toBeUndefined();
    expect(await rejects((_m, b) => Object.assign(b.update, { app_only: "yes" }))).toMatch(/app_only is not a boolean/);
  });

  it("rejects a profile id that is not in the policy", async () => {
    expect(await rejects((_m, b) => (b.profile_id = "esp32s3-2mb"))).toMatch(/profile_id/);
  });

  it("rejects a flash_size that differs from the profile", async () => {
    expect(await rejects((_m, b) => (b.flash_size = "4MB"))).toMatch(/flash_size is 4MB, profile esp32s3-16mb needs 16MB/);
  });

  it("rejects flash mode, frequency, interface and PSRAM that differ from the profile", async () => {
    expect(await rejects((_m, b) => (b.flash_mode = "qio"))).toMatch(/flash_mode/);
    expect(await rejects((_m, b) => (b.flash_freq = "40m"))).toMatch(/flash_freq/);
    expect(await rejects((_m, b) => Object.assign(b, { flash_interface: "octal" }))).toMatch(/flash_interface/);
    expect(await rejects((_m, b) => (b.psram_required = true))).toMatch(/psram_required/);
  });

  it("rejects an asset name for another profile", async () => {
    expect(await rejects((_m, b) => (b.package.name = "multikey-firmware-v0.2.0-esp32s3-4mb-fido-dev.zip"))).toMatch(/not allowed/);
  });

  it("rejects the legacy n16r8 asset name on a schema-2 build", async () => {
    expect(await rejects((_m, b) => (b.package.name = "multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev.zip"))).toMatch(/not allowed/);
  });

  it("rejects a verification level outside the two literals", async () => {
    expect(await rejects((_m, b) => Object.assign(b, { verification: "certified" }))).toMatch(/verification/);
  });

  it("rejects a USB product name the key would refuse", async () => {
    expect(await rejects((_m, b) => (b.usb.product_name = "Mêw"))).toMatch(/product_name/);
    expect(await rejects((_m, b) => (b.usb.product_name = " Mew"))).toMatch(/product_name/);
    expect(await rejects((_m, b) => Object.assign(b.usb, { custom_name: "yes" }))).toMatch(/custom_name/);
  });

  it("rejects two builds of one image for one profile", async () => {
    expect(
      await rejects((m, b) => m.builds.push({ ...structuredClone(b), id: "another-id" })),
    ).toMatch(/duplicate builds for one image and hardware profile/);
  });

  it("rejects duplicate build ids", async () => {
    expect(await rejects((m, b) => m.builds.push(structuredClone(b)))).toMatch(/duplicate build ids/);
  });

  it("rejects an extra image over the credential partition", async () => {
    expect(
      await rejects((_m, b) => b.images.push({ role: "app", file: "x.bin", offset: 0x200000, size: 16, sha256: "0".repeat(64) })),
    ).toMatch(/images must be exactly/);
  });

  it("rejects an image that overlaps a protected partition", async () => {
    expect(await rejects((_m, b) => (b.images[1]!.size = 0x10000))).toMatch(/larger than|overlaps/);
    expect(await rejects((_m, b) => (b.images[2]!.size = 0x1f0000))).toMatch(/larger than 1966080 bytes/);
  });

  it("rejects a missing app", async () => {
    expect(await rejects((_m, b) => b.images.pop())).toMatch(/images must be exactly/);
  });

  it("rejects a bad sha256", async () => {
    expect(await rejects((_m, b) => (b.images[0]!.sha256 = "ABC"))).toMatch(/sha256/);
  });

  it("rejects a wrong tag", async () => {
    expect(await rejects(() => {}, "v0.3.0")).toMatch(/differs from release/);
  });

  it("rejects an unknown schema_version", async () => {
    expect(await rejects((m) => Object.assign(m, { schema_version: 3 }))).toMatch(/unsupported schema_version 3/);
    expect(await rejects((m) => Object.assign(m, { schema_version: 0 }))).toMatch(/schema_version/);
  });

  it("rejects a package name for another version", async () => {
    expect(await rejects((_m, b) => (b.package.name = "multikey-firmware-v0.3.0-esp32s3-16mb-fido-dev.zip"))).toMatch(/not allowed/);
  });

  it("rejects a non-development profile and a repurpose fill outside the protected set", async () => {
    expect(await rejects((_m, b) => Object.assign(b, { security_profile: "production" }))).toMatch(/security_profile/);
    expect(await rejects((_m, b) => b.repurpose_fill.push("factory"))).toMatch(/repurpose_fill/);
  });

  it("rejects a USB vid/pid that is not the policy's application identity", async () => {
    expect(await rejects((_m, b) => (b.usb.vid = 0x1234))).toMatch(/usb is 1234:/);
    expect(await rejects((_m, b) => (b.usb.pid = 0x1))).toMatch(/policy requires/);
  });

  it("accepts tag local only on the dev server", async () => {
    const { manifest } = await makeFirmware({ version: "0.2.0-dev", tag: "local" });
    expect(() => validateManifest(manifest, "local", false)).toThrow(FirmwareError);
    expect(validateManifest(manifest, "local", true).tag).toBe("local");
  });
});

describe("validateManifest (schema 1, the published v0.2.0 shape)", () => {
  it("is normalised to the 16 MB profile and flagged legacy", async () => {
    const { manifest } = await makeLegacyFirmware();
    const m = validateManifest(manifest, "v0.2.0", false);
    expect(m.schema_version).toBe(1);
    const b = m.builds[0]!;
    expect(b).toMatchObject({
      id: "esp32s3-n16r8-fido-dev",
      profile_id: "esp32s3-16mb",
      flash_interface: "quad",
      psram_required: false,
      partition_schema: b.layout_id,
      verified_hardware: [],
      verification: "build-verified",
      legacy: true,
    });
    expect(b.usb).toMatchObject({ product_name: "MultiKeys Security Key", custom_name: true });
    expect(b.entry).toEqual(manifest.builds[0]); // firmware.json inside the zip is checked against the entry as published
    expect(b.entry).not.toHaveProperty("profile_id");
  });

  it("keeps a hardware-verified claim and maps anything else to build-verified", async () => {
    const { manifest } = await makeLegacyFirmware();
    const claim = (v: string) => {
      const m = structuredClone(manifest);
      Object.assign(m.builds[0]!, { verification: v });
      return validateManifest(m, "v0.2.0", false).builds[0]!.verification;
    };
    expect(claim("hardware-verified")).toBe("hardware-verified");
    expect(claim("build-verified")).toBe("build-verified");
    expect(claim("something-else")).toBe("build-verified");
  });

  it("rejects a board other than the one v0.2.0 was built for", async () => {
    expect(await legacy((_m, b) => (b.board = "esp32s3-boot-button"))).toMatch(/board/);
  });

  it("rejects a flash size other than 16MB", async () => {
    expect(await legacy((_m, b) => (b.flash_size = "8MB"))).toMatch(/flash_size/);
  });

  it("rejects build ids that are not in legacy_builds, including inherited object keys", async () => {
    expect(await legacy((_m, b) => (b.id = "esp32s3-n4-fido-dev"))).toMatch(/not a known schema-1 build/);
    expect(await legacy((_m, b) => (b.id = "constructor"))).toMatch(/not a known schema-1 build/);
    expect(await legacy((_m, b) => (b.id = "__proto__"))).toMatch(/not a known schema-1 build/);
  });

  it("only accepts the n16r8 asset name", async () => {
    expect(await legacy((_m, b) => (b.package.name = "multikey-firmware-v0.2.0-esp32s3-16mb-fido-dev.zip"))).toMatch(/not allowed/);
  });
});

describe("protected partition ranges in the policy", () => {
  it("rejects a build whose protected partition is not where the policy says", async () => {
    const { policy } = await import("@/lib/firmware/policy");
    const strict = { ...policy, protected_partitions: [{ name: "nvs", offset: 0x11000, size: 0x6000 }, "phy_init", { name: "part0", offset: 0x200000, size: 0x100000 }] };
    const { manifest } = await makeFirmware();
    expect(validateManifest(manifest, "v0.2.0", false, strict).builds.length).toBeGreaterThan(0);
    const moved = structuredClone(manifest);
    moved.builds[0]!.partitions.find((q) => q.name === "part0")!.offset = 0x300000;
    expect(() => validateManifest(moved, "v0.2.0", false, strict)).toThrow(/policy requires/);
  });
});
