// Drives the application-only update: reads the running key (optional), finds the release, reads the key in download
// mode, decides with decideAppUpdate, and writes only in `confirm`, which re-decides on the same open connection first.
// The only region ever written is the app image (decideAppUpdate returns at most that one write).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { selectProfile, type Support } from "@/lib/compatibility/profiles";
import { createKeyConnector } from "@/lib/device/create-key-connector";
import type { KeyConnection } from "@/lib/device/key-connector";
import { type KeySnapshot, readKeySnapshot } from "@/lib/device/key-snapshot";
import { TIMING } from "@/lib/device/personalize";
import type { ErrorCode } from "@/lib/errors/catalog";
import { classifyError, DisconnectedError } from "@/lib/errors/classify";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { type Catalog, fetchCatalog } from "@/lib/firmware/catalog";
import { type DownloadedImage, downloadBuild } from "@/lib/firmware/download";
import { appOffset, type HardwareProfile, policy } from "@/lib/firmware/policy";
import type { Build } from "@/lib/firmware/types";
import { parseAppDescriptor } from "@/lib/flashing/app-descriptor";
import { type AppUpdateDecision, decideAppUpdate, type PendingUpdate, type UpdateAckId, type UpdateBaseline } from "@/lib/flashing/app-update";
import { createDriver } from "@/lib/flashing/create-driver";
import type { FlashDriver } from "@/lib/flashing/driver";
import type { Phase } from "@/lib/flashing/machine";
import { md5Hex } from "@/lib/flashing/md5";
import { clearPending, loadPending, savePending } from "@/lib/flashing/update-pending";
import { buildReport, type UpdateReport } from "@/lib/flashing/update-report";
import { defaultUpdateTarget, findUpdateTarget, listUpdateTargets, targetByTag, type UpdateTarget } from "@/lib/flashing/update-target";
import { SERIAL_FILTERS } from "@/hooks/useInstaller";
import type { UpdateStep } from "@/lib/update-steps";

export type UpdatePhase =
  | "idle"
  | "inspecting"
  | "inspected"
  | "checked"
  | "awaiting-boot"
  | "choosing"
  | "reviewed"
  | "updating"
  | "verifying-flash"
  | "rebooting"
  | "awaiting-replug"
  | "verifying-device"
  | "done"
  | "failed";

/** Failures stay on the step they happened in. */

const STEP_OF: Record<Exclude<UpdatePhase, "failed">, UpdateStep> = {
  idle: "connect",
  inspecting: "connect",
  inspected: "connect",
  checked: "check",
  "awaiting-boot": "review",
  choosing: "review",
  reviewed: "review",
  updating: "update",
  "verifying-flash": "update",
  rebooting: "update",
  "awaiting-replug": "verify",
  "verifying-device": "verify",
  done: "verify",
};

/** Phases in which the flash is being written: leaving, unplugging or closing the tab can leave the key unbootable. */
export const UNINTERRUPTIBLE: readonly UpdatePhase[] = ["updating", "verifying-flash"];

export type Baseline = { status: "ok"; snapshot: KeySnapshot } | { status: "skipped" };

export interface UpdateState {
  phase: UpdatePhase;
  /** Where a failure happened (the step shown while `phase` is "failed"). */
  failedAt: UpdatePhase | null;
  baseline: Baseline | null;
  /** The key could not be read over WebUSB (closed, not chosen, unsupported); the person may skip. */
  inspectNote: "not-chosen" | "failed" | null;
  /** Stage of the choosing phase. */
  stage: "connecting" | "downloading" | "reading" | null;
  target: { release: UpdateTarget["release"]; build: Build; profile: HardwareProfile; support: Support } | null;
  /** The release the person picked on the check step; null until they pick one. */
  selectedTag: string | null;
  decision: AppUpdateDecision | null;
  download: { received: number; total: number } | null;
  progress: { written: number; total: number } | null;
  error: { code: ErrorCode; message: string } | null;
  report: UpdateReport | null;
  /** A write that started in an earlier visit and was never verified. */
  pending: PendingUpdate | null;
  log: string[];
}

const initial = (): UpdateState => ({
  phase: "idle",
  failedAt: null,
  baseline: null,
  inspectNote: null,
  stage: null,
  target: null,
  selectedTag: null,
  decision: null,
  download: null,
  progress: null,
  error: null,
  report: null,
  pending: loadPending(),
  log: [],
});

type Action = { type: "patch"; patch: Partial<UpdateState> } | { type: "reset" };

function reducer(s: UpdateState, a: Action): UpdateState {
  if (a.type === "reset") return initial();
  // A started write ends only through its own outcome: nothing else may move the machine out of it.
  if (UNINTERRUPTIBLE.includes(s.phase) && a.patch.phase !== undefined && !["updating", "verifying-flash", "rebooting", "failed"].includes(a.patch.phase)) return s;
  return { ...s, ...a.patch };
}

export function stepOf(s: Pick<UpdateState, "phase" | "failedAt">): UpdateStep {
  if (s.phase === "failed") return s.failedAt && s.failedAt !== "failed" ? STEP_OF[s.failedAt] : "connect";
  return STEP_OF[s.phase];
}

export type CatalogState = { status: "loading" } | { status: "ready"; catalog: Catalog } | { status: "error"; message: string };

export interface UpdaterActions {
  /** Must run from a click (WebUSB chooser). */
  inspect(): Promise<void>;
  skipInspect(): void;
  toCheck(): void;
  toReview(): void;
  back(): void;
  /** Must run from a click (Web Serial chooser). */
  choosePort(): Promise<void>;
  confirm(acks: UpdateAckId[]): Promise<void>;
  /** Must run from a click (WebUSB chooser). */
  verifyDevice(): Promise<void>;
  skipVerify(): void;
  reset(): Promise<void>;
  loadCatalog(): void;
  setRelease(tag: string): void;
}

export interface Updater {
  state: UpdateState;
  step: UpdateStep;
  catalog: CatalogState;
  /** The build the check step offers, from the inspected key's family (fido when nothing was inspected). */
  latest: UpdateTarget | null;
  /** What the person may pick: releases newer than the installed version, newest first. */
  offers: UpdateTarget[];
  /** The chosen release, or the one right after the installed version when nothing was chosen. */
  selected: UpdateTarget | null;
  actions: UpdaterActions;
}

const imageOf = (project: string | null | undefined): Build["image"] | null =>
  project === "multikey-fido" ? "fido" : project === "multikey-openpgp" ? "openpgp" : null;

export function baselineOf(b: Baseline | null): UpdateBaseline | null {
  if (b?.status !== "ok" || !b.snapshot.build) return null;
  const i = b.snapshot.build;
  return { project: i.project ?? null, version: i.version ?? null, flashSize: i.flashBuiltFor ?? null };
}

export function useUpdater(): Updater {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const driver = useRef<FlashDriver | null>(null);
  const conn = useRef<KeyConnection | null>(null);
  const data = useRef<{ app: Uint8Array; offset: number } | null>(null);
  const disconnected = useRef(false);
  const unlisten = useRef<(() => void) | null>(null);
  const patch = useCallback((p: Partial<UpdateState>) => dispatch({ type: "patch", patch: p }), []);

  const fetchInto = useCallback(
    () =>
      fetchCatalog()
        .then((c) => setCatalog({ status: "ready", catalog: c }))
        .catch((e: unknown) => setCatalog({ status: "error", message: e instanceof Error ? e.message : String(e) })),
    [],
  );
  useEffect(() => {
    void fetchInto();
  }, [fetchInto]);
  const loadCatalog = useCallback(() => {
    setCatalog({ status: "loading" });
    void fetchInto();
  }, [fetchInto]);

  useEffect(() => {
    if (!UNINTERRUPTIBLE.includes(state.phase)) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [state.phase]);

  const closeDriver = useCallback(async () => {
    unlisten.current?.();
    unlisten.current = null;
    const d = driver.current;
    if (d) await d.disconnect().catch(() => {});
  }, []);

  const closeKey = useCallback(async () => {
    const c = conn.current;
    conn.current = null;
    await c?.close().catch(() => {});
  }, []);

  const fail = useCallback(
    (err: unknown, phase: Phase, at: UpdatePhase) => {
      const e = disconnected.current && !(err instanceof FirmwareError) ? new DisconnectedError() : err;
      patch({
        phase: "failed",
        failedAt: at,
        error: { code: classifyError(e, phase), message: e instanceof Error ? e.message : String(e) },
        log: driver.current?.log() ?? [],
      });
    },
    [patch],
  );

  const baseline = useMemo(() => baselineOf(state.baseline), [state.baseline]);
  const baselineImage = imageOf(baseline?.project) ?? "fido";
  const latest = useMemo(
    () => (catalog.status === "ready" ? findUpdateTarget(catalog.catalog, baselineImage, baseline?.flashSize ?? null) : null),
    [baseline?.flashSize, baselineImage, catalog],
  );
  const installedVersion = baseline?.version ?? null;
  const offers = useMemo(
    () => (catalog.status === "ready" ? listUpdateTargets(catalog.catalog, baselineImage, baseline?.flashSize ?? null, installedVersion) : []),
    [baseline?.flashSize, baselineImage, catalog, installedVersion],
  );
  const selected = useMemo(
    () => offers.find((o) => o.release.tag === state.selectedTag) ?? defaultUpdateTarget(offers, installedVersion, latest),
    [installedVersion, latest, offers, state.selectedTag],
  );
  const setRelease = useCallback((tag: string) => patch({ selectedTag: tag }), [patch]);

  const inspect = useCallback(async () => {
    const connector = createKeyConnector();
    if (!connector.supported()) {
      patch({ inspectNote: "failed" });
      return;
    }
    patch({ phase: "inspecting", inspectNote: null });
    let c: KeyConnection;
    try {
      const [vid, pid] = policy.native_usb.app;
      c = await connector.connect(vid, pid);
    } catch {
      patch({ phase: "idle", inspectNote: "not-chosen" });
      return;
    }
    conn.current = c;
    try {
      const snapshot = await readKeySnapshot(c);
      patch({ phase: "inspected", baseline: { status: "ok", snapshot } });
    } catch {
      patch({ phase: "idle", inspectNote: "failed" });
    } finally {
      await closeKey();
    }
  }, [closeKey, patch]);

  const skipInspect = useCallback(() => patch({ phase: "inspected", baseline: { status: "skipped" }, inspectNote: null }), [patch]);
  const toCheck = useCallback(() => patch({ phase: "checked" }), [patch]);
  const toReview = useCallback(() => patch({ phase: "awaiting-boot", decision: null, target: null, error: null }), [patch]);
  const back = useCallback(() => {
    const prev: Partial<Record<UpdatePhase, UpdatePhase>> = { inspected: "idle", checked: "inspected", "awaiting-boot": "checked", reviewed: "awaiting-boot" };
    const to = prev[state.phase];
    if (to) patch({ phase: to });
  }, [patch, state.phase]);

  /** Everything the decision needs from the chip that will be written, read through `d`. */
  const readDevice = useCallback(async (d: FlashDriver, build: Build, app: Uint8Array) => {
    const offset = appOffset();
    // One command at a time: the serial link carries a single exchange.
    const table = await d.readFlash(policy.partition_table.offset, policy.partition_table.read_length);
    const appDesc = await d.readFlash(policy.app_descriptor.offset - 0x20, policy.app_descriptor.read_length);
    const bootHeader = await d.readFlash(0, 16);
    const size = build.images.find((i) => i.role === "app")?.size ?? app.length;
    const installedAppMd5 = await d.md5(offset, size).then((m) => m.toLowerCase(), () => null);
    return { table, appDesc, bootHeader, installedAppMd5 };
  }, []);

  const choosePort = useCallback(async () => {
    if (catalog.status !== "ready") return;
    let phase: Phase = "requesting-permission";
    await closeDriver();
    const d = createDriver();
    driver.current = d;
    disconnected.current = false;
    data.current = null;
    patch({ phase: "choosing", stage: "connecting", decision: null, target: null, error: null, download: null });
    try {
      await d.requestPort(SERIAL_FILTERS);
      unlisten.current = d.onDisconnect(() => {
        disconnected.current = true;
      });
      phase = "connecting";
      const chip = await d.connect();
      phase = "detecting-chip";
      if (chip.secureDownloadMode) throw new FirmwareError("secure-download-mode", "secure download mode is enabled");
      phase = "checking-flash-safety";
      // The family comes from what is installed, so the update never changes it; the decision still checks.
      const installed = parseAppDescriptor(await d.readFlash(policy.app_descriptor.offset - 0x20, policy.app_descriptor.read_length));
      const image = imageOf(installed?.project_name) ?? baselineImage;
      phase = "validating-compatibility";
      const wanted = selected ? targetByTag(catalog.catalog, selected.release.tag, image, chip.flashSize) : null;
      const offered = wanted ?? findUpdateTarget(catalog.catalog, image, chip.flashSize);
      if (!offered) throw new FirmwareError("profile-not-in-release", `no ${image} build in any release`);
      const picked = selectProfile(chip, offered.release.manifest.builds, image);
      if (!picked.ok) throw new FirmwareError(picked.code, picked.detail);
      const target = { release: offered.release, build: picked.build, profile: picked.profile, support: picked.support };
      patch({ target, stage: "downloading" });
      phase = "downloading";
      const images: DownloadedImage[] = await downloadBuild(target.release.tag, target.build, (received, total) => patch({ download: { received, total } }));
      phase = "verifying-integrity";
      const app = images.find((i) => i.role === "app");
      if (!app) throw new FirmwareError("manifest-invalid", "the package has no app image");
      data.current = { app: app.data, offset: app.offset };
      phase = "checking-flash-safety";
      patch({ stage: "reading" });
      const read = await readDevice(d, target.build, app.data);
      const decision = decideAppUpdate({
        ...read,
        targetAppMd5: md5Hex(app.data),
        targetAppHeader: app.data.slice(0, 16),
        build: target.build,
        tag: target.release.tag,
        pending: state.pending,
        baseline: baselineOf(state.baseline),
        untestedHardware: target.support !== "hardware-verified",
      });
      patch({ phase: "reviewed", stage: null, decision, log: d.log() });
      if (!decision.allowed) await closeDriver();
    } catch (err) {
      fail(err, phase, "choosing");
      await closeDriver();
    }
  }, [baselineImage, catalog, closeDriver, fail, patch, readDevice, selected, state.baseline, state.pending]);

  const confirm = useCallback(
    async (acks: UpdateAckId[]) => {
      const d = driver.current;
      const { decision, target } = state;
      const bytes = data.current;
      if (!d || !decision || !target || !bytes || state.phase !== "reviewed" || !decision.allowed) return;
      if (!decision.acks.every((a) => acks.includes(a))) return;
      let phase: Phase = "checking-flash-safety";
      try {
        // Decide again on the same open connection: what is written must be what was reviewed.
        const read = await readDevice(d, target.build, bytes.app);
        const again = decideAppUpdate({
          ...read,
          targetAppMd5: md5Hex(bytes.app),
          targetAppHeader: bytes.app.slice(0, 16),
          build: target.build,
          tag: target.release.tag,
          pending: state.pending,
          baseline: baselineOf(state.baseline),
          untestedHardware: target.support !== "hardware-verified",
        });
        if (!again.allowed || again.outcome !== decision.outcome) {
          patch({ phase: "reviewed", decision: again });
          await closeDriver();
          return;
        }
        const w = again.writes[0];
        if (again.writes.length !== 1 || !w || w.role !== "app" || w.offset !== bytes.offset || w.length !== bytes.app.length) {
          throw new FirmwareError("manifest-invalid", "the update is not a single app write");
        }
        const app = target.build.images.find((i) => i.role === "app")!;
        const record: PendingUpdate = {
          project: target.build.project_name,
          fromVersion: again.installed.version,
          toVersion: target.build.version,
          tag: target.release.tag,
          profileId: target.build.profile_id,
          appSha256: app.sha256,
          startedAt: new Date().toISOString(),
        };
        savePending(record);
        patch({ phase: "updating", progress: { written: 0, total: bytes.app.length }, pending: record });
        phase = "flashing";
        const want = md5Hex(bytes.app);
        for (let attempt = 1; ; attempt += 1) {
          await d.write([{ offset: w.offset, data: bytes.app }], (written, total) => patch({ progress: { written, total } }));
          if (disconnected.current) throw new DisconnectedError();
          patch({ phase: "verifying-flash" });
          phase = "verifying-flash";
          const got = (await d.md5(w.offset, bytes.app.length)).toLowerCase();
          if (got === want) break;
          // One more try of the same single write, never anything else.
          if (attempt >= 2) throw new Error(`flash at 0x${w.offset.toString(16)} does not match (md5 ${got})`);
          patch({ phase: "updating", progress: { written: 0, total: bytes.app.length } });
          phase = "flashing";
        }
        clearPending();
        patch({ pending: null });
        phase = "rebooting";
        patch({ phase: "rebooting" });
        unlisten.current?.();
        unlisten.current = null;
        await d.reboot();
        patch({ log: d.log() });
        await closeDriver();
        patch({ phase: "awaiting-replug" });
      } catch (err) {
        fail(err, phase, phase === "rebooting" ? "rebooting" : "updating");
        await closeDriver();
      }
    },
    [closeDriver, fail, patch, readDevice, state],
  );

  const verifyDevice = useCallback(async () => {
    const target = state.target;
    if (!target) return;
    const finish = (after: KeySnapshot | null) => {
      const app = target.build.images.find((i) => i.role === "app")!;
      patch({
        phase: "done",
        report: buildReport(state.baseline?.status === "ok" ? state.baseline.snapshot : null, after, { version: target.build.version, appSha256: app.sha256 }),
      });
    };
    // The OpenPGP image has no MKAUTH/WebUSB interface to read from: nothing can be checked here.
    if (target.build.image !== "fido") return finish(null);
    const connector = createKeyConnector();
    if (!connector.supported()) return finish(null);
    patch({ phase: "verifying-device" });
    try {
      const c = await connector.connect(target.build.usb.vid, target.build.usb.pid);
      conn.current = c;
      await new Promise((r) => setTimeout(r, TIMING.settleMs));
      finish(await readKeySnapshot(c, TIMING.restartAttempts, TIMING.pauseMs));
    } catch {
      finish(null);
    } finally {
      await closeKey();
    }
  }, [closeKey, patch, state.baseline, state.target]);

  const skipVerify = useCallback(() => {
    const target = state.target;
    if (!target) return;
    const app = target.build.images.find((i) => i.role === "app")!;
    patch({ phase: "done", report: buildReport(null, null, { version: target.build.version, appSha256: app.sha256 }) });
  }, [patch, state.target]);

  const reset = useCallback(async () => {
    await closeDriver();
    await closeKey();
    data.current = null;
    dispatch({ type: "reset" });
  }, [closeDriver, closeKey]);

  useEffect(
    () => () => {
      unlisten.current?.();
      void driver.current?.disconnect().catch(() => {});
      void conn.current?.close().catch(() => {});
    },
    [],
  );

  return {
    state,
    step: stepOf(state),
    catalog,
    latest,
    offers,
    selected,
    actions: { inspect, skipInspect, toCheck, toReview, back, choosePort, confirm, verifyDevice, skipVerify, reset, loadCatalog, setRelease },
  };
}
