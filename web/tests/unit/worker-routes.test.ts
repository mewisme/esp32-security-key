import { describe, expect, it } from "vitest";
import { filterReleases, parseFirmwareRoute } from "../../worker/routes";

describe("parseFirmwareRoute", () => {
  it("allows the release assets", () => {
    expect(parseFirmwareRoute("/api/firmware/v0.2.0/firmware-manifest.json")).toEqual({ tag: "v0.2.0", asset: "firmware-manifest.json" });
    expect(parseFirmwareRoute("/api/firmware/v0.2.0/SHA256SUMS")).not.toBeNull();
    expect(parseFirmwareRoute("/api/firmware/v0.2.0/multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev.zip")).not.toBeNull();
    expect(parseFirmwareRoute("/api/firmware/v0.3.0-rc.1/multikey-firmware-v0.3.0-rc.1-esp32s3-n16r8-fido-dev.zip")).not.toBeNull();
  });

  it("rejects traversal, mismatched versions, injection and unknown assets", () => {
    for (const p of [
      "/api/firmware/v0.2.0/..%2Fetc",
      "/api/firmware/v0.2.0/../x",
      "/api/firmware/../v0.2.0/SHA256SUMS",
      "/api/firmware/v0.2.0/multikey-firmware-v0.3.0-esp32s3-n16r8-fido-dev.zip",
      "/api/firmware/v0.2.0/https:%2F%2Fevil.example%2Fx",
      "/api/firmware/v0.2.0/multikey-v0.2.0-windows-x86_64.zip",
      "/api/firmware/local/firmware-manifest.json",
      "/api/firmware/v0.2.0/firmware-manifest.json/extra",
      "/api/firmware/main/firmware-manifest.json",
    ]) {
      expect(parseFirmwareRoute(p), p).toBeNull();
    }
  });
});

describe("filterReleases", () => {
  it("drops drafts and releases without a firmware manifest", () => {
    const out = filterReleases([
      { tag_name: "v0.2.0", name: "MultiKeys v0.2.0", draft: false, prerelease: false, published_at: "2026-11-23T00:00:00Z", html_url: "u", assets: [{ name: "firmware-manifest.json" }] },
      { tag_name: "v0.3.0", draft: true, prerelease: false, assets: [{ name: "firmware-manifest.json" }] },
      { tag_name: "v0.1.0", draft: false, prerelease: false, assets: [{ name: "multikey-v0.1.0-windows-x86_64.zip" }] },
      { tag_name: "../x", draft: false, assets: [{ name: "firmware-manifest.json" }] },
    ]);
    expect(out).toEqual([{ tag: "v0.2.0", name: "MultiKeys v0.2.0", prerelease: false, published_at: "2026-11-23T00:00:00Z", html_url: "u" }]);
    expect(filterReleases({ message: "rate limited" })).toEqual([]);
  });
});
