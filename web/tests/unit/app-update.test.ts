import { beforeAll, describe, expect, it } from "vitest";
import { type AppUpdateInput, decideAppUpdate, type PendingUpdate } from "@/lib/flashing/app-update";
import { md5Hex } from "@/lib/flashing/md5";
import { appImage, entry, type FirmwareFixture, makeFirmware, partitionTable } from "../fixtures/firmware";

let fx: FirmwareFixture;
let appOnly: FirmwareFixture;

beforeAll(async () => {
  appOnly = await makeFirmware({ appOnly: true, version: "0.3.3", tag: "v0.3.3", images: ["fido", "openpgp"] });
  fx = await makeFirmware({ version: "0.3.3", tag: "v0.3.3" });
});

const desc = (version: string, project = "multikey-fido") => appImage(version, project).subarray(0, 256);

function input(over: Partial<AppUpdateInput> = {}, installed = "0.3.1"): AppUpdateInput {
  const build = appOnly.builds.find((b) => b.image === "fido" && b.profile_id === "esp32s3-16mb")!;
  const image = appOnly.images.app;
  return {
    table: partitionTable(),
    appDesc: desc(installed),
    bootHeader: appOnly.images.bootloader.slice(0, 16),
    installedAppMd5: md5Hex(appImage(installed)),
    targetAppMd5: md5Hex(image),
    targetAppHeader: image.slice(0, 16),
    build,
    tag: "v0.3.3",
    ...over,
  };
}

/** The table with the `factory` entry's size replaced. */
function withFactorySize(size: number): Uint8Array {
  return partitionTable({ factorySize: size });
}

const summary = (d: ReturnType<typeof decideAppUpdate>) => ({ outcome: d.outcome, reason: d.reason, allowed: d.allowed, writes: d.writes.map((w) => w.offset) });

describe("decideAppUpdate", () => {
  it("updates a compatible older image with exactly one write of the app region", () => {
    const d = decideAppUpdate(input());
    expect(summary(d)).toEqual({ outcome: "safe-update", reason: "ok", allowed: true, writes: [0x20000] });
    expect(d.writes).toEqual([{ offset: 0x20000, length: appOnly.images.app.length, kind: "image", role: "app" }]);
    expect(d.acks).toEqual(["update-confirm"]);
    expect(d.installed).toEqual({ project: "multikey-fido", version: "0.3.1" });
    expect(d.target).toEqual({ project: "multikey-fido", version: "0.3.3", tag: "v0.3.3" });
  });

  it("does nothing when the flash already holds this image", () => {
    const d = decideAppUpdate(input({ installedAppMd5: md5Hex(appOnly.images.app) }, "0.3.3"));
    expect(summary(d)).toEqual({ outcome: "already-current", reason: "current", allowed: false, writes: [] });
  });

  it("blocks a downgrade", () => {
    expect(summary(decideAppUpdate(input({}, "0.4.0")))).toEqual({ outcome: "downgrade", reason: "downgrade", allowed: false, writes: [] });
  });

  it("blocks an image older than data_preserving_from", () => {
    expect(summary(decideAppUpdate(input({}, "0.1.0")))).toEqual({ outcome: "incompatible", reason: "storage", allowed: false, writes: [] });
  });

  it("blocks the other MultiKeys image family", () => {
    const d = decideAppUpdate(input({ appDesc: desc("0.3.1", "multikey-openpgp") }));
    expect(summary(d)).toEqual({ outcome: "different-family", reason: "different-family", allowed: false, writes: [] });
  });

  it("blocks an application that is not MultiKeys", () => {
    const d = decideAppUpdate(input({ appDesc: desc("1.0.0", "someone-elses-app") }));
    expect(d.outcome).toBe("not-multikeys");
    expect(d.writes).toEqual([]);
  });

  it("blocks a device whose layout differs from the release", () => {
    expect(summary(decideAppUpdate(input({ table: partitionTable({ part0Offset: 0x300000 }) })))).toEqual({
      outcome: "incompatible", reason: "layout", allowed: false, writes: [],
    });
  });

  it("treats a blank or unreadable table as not MultiKeys", () => {
    expect(decideAppUpdate(input({ table: new Uint8Array(3072).fill(0xff) })).outcome).toBe("not-multikeys");
    expect(decideAppUpdate(input({ table: partitionTable({ terminated: false }) })).outcome).toBe("not-multikeys");
  });

  it("blocks when the bootloader flash size differs from the build", () => {
    const boot = appOnly.images.bootloader.slice(0, 16);
    boot[3] = (2 << 4) | 0xf;
    expect(summary(decideAppUpdate(input({ bootHeader: boot })))).toEqual({ outcome: "incompatible", reason: "flash-profile", allowed: false, writes: [] });
  });

  it("does not guess when the bootloader header is missing", () => {
    expect(decideAppUpdate(input({ bootHeader: new Uint8Array(16).fill(0xff) })).reason).toBe("unreadable-bootloader");
  });

  it("refuses an unreadable descriptor when no interrupted write is on record", () => {
    expect(summary(decideAppUpdate(input({ appDesc: new Uint8Array(256), installedAppMd5: null })))).toEqual({
      outcome: "unknown", reason: "unreadable-descriptor", allowed: false, writes: [],
    });
  });

  describe("recovery of an interrupted write", () => {
    const MAC = "80:b5:4e:c8:22:78";
    const NOW = Date.parse("2026-11-24T12:00:00Z");
    const unreadable = (pending: PendingUpdate | null, over: Partial<AppUpdateInput> = {}) => {
      const i = input({ appDesc: new Uint8Array(256), installedAppMd5: null });
      return decideAppUpdate({ ...i, pending, chipMac: MAC, now: NOW, ...over });
    };
    const record = (over: Partial<PendingUpdate> = {}): PendingUpdate => {
      const sha = input().build.images.find((x) => x.role === "app")!.sha256;
      return {
        v: 2, project: "multikey-fido", imageFamily: "fido", fromVersion: "0.3.1", toVersion: "0.3.3", tag: "v0.3.3",
        profileId: "esp32s3-16mb", appSha256: sha, chipMac: MAC, startedAt: new Date(NOW - 3_600_000).toISOString(), ...over,
      };
    };
    const refused = (d: ReturnType<typeof unreadable>) => {
      expect(summary(d)).toEqual({ outcome: "unknown", reason: "recovery-unverified", allowed: false, writes: [] });
      return d.detail;
    };

    it("repairs a chip it saw the write start on, for the same release and image, after REPAIR is typed", () => {
      const d = unreadable(record());
      expect(summary(d)).toEqual({ outcome: "repair", reason: "interrupted-write", allowed: true, writes: [0x20000] });
      expect(d.acks).toEqual(["update-confirm", "repair-typed"]);
    });

    it("matches the MAC regardless of letter case", () => {
      expect(unreadable(record({ chipMac: MAC.toUpperCase() })).allowed).toBe(true);
    });

    it("refuses a record from an older page that did not name the chip (legacy v1)", () => {
      expect(refused(unreadable(record({ v: 1, imageFamily: null, chipMac: null })))).toContain("older version");
    });

    it("refuses a stale record", () => {
      expect(refused(unreadable(record({ startedAt: new Date(NOW - 8 * 24 * 3_600_000).toISOString() })))).toContain("older than 7 days");
      expect(refused(unreadable(record({ startedAt: "yesterday" })))).toContain("no valid date");
      expect(refused(unreadable(record({ startedAt: new Date(NOW + 3_600_000).toISOString() })))).toContain("older than 7 days or has no valid date");
    });

    it("refuses a record whose application hash is not the one offered (modified or other image)", () => {
      expect(refused(unreadable(record({ appSha256: "0".repeat(64) })))).toContain("choose that release");
    });

    it("refuses a record for another release", () => {
      expect(refused(unreadable(record({ tag: "v0.3.2" })))).toContain("v0.3.2");
    });

    it("refuses a record for another board profile or image family", () => {
      refused(unreadable(record({ profileId: "esp32s3-4mb" })));
      refused(unreadable(record({ imageFamily: "openpgp" })));
      refused(unreadable(record({ project: "multikey-openpgp" })));
    });

    it("refuses a different chip", () => {
      expect(refused(unreadable(record({ chipMac: "80:b5:4e:c8:22:79" })))).toContain("not the chip");
    });

    it("refuses when either MAC is unknown", () => {
      expect(refused(unreadable(record({ chipMac: null })))).toContain("MAC address could not be read");
      expect(refused(unreadable(record(), { chipMac: null }))).toContain("MAC address could not be read");
      expect(refused(unreadable(record(), { chipMac: undefined }))).toContain("MAC address could not be read");
    });
  });

  it("repairs when the same version holds different content", () => {
    const d = decideAppUpdate(input({ installedAppMd5: "0".repeat(32) }, "0.3.3"));
    expect(summary(d)).toEqual({ outcome: "repair", reason: "same-version-different-image", allowed: true, writes: [0x20000] });
    expect(d.acks).toContain("repair-typed");
  });

  it("never treats a release without update.app_only as compatible", () => {
    const build = fx.builds[0]!;
    expect(summary(decideAppUpdate(input({ build })))).toEqual({ outcome: "release-unsupported", reason: "release-unsupported", allowed: false, writes: [] });
  });

  it("refuses a device whose app partition is smaller than this release's, as a layout difference", () => {
    const d = decideAppUpdate(input({ table: withFactorySize(0x1000) }));
    expect(summary(d)).toEqual({ outcome: "incompatible", reason: "layout", allowed: false, writes: [] });
    expect(d.detail).toContain("factory");
  });

  it("refuses a table with an extra partition even when every protected partition matches", () => {
    const extra = entry("extra", 1, 6, 0x300000, 0x1000);
    const d = decideAppUpdate(input({ table: partitionTable({ extra: [extra] }) }));
    expect(summary(d)).toEqual({ outcome: "incompatible", reason: "layout", allowed: false, writes: [] });
    expect(d.detail).toContain("extra");
  });

  it("refuses a table whose checksum entry does not match, as not a MultiKeys table", () => {
    const t = partitionTable();
    t[4 * 32 + 20] = ~t[4 * 32 + 20]! & 0xff;
    expect(decideAppUpdate(input({ table: t })).outcome).toBe("not-multikeys");
  });

  it("refuses an app image above the policy size limit", () => {
    const build = structuredClone(input().build);
    build.images.find((i) => i.role === "app")!.size = 0x1e0001;
    expect(decideAppUpdate(input({ build })).outcome).toBe("release-unsupported");
  });

  it("accepts a prerelease installed image and refuses a non-version", () => {
    expect(decideAppUpdate(input({}, "0.3.0-dev")).outcome).toBe("safe-update");
    expect(decideAppUpdate(input({}, "1.89")).outcome).toBe("unknown");
  });

  it("blocks a key that is not the one that was inspected", () => {
    const d = decideAppUpdate(input({ baseline: { project: "multikey-fido", version: "0.3.2", flashSize: "16MB" } }));
    expect(summary(d)).toEqual({ outcome: "unknown", reason: "different-key", allowed: false, writes: [] });
    expect(decideAppUpdate(input({ baseline: { project: "multikey-fido", version: "0.3.1", flashSize: "4MB" } })).reason).toBe("different-key");
    expect(decideAppUpdate(input({ baseline: { project: "multikey-fido", version: "0.3.1", flashSize: "16MB" } })).outcome).toBe("safe-update");
    expect(decideAppUpdate(input({ baseline: { project: null, version: null, flashSize: null } })).outcome).toBe("safe-update");
  });

  it("asks for the experimental-image acknowledgement for OpenPGP", () => {
    const build = appOnly.builds.find((b) => b.image === "openpgp" && b.profile_id === "esp32s3-16mb")!;
    const d = decideAppUpdate(input({ build, appDesc: desc("0.3.1", "multikey-openpgp") }));
    expect(d.outcome).toBe("safe-update");
    expect(d.acks).toEqual(["update-confirm", "experimental-image"]);
  });

  it("every allowed decision writes only the app region, clear of the bootloader, the table and every protected partition", () => {
    const cases: AppUpdateInput[] = [
      input(), input({}, "0.3.0-dev"), input({ installedAppMd5: "0".repeat(32) }, "0.3.3"),
      input({
        appDesc: new Uint8Array(256), chipMac: "80:b5:4e:c8:22:78", now: Date.parse("2026-11-24T12:00:00Z"),
        pending: {
          v: 2, project: "multikey-fido", imageFamily: "fido", fromVersion: null, toVersion: "0.3.3", tag: "v0.3.3", profileId: "esp32s3-16mb",
          appSha256: appOnly.builds.find((b) => b.image === "fido" && b.profile_id === "esp32s3-16mb")!.images.find((x) => x.role === "app")!.sha256,
          chipMac: "80:b5:4e:c8:22:78", startedAt: "2026-11-24T11:00:00Z",
        },
      }),
    ];
    for (const c of cases) {
      const d = decideAppUpdate(c);
      expect(d.allowed).toBe(true);
      expect(d.writes).toHaveLength(1);
      const w = d.writes[0]!;
      expect(w.role).toBe("app");
      expect(w.offset).toBeGreaterThanOrEqual(0x20000);
      expect(w.offset + w.length).toBeLessThanOrEqual(0x200000);
      for (const [start, end] of [[0, 0x9000], [0x11000, 0x18000], [0x200000, 0x300000]] as const) {
        expect(w.offset < end && w.offset + w.length > start).toBe(false);
      }
    }
  });
});
