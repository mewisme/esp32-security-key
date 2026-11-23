import { describe, expect, it } from "vitest";
import type { Catalog, CatalogRelease } from "../../src/lib/firmware/catalog";
import { downloadUrl, findBuild, imagesIn, initialChoice, releaseWith, sizesIn } from "../../src/lib/firmware/release-select";
import type { Build } from "../../src/lib/firmware/types";

function build(image: "fido" | "openpgp", flash_size: string, tag: string): Build {
  return {
    id: `${image}-${flash_size}`,
    image,
    flash_size,
    title: `${image} ${flash_size}`,
    package: { name: `multikey-firmware-${tag}-${flash_size.toLowerCase()}-${image}.zip`, size: 1, sha256: "a".repeat(64) },
  } as unknown as Build;
}

function release(tag: string, builds: [("fido" | "openpgp"), string][], prerelease = false): CatalogRelease {
  return {
    tag,
    name: `MultiKeys ${tag}`,
    prerelease,
    publishedAt: null,
    notesUrl: null,
    manifest: { version: tag.slice(1), builds: builds.map(([i, s]) => build(i, s, tag)) },
  } as unknown as CatalogRelease;
}

const all: [("fido" | "openpgp"), string][] = [
  ["openpgp", "16MB"],
  ["fido", "16MB"],
  ["fido", "4MB"],
  ["fido", "8MB"],
];
const catalog = (releases: CatalogRelease[]): Catalog => ({ releases, rejected: [] });

describe("initialChoice", () => {
  it("picks the newest stable release even when a newer pre-release exists", () => {
    const c = catalog([release("v0.4.0-rc1", all, true), release("v0.3.3", all), release("v0.3.2", all)]);
    expect(initialChoice(c)).toEqual({ tag: "v0.3.3", image: "fido", flashSize: "16MB" });
  });
  it("falls back to the newest pre-release when there is no stable one", () => {
    const c = catalog([release("v0.4.0-rc1", all, true)]);
    expect(initialChoice(c)?.tag).toBe("v0.4.0-rc1");
  });
  it("takes the largest size when 16 MB is not built", () => {
    const c = catalog([release("v0.3.3", [["fido", "4MB"], ["fido", "8MB"]])]);
    expect(initialChoice(c)).toEqual({ tag: "v0.3.3", image: "fido", flashSize: "8MB" });
  });
  it("is null for an empty catalog", () => {
    expect(initialChoice(catalog([]))).toBeNull();
  });
});

describe("builds of a release", () => {
  it("lists images fido first and sizes ascending", () => {
    const r = release("v0.3.3", all);
    expect(imagesIn(r)).toEqual(["fido", "openpgp"]);
    expect(sizesIn(r, "fido")).toEqual(["4MB", "8MB", "16MB"]);
    expect(sizesIn(r, "openpgp")).toEqual(["16MB"]);
  });
  it("finds nothing for a combination the release does not carry", () => {
    const r = release("v0.2.0", [["fido", "16MB"]]);
    expect(findBuild(r, "openpgp", "16MB")).toBeNull();
    expect(findBuild(r, "fido", "4MB")).toBeNull();
    expect(findBuild(r, "fido", "16MB")?.id).toBe("fido-16MB");
  });
});

describe("releaseWith", () => {
  const c = catalog([release("v0.4.0-rc1", all, true), release("v0.3.3", [["fido", "16MB"]]), release("v0.3.2", all)]);
  it("offers the newest other release that has the combination, stable before pre-release", () => {
    expect(releaseWith(c, "openpgp", "16MB", "v0.3.3")?.tag).toBe("v0.3.2");
  });
  it("is null when no release has it", () => {
    expect(releaseWith(c, "openpgp", "4MB")).toBeNull();
  });
});

describe("downloadUrl", () => {
  it("encodes the tag and keeps the exact asset name", () => {
    const b = build("fido", "16MB", "v0.3.3");
    expect(downloadUrl("v0.3.3", b)).toBe("/api/firmware/v0.3.3/multikey-firmware-v0.3.3-16mb-fido.zip");
    expect(downloadUrl("v1 +x", b)).toContain("/api/firmware/v1%20%2Bx/");
  });
});
