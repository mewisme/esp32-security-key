import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdater } from "@/hooks/useUpdater";
import { TIMING } from "@/lib/device/personalize";
import { FirmwareError } from "@/lib/errors/firmware-error";
import type * as CatalogModule from "@/lib/firmware/catalog";
import type { Catalog } from "@/lib/firmware/catalog";
import { validateManifest } from "@/lib/firmware/manifest";
import type { ChipInfo, FlashDriver } from "@/lib/flashing/driver";
import { md5Hex } from "@/lib/flashing/md5";
import type { PendingUpdate } from "@/lib/flashing/app-update";
import { loadPending, PENDING_KEY } from "@/lib/flashing/update-pending";
import { appImage, type FirmwareFixture, makeFirmware, partitionTable } from "../fixtures/firmware";

const h = vi.hoisted(() => ({
  catalog: null as unknown,
  makeDriver: null as null | (() => unknown),
  key: null as null | { state: unknown },
  download: null as null | (() => Promise<unknown>),
}));

vi.mock("@/lib/firmware/catalog", async (orig) => ({ ...(await orig<typeof CatalogModule>()), fetchCatalog: () => Promise.resolve(h.catalog) }));
vi.mock("@/lib/firmware/download", () => ({ downloadBuild: () => h.download!() }));
vi.mock("@/lib/flashing/create-driver", () => ({ createDriver: () => h.makeDriver!() }));
vi.mock("@/lib/device/create-key-connector", () => ({
  createKeyConnector: () => ({
    supported: () => true,
    connect: () => Promise.resolve(fakeConnection()),
  }),
}));

interface KeyState {
  project: string;
  version: string;
  sha: string;
  flash: string;
  name: string;
  enrolled: boolean;
  deviceId: number;
}

const ascii = (s: string) => Array.from(new TextEncoder().encode(s));
const tag = (t: number, v: number[]) => [t, v.length, ...v];
const ok = (data: number[]) => Uint8Array.from([...data, 0x90, 0x00]);
const shaBytes = (hex: string) => Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));

function fakeConnection() {
  return {
    identity: () => Promise.resolve({ productName: null, manufacturerName: null, serialNumber: null }),
    transmit: (apdu: Uint8Array) => {
      const k = h.key!.state as KeyState;
      if (apdu[0] === 0x00) return Promise.resolve(ok([]));
      if (apdu[1] === 0x07) {
        return Promise.resolve(ok([1, ...tag(1, ascii(k.project)), ...tag(2, ascii(k.version)), ...tag(5, shaBytes(k.sha)), ...tag(7, ascii(k.flash))]));
      }
      if (apdu[1] === 0x01) {
        const id = Array.from({ length: 16 }, () => k.deviceId);
        return Promise.resolve(ok([1, k.enrolled ? 1 : 0, 0, ...id, ...(k.enrolled ? new Array<number>(65).fill(4) : [])]));
      }
      if (apdu[1] === 0x06) return Promise.resolve(ok([4, ...ascii(k.name)]));
      return Promise.resolve(Uint8Array.from([0x6d, 0x00]));
    },
    waitForReenumeration: () => Promise.resolve(),
    watchEvents: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

class FakeDriver implements FlashDriver {
  flash = new Map<number, Uint8Array>();
  writes: number[] = [];
  pendingDuringWrite: PendingUpdate | null = null;
  failWrite = false;
  /** Number of leading md5 reads of the written region that answer with a wrong digest. */
  corruptVerifications = 0;
  private listeners = new Set<() => void>();
  constructor(init: { boot: Uint8Array; table: Uint8Array; app: Uint8Array }) {
    this.flash.set(0, init.boot);
    this.flash.set(0x8000, init.table);
    this.flash.set(0x20000, init.app);
  }
  requestPort = () => Promise.resolve({ usbVendorId: 0x303a, usbProductId: 0x1001 });
  connect = (): Promise<ChipInfo> =>
    Promise.resolve({ chipName: "ESP32-S3", description: "", features: ["Embedded PSRAM 8MB (AP_3v3)"], mac: null, flashSize: "16MB", flashType: "quad", secureDownloadMode: false });
  readFlash(offset: number, length: number) {
    const out = new Uint8Array(length).fill(0xff);
    for (const [at, data] of this.flash) {
      const s = Math.max(at, offset);
      const e = Math.min(at + data.length, offset + length);
      if (s < e) out.set(data.subarray(s - at, e - at), s - offset);
    }
    return Promise.resolve(out);
  }
  write(writes: { offset: number; data: Uint8Array }[]) {
    this.pendingDuringWrite = loadPending();
    for (const w of writes) this.writes.push(w.offset);
    if (this.failWrite) return Promise.reject(new Error("The device has been lost."));
    for (const w of writes) this.flash.set(w.offset, w.data.slice());
    return Promise.resolve();
  }
  async md5(offset: number, length: number) {
    const real = md5Hex(await this.readFlash(offset, length));
    if (this.corruptVerifications > 0 && this.writes.length > 0) {
      this.corruptVerifications -= 1;
      return "0".repeat(32);
    }
    return real;
  }
  reboot = () => Promise.resolve();
  disconnect = () => Promise.resolve();
  onDisconnect(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  log = () => [];
}

let fx: FirmwareFixture;
let catalog: Catalog;
let driver: FakeDriver;

const keyBefore = (over: Partial<KeyState> = {}): KeyState => ({
  project: "multikey-fido", version: "0.3.1", sha: "11".repeat(32), flash: "16MB", name: "My Key", enrolled: true, deviceId: 7, ...over,
});

beforeAll(async () => {
  fx = await makeFirmware({ appOnly: true, version: "0.3.3", tag: "v0.3.3" });
  catalog = {
    releases: [{ tag: "v0.3.3", name: "v0.3.3", prerelease: false, publishedAt: null, notesUrl: null, manifest: validateManifest(fx.manifest, "v0.3.3", false) }],
    rejected: [],
  };
  Object.assign(TIMING, { settleMs: 0, pauseMs: 0 });
});

function installed(version: string, over: { desc?: Uint8Array } = {}) {
  driver = new FakeDriver({ boot: fx.images.bootloader, table: partitionTable(), app: over.desc ?? appImage(version) });
  h.makeDriver = () => driver;
}

beforeEach(() => {
  localStorage.clear();
  h.catalog = catalog;
  h.key = { state: keyBefore() };
  h.download = () => Promise.resolve([{ role: "app", offset: 0x20000, data: fx.images.app }]);
  installed("0.3.1");
});
afterEach(() => localStorage.clear());

async function run(fn: () => Promise<void>) {
  await act(async () => {
    await fn();
  });
}

async function toReview(result: { current: ReturnType<typeof useUpdater> }, inspect = true) {
  await vi.waitFor(() => expect(result.current.catalog.status).toBe("ready"));
  if (inspect) await run(() => result.current.actions.inspect());
  else act(() => result.current.actions.skipInspect());
  act(() => result.current.actions.toCheck());
  act(() => result.current.actions.toReview());
  await run(() => result.current.actions.choosePort());
}

describe("useUpdater", () => {
  it("writes the app region once, keeps the pending record while writing, and reports what the key says afterwards", async () => {
    const { result } = renderHook(() => useUpdater());
    await toReview(result);
    expect(result.current.state.baseline).toMatchObject({ status: "ok" });
    expect(result.current.state.decision).toMatchObject({ outcome: "safe-update", allowed: true });
    expect(driver.writes).toEqual([]);

    await run(() => result.current.actions.confirm(["update-confirm"]));
    expect(driver.writes).toEqual([0x20000]);
    expect(driver.pendingDuringWrite).toMatchObject({ project: "multikey-fido", toVersion: "0.3.3", fromVersion: "0.3.1" });
    expect(loadPending()).toBeNull();
    expect(result.current.state.phase).toBe("awaiting-replug");
    expect(driver.flash.get(0x20000)).toEqual(fx.images.app);

    const sha = fx.build.images.find((i) => i.role === "app")!.sha256;
    h.key!.state = keyBefore({ version: "0.3.3", sha });
    await run(() => result.current.actions.verifyDevice());
    expect(result.current.state.phase).toBe("done");
    expect(result.current.state.report).toMatchObject({
      imageMatches: true, versionMatches: true, nameUnchanged: true, mkauthUnchanged: true, fidoChecked: false, verdict: "verified",
    });
  });

  it("does nothing without every required acknowledgement", async () => {
    const { result } = renderHook(() => useUpdater());
    await toReview(result);
    await run(() => result.current.actions.confirm([]));
    expect(driver.writes).toEqual([]);
    expect(result.current.state.phase).toBe("reviewed");
  });

  it("a write that fails keeps the pending record and does not retry", async () => {
    const { result } = renderHook(() => useUpdater());
    await toReview(result);
    driver.failWrite = true;
    await run(() => result.current.actions.confirm(["update-confirm"]));
    expect(result.current.state.phase).toBe("failed");
    expect(result.current.state.error?.code).toBe("flash-write-failed");
    expect(driver.writes).toEqual([0x20000]);
    expect(loadPending()).toMatchObject({ toVersion: "0.3.3" });
  });

  it("a verification that fails twice ends with flash-verify-failed after exactly two writes of the app region", async () => {
    const { result } = renderHook(() => useUpdater());
    await toReview(result);
    driver.corruptVerifications = 2;
    await run(() => result.current.actions.confirm(["update-confirm"]));
    expect(result.current.state.phase).toBe("failed");
    expect(result.current.state.error?.code).toBe("flash-verify-failed");
    expect(driver.writes).toEqual([0x20000, 0x20000]);
    expect(loadPending()).not.toBeNull();
  });

  it("one failed verification is retried once and then succeeds", async () => {
    const { result } = renderHook(() => useUpdater());
    await toReview(result);
    driver.corruptVerifications = 1;
    await run(() => result.current.actions.confirm(["update-confirm"]));
    expect(driver.writes).toEqual([0x20000, 0x20000]);
    expect(result.current.state.phase).toBe("awaiting-replug");
    expect(loadPending()).toBeNull();
  });

  it("refuses a key that is not the one that was inspected", async () => {
    h.key!.state = keyBefore({ version: "0.3.2" });
    const { result } = renderHook(() => useUpdater());
    await toReview(result);
    expect(result.current.state.decision).toMatchObject({ outcome: "unknown", reason: "different-key", allowed: false });
    await run(() => result.current.actions.confirm(["update-confirm"]));
    expect(driver.writes).toEqual([]);
  });

  it("a download whose checksum fails never reaches the flash", async () => {
    h.download = () => Promise.reject(new FirmwareError("checksum-mismatch", "SHA-256 differs"));
    const { result } = renderHook(() => useUpdater());
    await toReview(result);
    expect(result.current.state.phase).toBe("failed");
    expect(result.current.state.error?.code).toBe("checksum-mismatch");
    expect(driver.writes).toEqual([]);
  });

  it("shows a version or name that changed, and a key that runs another version, as a mismatch", async () => {
    const { result } = renderHook(() => useUpdater());
    await toReview(result);
    await run(() => result.current.actions.confirm(["update-confirm"]));
    h.key!.state = keyBefore({ version: "0.3.1", sha: "22".repeat(32), name: "Other", deviceId: 9 });
    await run(() => result.current.actions.verifyDevice());
    expect(result.current.state.report).toMatchObject({ imageMatches: false, versionMatches: false, nameUnchanged: false, mkauthUnchanged: false, verdict: "mismatch" });
  });

  it("a key whose application is unreadable is repaired only when an interrupted write is on record", async () => {
    installed("", { desc: new Uint8Array(0x20000).fill(0xff) });
    const { result: plain } = renderHook(() => useUpdater());
    await toReview(plain, false);
    expect(plain.current.state.decision).toMatchObject({ outcome: "unknown", allowed: false });
    expect(driver.writes).toEqual([]);

    const record: PendingUpdate = { project: "multikey-fido", fromVersion: "0.3.1", toVersion: "0.3.3", tag: "v0.3.3", profileId: "esp32s3-16mb", appSha256: "0".repeat(64), startedAt: "2026-11-24T00:00:00Z" };
    localStorage.setItem(PENDING_KEY, JSON.stringify(record));
    const { result } = renderHook(() => useUpdater());
    await toReview(result, false);
    expect(result.current.state.decision).toMatchObject({ outcome: "repair", allowed: true });
    await run(() => result.current.actions.confirm(["update-confirm"]));
    expect(driver.writes).toEqual([]);
    await run(() => result.current.actions.confirm(["update-confirm", "repair-typed"]));
    expect(driver.writes).toEqual([0x20000]);
  });
});
