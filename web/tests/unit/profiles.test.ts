import { describe, expect, it } from "vitest";
import { selectProfile } from "@/lib/compatibility/profiles";
import type { ChipInfo } from "@/lib/flashing/driver";
import { makeFirmware, makeLegacyFirmware } from "../fixtures/firmware";

const N16R8_FEATURES = ["Wi-Fi", "BLE", "Embedded PSRAM 8MB (AP_3v3)"];
const chip = (over: Partial<ChipInfo> = {}): ChipInfo => ({
  chipName: "ESP32-S3",
  description: "ESP32-S3 (QFN56) (revision v0.2)",
  features: N16R8_FEATURES,
  mac: "80:b5:4e:c8:22:78",
  flashSize: "16MB",
  flashType: "quad",
  secureDownloadMode: false,
  ...over,
});

const { builds } = await makeFirmware();
const legacy = await makeLegacyFirmware();

const both = await makeFirmware({ images: ["fido", "openpgp"] });
function failure(c: ChipInfo, b = builds) {
  const r = selectProfile(c, b, "fido");
  if (r.ok) throw new Error("expected a failure");
  return r;
}

describe("selectProfile", () => {
  it("picks the 4 MB build for a 4 MB board and says it is only build-verified", () => {
    const r = selectProfile(chip({ flashSize: "4MB", features: ["Wi-Fi", "BLE"] }), builds, "fido");
    expect(r).toMatchObject({ ok: true, support: "build-verified", verifiedAs: null });
    if (r.ok) expect([r.build.profile_id, r.profile.id]).toEqual(["esp32s3-4mb", "esp32s3-4mb"]);
  });

  it("picks the 8 MB build for an 8 MB board", () => {
    const r = selectProfile(chip({ flashSize: "8MB", features: ["Wi-Fi", "BLE", "Embedded PSRAM 2MB (AP_3v3)"] }), builds, "fido");
    expect(r).toMatchObject({ ok: true, support: "build-verified" });
    if (r.ok) expect(r.build.profile_id).toBe("esp32s3-8mb");
  });

  it("recognises the tested N16R8 by its embedded 8 MB PSRAM", () => {
    const r = selectProfile(chip(), builds, "fido");
    expect(r).toMatchObject({ ok: true, support: "hardware-verified", verifiedAs: "ESP32-S3 N16R8" });
    if (r.ok) expect(r.build.profile_id).toBe("esp32s3-16mb");
  });

  it("treats other 16 MB boards as expected-compatible, not verified", () => {
    for (const features of [["Wi-Fi", "BLE"], ["Wi-Fi", "BLE", "Embedded PSRAM 2MB (AP_3v3)"], []]) {
      expect(selectProfile(chip({ features }), builds, "fido")).toMatchObject({ ok: true, support: "expected-compatible", verifiedAs: null });
    }
  });

  it("rejects a flash size no profile covers and lists the supported sizes", () => {
    const r = failure(chip({ flashSize: "2MB" }));
    expect(r.code).toBe("wrong-flash-size");
    expect(r.detail).toContain("flash is 2MB");
    expect(r.detail).toContain("4MB, 8MB, 16MB");
    expect(failure(chip({ flashSize: "32MB" })).code).toBe("wrong-flash-size");
  });

  it("rejects octal flash, even at a supported size", () => {
    expect(failure(chip({ flashType: "octal" })).code).toBe("unsupported-flash-mode");
    expect(failure(chip({ flashType: "octal", flashSize: "8MB" })).code).toBe("unsupported-flash-mode");
  });

  it("refuses to guess when the flash size is unknown", () => {
    expect(failure(chip({ flashSize: null })).code).toBe("unknown-flash-size");
  });

  it("accepts an undetermined flash type when the size is known", () => {
    expect(selectProfile(chip({ flashType: null }), builds, "fido").ok).toBe(true);
  });

  it("rejects another chip before looking at flash", () => {
    expect(failure(chip({ chipName: "ESP32-C3", flashSize: null, flashType: null })).code).toBe("unsupported-chip");
    expect(failure(chip({ chipName: "ESP32" })).code).toBe("unsupported-chip");
  });

  it("reports a release that has no build for the board's flash size", () => {
    const r = failure(chip({ flashSize: "8MB" }), legacy.builds);
    expect(r.code).toBe("profile-not-in-release");
  });

  it("serves a legacy (v0.2.0) release to its 16 MB boards as the 16 MB profile", () => {
    const r = selectProfile(chip(), legacy.builds, "fido");
    expect(r).toMatchObject({ ok: true, support: "build-verified" });
    if (r.ok) expect(r.build.legacy).toBe(true);
  });

  it("does not fall back to another image or another size", () => {
    expect(selectProfile(chip({ flashSize: "4MB" }), builds, "openpgp")).toMatchObject({ ok: false, code: "profile-not-in-release" });
  });

  it("picks the OpenPGP build, which is never hardware verified, even on the tested N16R8", () => {
    const r = selectProfile(chip(), both.builds, "openpgp");
    expect(r).toMatchObject({ ok: true, support: "build-verified", verifiedAs: null });
    if (r.ok) expect([r.build.image, r.build.profile_id]).toEqual(["openpgp", "esp32s3-16mb"]);
    expect(selectProfile(chip(), both.builds, "fido")).toMatchObject({ ok: true, support: "hardware-verified" });
  });
});
