import { describe, expect, it } from "vitest";
import { buildsBySize } from "@/lib/firmware/catalog";
import { makeFirmware } from "../fixtures/firmware";

describe("buildsBySize", () => {
  it("lists the smallest flash first although manifests are sorted by build id (16, 4, 8), and leaves the input alone", async () => {
    const { builds } = await makeFirmware();
    expect(builds.map((b) => b.flash_size)).toEqual(["16MB", "4MB", "8MB"]);
    expect(buildsBySize(builds).map((b) => b.flash_size)).toEqual(["4MB", "8MB", "16MB"]);
    expect(builds.map((b) => b.flash_size)).toEqual(["16MB", "4MB", "8MB"]);
  });
});
