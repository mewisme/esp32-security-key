import { describe, expect, it } from "vitest";
import { cacheKeyUrl, contentTypeFor, parseFirmwareRoute, parseReleasesAtom } from "../../worker/routes";

describe("parseFirmwareRoute", () => {
  it("allows the release assets", () => {
    expect(parseFirmwareRoute("/api/firmware/v0.2.0/firmware-manifest.json")).toEqual({ tag: "v0.2.0", asset: "firmware-manifest.json" });
    expect(parseFirmwareRoute("/api/firmware/v0.2.0/SHA256SUMS")).not.toBeNull();
    expect(parseFirmwareRoute("/api/firmware/v0.2.0/multikey-firmware-v0.2.0-esp32s3-16mb-fido-dev.zip")).not.toBeNull();
    expect(parseFirmwareRoute("/api/firmware/v0.2.0/multikey-firmware-v0.2.0-esp32s3-8mb-fido-dev.zip")).not.toBeNull();
    expect(parseFirmwareRoute("/api/firmware/v0.2.0/multikey-firmware-v0.2.0-esp32s3-4mb-fido-dev.zip")).not.toBeNull();
    expect(parseFirmwareRoute("/api/firmware/v0.3.0-rc.1/multikey-firmware-v0.3.0-rc.1-esp32s3-4mb-fido-dev.zip")).not.toBeNull();
    for (const hw of ["4mb", "8mb", "16mb"]) {
      expect(parseFirmwareRoute(`/api/firmware/v0.4.0/multikey-firmware-v0.4.0-esp32s3-${hw}-openpgp-dev.zip`)).not.toBeNull();
    }
  });

  it("serves the detached manifest signature, as JSON, and nothing that merely ends in .sig", () => {
    expect(parseFirmwareRoute("/api/firmware/v0.3.3/firmware-manifest.json.sig")).toEqual({ tag: "v0.3.3", asset: "firmware-manifest.json.sig" });
    expect(contentTypeFor("firmware-manifest.json.sig")).toBe("application/json");
    for (const p of ["/api/firmware/v0.3.3/other.sig", "/api/firmware/v0.3.3/firmware-manifest.json.sig.sig", "/api/firmware/v0.3.3/firmware-manifest.sig"]) {
      expect(parseFirmwareRoute(p), p).toBeNull();
    }
  });

  it("keeps the published n16r8 asset names of v0.2.0 downloadable", () => {
    expect(parseFirmwareRoute("/api/firmware/v0.2.0/multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev.zip")).not.toBeNull();
    expect(parseFirmwareRoute("/api/firmware/v0.3.0-rc.1/multikey-firmware-v0.3.0-rc.1-esp32s3-n16r8-fido-dev.zip")).not.toBeNull();
  });

  it("rejects traversal, mismatched versions, injection and unknown assets", () => {
    for (const p of [
      "/api/firmware/v0.2.0/..%2Fetc",
      "/api/firmware/v0.2.0/../x",
      "/api/firmware/../v0.2.0/SHA256SUMS",
      "/api/firmware/v0.2.0/multikey-firmware-v0.3.0-esp32s3-16mb-fido-dev.zip",
      "/api/firmware/v0.2.0/multikey-firmware-v0.3.0-esp32s3-n16r8-fido-dev.zip",
      "/api/firmware/v0.2.0/multikey-firmware-v0.2.0-esp32s3-2mb-fido-dev.zip",
      "/api/firmware/v0.2.0/multikey-firmware-v0.2.0-esp32s3-32mb-fido-dev.zip",
      "/api/firmware/v0.2.0/multikey-firmware-v0.2.0-esp32s3-16MB-fido-dev.zip",
      "/api/firmware/v0.2.0/multikey-firmware-v0.2.0-esp32s3-16mb-fido-prod.zip",
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

const entry = (tag: string, title: string, updated = "2026-11-23T05:10:23Z") => `
  <entry>
    <id>tag:github.com,2008:Repository/1/${tag}</id>
    <updated>${updated}</updated>
    <link rel="alternate" type="text/html" href="https://github.com/mewisme/esp32-security-key/releases/tag/${tag}"/>
    <title>${title}</title>
    <content type="html">&lt;h1&gt;notes&lt;/h1&gt;</content>
  </entry>`;

describe("parseReleasesAtom", () => {
  it("extracts tag, title, date and pre-release from the feed", () => {
    const xml = `<?xml version="1.0"?><feed><title>Release notes</title>${entry("v0.3.0-rc.1", "MultiKeys &amp; friends v0.3.0-rc.1")}${entry("v0.2.0", "MultiKeys v0.2.0")}</feed>`;
    expect(parseReleasesAtom(xml)).toEqual([
      {
        tag: "v0.3.0-rc.1",
        name: "MultiKeys & friends v0.3.0-rc.1",
        prerelease: true,
        published_at: "2026-11-23T05:10:23Z",
        html_url: "https://github.com/mewisme/esp32-security-key/releases/tag/v0.3.0-rc.1",
      },
      {
        tag: "v0.2.0",
        name: "MultiKeys v0.2.0",
        prerelease: false,
        published_at: "2026-11-23T05:10:23Z",
        html_url: "https://github.com/mewisme/esp32-security-key/releases/tag/v0.2.0",
      },
    ]);
  });

  it("drops entries whose tag is not a release version", () => {
    const xml = `<feed>${entry("nightly", "x")}${entry("..%2Fx", "y")}${entry("%E0%A4%A", "z")}</feed>`;
    expect(parseReleasesAtom(xml)).toEqual([]);
    expect(parseReleasesAtom("rate limited")).toEqual([]);
  });
});

describe("cacheKeyUrl", () => {
  it("is the origin plus the validated path: a query string or fragment never makes another entry", () => {
    const route = parseFirmwareRoute("/api/firmware/v0.3.3/SHA256SUMS");
    const plain = cacheKeyUrl("https://multikeys.example/api/firmware/v0.3.3/SHA256SUMS", route);
    expect(plain).toBe("https://multikeys.example/api/firmware/v0.3.3/SHA256SUMS");
    expect(cacheKeyUrl("https://multikeys.example/api/firmware/v0.3.3/SHA256SUMS?a=1&b=2", route)).toBe(plain);
    expect(cacheKeyUrl("https://multikeys.example/api/firmware/v0.3.3/SHA256SUMS?cache=bust#x", route)).toBe(plain);
    expect(cacheKeyUrl("https://multikeys.example/api/releases?x=1", null)).toBe("https://multikeys.example/api/releases");
  });

  it("keeps different origins and different assets apart", () => {
    const a = parseFirmwareRoute("/api/firmware/v0.3.3/SHA256SUMS");
    const b = parseFirmwareRoute("/api/firmware/v0.3.3/firmware-manifest.json");
    expect(cacheKeyUrl("https://one.example/api/firmware/v0.3.3/SHA256SUMS", a)).not.toBe(cacheKeyUrl("https://two.example/api/firmware/v0.3.3/SHA256SUMS", a));
    expect(cacheKeyUrl("https://one.example/api/firmware/v0.3.3/SHA256SUMS", a)).not.toBe(cacheKeyUrl("https://one.example/api/firmware/v0.3.3/firmware-manifest.json", b));
  });
});
