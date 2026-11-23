import { describe, expect, it } from "vitest";
import { parseAppDescriptor } from "@/lib/flashing/app-descriptor";
import { appImage } from "../fixtures/firmware";

describe("parseAppDescriptor", () => {
  it("reads version and project", () => {
    expect(parseAppDescriptor(appImage("0.2.0").subarray(0, 256))).toEqual({
      version: "0.2.0",
      project_name: "multikey-fido",
      time: "12:00:00",
      date: "Nov 23 2026",
      idf_ver: "v5.5.6",
    });
  });

  it("returns null without the magic", () => {
    expect(parseAppDescriptor(new Uint8Array(256).fill(0xff))).toBeNull();
    expect(parseAppDescriptor(new Uint8Array(10))).toBeNull();
  });
});
