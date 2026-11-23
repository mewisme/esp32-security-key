import { describe, expect, it } from "vitest";
import { parsePending } from "@/lib/flashing/update-pending";

const base = { project: "multikey-fido", fromVersion: "0.3.1", toVersion: "0.3.3", tag: "v0.3.3", profileId: "esp32s3-16mb", appSha256: "ab".repeat(32), startedAt: "2026-11-24T00:00:00Z" };

describe("parsePending", () => {
  it("reads a version 2 record as written", () => {
    const v2 = { ...base, v: 2, imageFamily: "openpgp", chipMac: "80:b5:4e:c8:22:78" };
    expect(parsePending(v2)).toEqual(v2);
    expect(parsePending({ ...v2, chipMac: null })).toMatchObject({ v: 2, chipMac: null });
  });

  it("migrates a record without `v` to version 1 with no chip identity, which is never used for recovery", () => {
    expect(parsePending(base)).toEqual({ ...base, v: 1, imageFamily: null, chipMac: null });
  });

  it("rejects an incomplete or malformed record", () => {
    expect(parsePending(null)).toBeNull();
    expect(parsePending("x")).toBeNull();
    expect(parsePending({ ...base, appSha256: undefined })).toBeNull();
    expect(parsePending({ ...base, v: 2, chipMac: null })).toBeNull(); // no image family
    expect(parsePending({ ...base, v: 2, imageFamily: "pgp", chipMac: null })).toBeNull();
    expect(parsePending({ ...base, v: 3, imageFamily: "fido", chipMac: null })).toBeNull();
    expect(parsePending({ ...base, v: 2, imageFamily: "fido", chipMac: 5 })).toBeNull();
  });
});
