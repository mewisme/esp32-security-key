import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliFallback } from "@/lib/device/cli-fallback";
import { CONFIG_KEY, DEFAULT_CONFIG, loadConfig, parseConfig, saveConfig } from "@/lib/installer-config";

const json = (v: unknown) => JSON.stringify(v);

describe("parseConfig", () => {
  it("returns the default for nothing, bad JSON and non-objects", () => {
    for (const raw of [null, "", "{", "null", "7", "[]", '"x"']) expect(parseConfig(raw), String(raw)).toEqual(DEFAULT_CONFIG);
  });

  it("round-trips every name mode", () => {
    for (const name of [{ mode: "keep" }, { mode: "default" }, { mode: "custom", name: "Mew's Security Key" }] as const) {
      const c = { tag: "v0.2.0", image: "fido" as const, name };
      expect(parseConfig(json(c))).toEqual(c);
    }
  });

  it("round-trips the OpenPGP image", () => {
    const c = { tag: "v0.4.0", image: "openpgp" as const, name: { mode: "keep" as const } };
    expect(parseConfig(json(c))).toEqual(c);
  });

  it("defaults to the auto image, which follows the MultiKeys image on the board", () => {
    expect(DEFAULT_CONFIG.image).toBe("auto");
  });

  it("round-trips the auto image", () => {
    const c = { tag: "v0.4.0", image: "auto" as const, name: { mode: "keep" as const } };
    expect(parseConfig(json(c))).toEqual(c);
    expect(parseConfig(json({ tag: null, image: "auto", name: { mode: "keep" } }))).toEqual(DEFAULT_CONFIG);
  });

  it("accepts an unset release", () => {
    expect(parseConfig(json({ tag: null, image: "auto", name: { mode: "keep" } }))).toEqual(DEFAULT_CONFIG);
    expect(parseConfig(json({ image: "auto", name: { mode: "keep" } }))).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to the default for an unknown mode, image or tag type", () => {
    expect(parseConfig(json({ tag: null, image: "fido", name: { mode: "erase" } }))).toEqual(DEFAULT_CONFIG);
    expect(parseConfig(json({ tag: null, image: "piv", name: { mode: "keep" } }))).toEqual(DEFAULT_CONFIG);
    expect(parseConfig(json({ tag: 2, image: "fido", name: { mode: "keep" } }))).toEqual(DEFAULT_CONFIG);
    expect(parseConfig(json({ tag: null, image: "fido" }))).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to the default for a custom name the key would refuse", () => {
    for (const name of ["", "Mêw", "x".repeat(32), " Mew", undefined, 7]) {
      expect(parseConfig(json({ tag: "v0.2.0", image: "fido", name: { mode: "custom", name } })), String(name)).toEqual(DEFAULT_CONFIG);
    }
  });
});

describe("persistence", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("loads what was saved and survives a missing store", () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
    const c = { tag: "v0.2.0", image: "fido" as const, name: { mode: "custom" as const, name: "Mew" } };
    saveConfig(c);
    expect(sessionStorage.getItem(CONFIG_KEY)).toBe(json(c));
    expect(loadConfig()).toEqual(c);
    sessionStorage.setItem(CONFIG_KEY, "garbage");
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
});

describe("cliFallback", () => {
  it("shows the host-tool command for what was requested", () => {
    expect(cliFallback({ mode: "custom", name: "Mew's Security Key" })).toBe('multikey device rename "Mew\'s Security Key" --reenumerate');
    expect(cliFallback({ mode: "default" })).toBe("multikey device reset-name --reenumerate");
    expect(cliFallback({ mode: "keep" })).toBeNull();
  });

  it("escapes quotes and backslashes inside the name", () => {
    expect(cliFallback({ mode: "custom", name: 'a"b\\c' })).toBe('multikey device rename "a\\"b\\\\c" --reenumerate');
  });
});
