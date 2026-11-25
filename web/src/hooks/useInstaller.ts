// Drives the installer state machine: performs the device, network and flash side effects in order and feeds the
// reducer. Every write happens only in `confirm`, which the reducer gates on all required acknowledgements. Choices made
// before connecting (release, device name) live in `config`, which survives Back/Continue and reloads of the tab.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { BOARD_IDENTITY_VERIFIED, selectProfile, type Support } from "@/lib/compatibility/profiles";
import { createKeyConnector } from "@/lib/device/create-key-connector";
import type { KeyConnection } from "@/lib/device/key-connector";
import { type KeySnapshot, readKeySnapshot } from "@/lib/device/key-snapshot";
import type { NameRequest } from "@/lib/device/mkauth";
import { type NameState, TIMING } from "@/lib/device/personalize";
import { useKeyName } from "@/hooks/useKeyName";
import { classifyError, DisconnectedError } from "@/lib/errors/classify";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { type Catalog, type CatalogRelease, defaultRelease, fetchCatalog } from "@/lib/firmware/catalog";
import { type DownloadedImage, downloadBuild } from "@/lib/firmware/download";
import { validateManifest } from "@/lib/firmware/manifest";
import { APP_DESC_IMAGE_OFFSET, appOffset, type HardwareProfile, policy } from "@/lib/firmware/policy";
import type { Build } from "@/lib/firmware/types";
import { parseAppDescriptor } from "@/lib/flashing/app-descriptor";
import type { UpdateBaseline } from "@/lib/flashing/app-update";
import { createDriver } from "@/lib/flashing/create-driver";
import type { ChipInfo, FlashDriver, PortInfo } from "@/lib/flashing/driver";
import { md5Hex } from "@/lib/flashing/md5";
import { type AckId, type InstallDecision } from "@/lib/flashing/install-mode";
import { flashReducer, initialState, type FlashState, type Phase } from "@/lib/flashing/machine";
import { planFlash } from "@/lib/flashing/plan";
import { clearPending, loadPending, savePending } from "@/lib/flashing/update-pending";
import { buildReport, type UpdateReport } from "@/lib/flashing/update-report";
import { type InstallerConfig, loadConfig, saveConfig } from "@/lib/installer-config";

export type CatalogState =
  | { status: "loading" }
  | { status: "ready"; catalog: Catalog }
  | { status: "error"; message: string };

export const SERIAL_FILTERS: SerialPortFilter[] = [
  { usbVendorId: policy.native_usb.download[0] },
  ...policy.uart_bridges.map(([usbVendorId, usbProductId]) => ({ usbVendorId, usbProductId })),
];

export function isUartBridge(port: PortInfo | null): boolean {
  return !!port && policy.uart_bridges.some(([v, p]) => v === port.usbVendorId && p === port.usbProductId);
}

const imageOf = (project: string | null | undefined): Build["image"] | null =>
  project === "multikey-fido" ? "fido" : project === "multikey-openpgp" ? "openpgp" : null;

/** What the running key said before the write, in the shape the application-only rules compare with the board. */
function baselineOf(snap: KeySnapshot | null): UpdateBaseline | null {
  const i = snap?.build;
  return i ? { project: i.project ?? null, version: i.version ?? null, flashSize: i.flashBuiltFor ?? null } : null;
}

function browserProblem(): "insecure-context" | "browser-unsupported" | null {
  if (!window.isSecureContext) return "insecure-context";
  if (typeof navigator.serial?.requestPort !== "function") return "browser-unsupported";
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile === true) return "browser-unsupported";
  return null;
}

/** The board's resolved firmware: chosen release, the build for its flash size, how well that is known to work. */
export interface Selection {
  release: CatalogRelease;
  build: Build;
  profile: HardwareProfile;
  support: Support;
}

export interface InstallerActions {
  /** Stage 1 -> 2: checks the browser, then continues. Safe to call again after Back. */
  begin(): void;
  setRelease(tag: string): void;
  setImage(image: InstallerConfig["image"]): void;
  setNameRequest(req: NameRequest): void;
  /** Stage 2 -> 3: commits the configured release. */
  selectFirmware(): void;
  back(): void;
  choosePort(): Promise<void>;
  confirm(acks: AckId[]): Promise<void>;
  /** Must run from a click (WebUSB device chooser): checks the key and applies the requested name. */
  connectKey(): Promise<void>;
  /** The management PIN is passed through to the key and never stored. */
  submitPin(pin: string): Promise<void>;
  /** Applies the requested name again (runs connectKey again). */
  applyName(): Promise<void>;
  skipCheck(): void;
  retry(): void;
  cancel(): Promise<void>;
  reset(): Promise<void>;
  /** From the review: back to the firmware choice (another release or family); nothing was written. */
  changeFirmware(): Promise<void>;
  /** Deletes the interrupted-write record and goes back to the firmware choice. */
  discardPending(): Promise<void>;
  /** Must run from a click (WebUSB chooser). Optional: reads the running key before the write; true when it could. */
  readBaseline(): Promise<boolean>;
  clearBaseline(): void;
}

export interface Installer {
  state: FlashState;
  catalog: CatalogState;
  loadCatalog(): void;
  defaultRelease: CatalogRelease | null;
  config: InstallerConfig;
  selection: Selection | null;
  name: NameState;
  log: string[];
  /** The running key as read before the write; null when it was not read. */
  baseline: KeySnapshot | null;
  /** After an application-only write: what the page could check about the key. */
  report: UpdateReport | null;
  actions: InstallerActions;
}

export function useInstaller(): Installer {
  const [state, dispatch] = useReducer(flashReducer, initialState);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [config, setConfig] = useState<InstallerConfig>(loadConfig);
  const [selection, setSelection] = useState<Selection | null>(null);
  const keyName = useKeyName();
  const [log, setLog] = useState<string[]>([]);
  /** The running key as read over WebUSB before the write (optional), compared with the key afterwards. */
  const [baseline, setBaseline] = useState<KeySnapshot | null>(null);
  const [report, setReport] = useState<UpdateReport | null>(null);
  /** What the last plan read from the board: the installed version and the chip, for the pending-write record. */
  const boardRef = useRef<{ installedVersion: string | null; chip: ChipInfo } | null>(null);
  const driver = useRef<FlashDriver | null>(null);
  const images = useRef<DownloadedImage[]>([]);
  const disconnected = useRef(false);
  const unlisten = useRef<(() => void) | null>(null);

  useEffect(() => saveConfig(config), [config]);

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

  const fail = useCallback((err: unknown, phase: Phase) => {
    const e = disconnected.current && !(err instanceof FirmwareError) ? new DisconnectedError() : err;
    setLog(driver.current?.log() ?? []);
    dispatch({ type: "FAIL", code: classifyError(e, phase), message: e instanceof Error ? e.message : String(e) });
  }, [dispatch]);

  const closeDriver = useCallback(async () => {
    unlisten.current?.();
    unlisten.current = null;
    const d = driver.current;
    if (d) await d.disconnect().catch(() => {});
  }, []);

  const begin = useCallback(() => {
    dispatch({ type: "START" });
    const problem = browserProblem();
    dispatch(problem ? { type: "BROWSER_UNSUPPORTED", code: problem } : { type: "BROWSER_OK" });
    dispatch({ type: "HARDWARE_CONFIRMED" });
  }, [dispatch]);

  /** The flow ends without a verified key reading; an application-only write still gets a (mostly "not checked") report. */
  const notDetected = useCallback(() => {
    const b = selection?.build;
    if (b && state.decision?.mode.startsWith("app-")) {
      setReport(buildReport(baseline, null, { version: b.version, appSha256: b.images.find((i) => i.role === "app")?.sha256 ?? "" }));
    }
    dispatch({ type: "DEVICE_NOT_DETECTED" });
  }, [baseline, selection, state.decision]);

  const setRelease = useCallback((tag: string) => setConfig((c) => ({ ...c, tag })), []);
  const setImage = useCallback((image: InstallerConfig["image"]) => setConfig((c) => ({ ...c, image })), []);
  const setNameRequest = useCallback((req: NameRequest) => setConfig((c) => ({ ...c, name: req })), []);

  const releaseFor = useCallback(
    (tag: string | null): CatalogRelease | null => {
      if (catalog.status !== "ready") return null;
      return catalog.catalog.releases.find((r) => r.tag === tag) ?? defaultRelease(catalog.catalog);
    },
    [catalog],
  );

  const selectFirmware = useCallback(() => {
    const release = releaseFor(config.tag);
    if (!release) return;
    setConfig((c) => (c.tag === release.tag ? c : { ...c, tag: release.tag }));
    dispatch({ type: "FIRMWARE_SELECTED", tag: release.tag, image: config.image });
  }, [config.image, config.tag, releaseFor]);

  const back = useCallback(() => dispatch({ type: "BACK" }), [dispatch]);

  /** Everything the plan needs from the connected board, read through `d` (read-only), and the plan itself. */
  const planFor = useCallback(
    async (d: FlashDriver, release: CatalogRelease, build: Build, appData: Uint8Array, chip: ChipInfo): Promise<{ decision: InstallDecision; installedVersion: string | null }> => {
      const table = await d.readFlash(policy.partition_table.offset, policy.partition_table.read_length);
      const appDesc = await d.readFlash(policy.app_descriptor.offset - APP_DESC_IMAGE_OFFSET, policy.app_descriptor.read_length);
      const bootHeader = await d.readFlash(0, 16);
      const size = build.images.find((i) => i.role === "app")?.size ?? appData.length;
      // The flash content, not a version string, says whether the application on the board already is this build.
      const installedAppMd5 = await d.md5(appOffset(), size).then((m) => m.toLowerCase(), () => null);
      const installed = parseAppDescriptor(appDesc);
      // A downgrade is declared by the release that is installed: find it in the catalog by project and version.
      const installedBuild =
        installed && catalog.status === "ready"
          ? catalog.catalog.releases.flatMap((r) => r.manifest.builds).find((x) => x.project_name === installed.project_name && x.version === installed.version)
          : undefined;
      const decision = planFlash({
        table,
        appDesc,
        bootHeader,
        installedAppMd5,
        targetAppMd5: md5Hex(appData),
        targetAppHeader: appData.slice(0, 16),
        build,
        tag: release.tag,
        pending: loadPending(),
        chipMac: chip.mac ?? null,
        baseline: baselineOf(baseline),
        untestedHardware: !BOARD_IDENTITY_VERIFIED,
        unsignedRelease: release.authentication.status !== "signed",
        installedDowngradeFloor: installedBuild?.update.downgrade_floor ?? null,
      });
      return { decision, installedVersion: installed?.version ?? null };
    },
    [baseline, catalog],
  );

  /** Must run from a click: the browser only opens the device chooser in response to a user gesture. */
  const choosePort = useCallback(async () => {
    const release = releaseFor(state.tag);
    if (!release || !state.image) return;
    let phase: Phase = "requesting-permission";
    await closeDriver();
    const d = createDriver();
    driver.current = d;
    disconnected.current = false;
    images.current = [];
    boardRef.current = null;
    setSelection(null);
    try {
      const info = await d.requestPort(SERIAL_FILTERS);
      unlisten.current = d.onDisconnect(() => {
        disconnected.current = true;
      });
      dispatch({ type: "PORT_GRANTED", info });
      phase = "connecting";
      const chip = await d.connect();
      dispatch({ type: "CONNECTED" });
      phase = "detecting-chip";
      dispatch({ type: "CHIP_DETECTED", chip });
      phase = "validating-compatibility";
      if (chip.secureDownloadMode) throw new FirmwareError("secure-download-mode", "secure download mode is enabled");
      // Detect: the MultiKeys image on the board (if any) decides the family unless the person chose one.
      const installedProject = parseAppDescriptor(
        await d.readFlash(policy.app_descriptor.offset - APP_DESC_IMAGE_OFFSET, policy.app_descriptor.read_length),
      )?.project_name;
      const image = state.image === "auto" ? (imageOf(installedProject) ?? "fido") : state.image;
      const picked = selectProfile(chip, release.manifest.builds, image);
      if (!picked.ok) throw new FirmwareError(picked.code, picked.detail);
      const b = picked.build;
      setSelection({ release, build: b, profile: picked.profile, support: picked.support });
      dispatch({ type: "COMPATIBLE", buildId: b.id, profileId: picked.profile.id, support: picked.support });
      phase = "fetching-metadata";
      validateManifest(release.manifest, release.tag);
      dispatch({ type: "MANIFEST_READY" });
      phase = "downloading";
      const imgs = await downloadBuild(release.tag, b, (received, total) => dispatch({ type: "DOWNLOAD_PROGRESS", received, total }));
      dispatch({ type: "DOWNLOADED" });
      phase = "verifying-integrity";
      images.current = imgs;
      dispatch({ type: "INTEGRITY_OK" });
      phase = "checking-flash-safety";
      const app = imgs.find((i) => i.role === "app");
      if (!app) throw new FirmwareError("manifest-invalid", "the package has no app image");
      const planned = await planFor(d, release, b, app.data, chip);
      boardRef.current = { installedVersion: planned.installedVersion, chip };
      setLog(d.log());
      dispatch({ type: "SAFETY_DECIDED", decision: planned.decision });
      if (!planned.decision.allowed) await closeDriver();
    } catch (err) {
      fail(err, phase);
      await closeDriver();
    }
  }, [closeDriver, fail, planFor, releaseFor, state.image, state.tag]);

  const confirm = useCallback(
    async (acks: AckId[]) => {
      const d = driver.current;
      const decision = state.decision;
      const board = boardRef.current;
      const app = images.current.find((i) => i.role === "app");
      if (!d || !decision || !selection || !board || !app || state.phase !== "awaiting-confirmation" || !decision.acks.every((a) => acks.includes(a))) return;
      let phase: Phase = "checking-flash-safety";
      try {
        // Decide again on the same open connection: what is written must be what was reviewed.
        const again = (await planFor(d, selection.release, selection.build, app.data, board.chip)).decision;
        const same = again.allowed && again.mode === decision.mode && again.acks.length === decision.acks.length && again.acks.every((a) => decision.acks.includes(a));
        if (!same) {
          dispatch({ type: "DECISION_CHANGED", decision: again });
          if (!again.allowed) await closeDriver();
          return;
        }
        dispatch({ type: "CONFIRMED", acks });
        phase = "flashing";
        const byOffset = new Map(images.current.map((i) => [i.offset, i.data]));
        const writes = again.writes.map((w) => {
          const data = w.kind === "fill" ? new Uint8Array(w.length).fill(0xff) : byOffset.get(w.offset);
          if (!data || data.length !== w.length) throw new FirmwareError("manifest-invalid", `no verified data for ${w.role}`);
          return { offset: w.offset, data };
        });
        if (again.mode.startsWith("app-") && (again.writes.length !== 1 || again.writes[0]?.role !== "app")) {
          throw new FirmwareError("manifest-invalid", "an application-only write must be a single app write");
        }
        // Recorded before the write and removed once the flash MD5 matched: only a record of this write justifies a repair later.
        if (again.mode.startsWith("app-")) {
          savePending({
            v: 2,
            project: selection.build.project_name,
            imageFamily: selection.build.image,
            fromVersion: board.installedVersion,
            toVersion: selection.build.version,
            tag: selection.release.tag,
            profileId: selection.build.profile_id,
            appSha256: selection.build.images.find((i) => i.role === "app")?.sha256 ?? "",
            chipMac: board.chip.mac ?? null,
            startedAt: new Date().toISOString(),
          });
        }
        await d.write(writes, (written, total) => dispatch({ type: "PROGRESS", written, total }));
        if (disconnected.current) throw new DisconnectedError();
        dispatch({ type: "WRITTEN" });
        phase = "verifying-flash";
        for (const w of writes) {
          const got = (await d.md5(w.offset, w.data.length)).toLowerCase();
          if (got !== md5Hex(w.data)) throw new Error(`flash at 0x${w.offset.toString(16)} does not match (md5 ${got})`);
        }
        clearPending();
        dispatch({ type: "FLASH_VERIFIED" });
        phase = "rebooting";
        unlisten.current?.();
        unlisten.current = null;
        await d.reboot();
        setLog(d.log());
        await closeDriver();
        dispatch({ type: "REBOOTED" });
      } catch (err) {
        fail(err, phase);
        await closeDriver();
      }
    },
    [closeDriver, fail, planFor, selection, state.decision, state.phase],
  );

  /** Must run from a click (WebUSB device chooser). */
  const connectKey = useCallback(async () => {
    const b = selection?.build;
    if (b?.image === "openpgp") {
      // The OpenPGP image has no MKAUTH/WebUSB interface to read the identity or rename: first use happens in GnuPG.
      notDetected();
      return;
    }
    const connector = createKeyConnector();
    const wantsName = config.name.mode !== "keep";
    if (!b || !connector.supported()) {
      notDetected();
      if (wantsName) keyName.fail("name-transport-unavailable", "WebUSB is not available");
      return;
    }
    await keyName.reset();
    keyName.set(wantsName ? { status: "connecting", applied: null } : { status: "kept", applied: null });
    let conn: KeyConnection;
    try {
      conn = await connector.connect(b.usb.vid, b.usb.pid);
      const info = await conn.identity();
      if (state.decision?.mode.startsWith("app-")) {
        // Compare what the key reports now with what it reported before the write (read-only, before any rename).
        await new Promise((r) => setTimeout(r, TIMING.settleMs));
        const after = await readKeySnapshot(conn, TIMING.restartAttempts, TIMING.pauseMs).catch(() => null);
        setReport(buildReport(baseline, after, { version: b.version, appSha256: b.images.find((i) => i.role === "app")?.sha256 ?? "" }));
      }
      dispatch({ type: "DEVICE_DETECTED", info });
    } catch {
      notDetected();
      if (wantsName) keyName.fail("name-transport-unavailable", "the key could not be opened");
      return;
    }
    if (!wantsName) {
      await conn.close().catch(() => {});
      return;
    }
    if (b.legacy || b.image !== "fido") {
      // Schema-1 releases (v0.2.0) predate renaming; their images are not guaranteed to support it.
      keyName.fail("name-rename-disabled", "this release predates renaming");
      await conn.close().catch(() => {});
      return;
    }
    await keyName.apply(conn, config.name, b.usb.product_name);
  }, [baseline, config.name, keyName, notDetected, selection, state.decision]);

  const applyName = useCallback(() => connectKey(), [connectKey]);
  const skipCheck = useCallback(() => notDetected(), [notDetected]);
  const retry = useCallback(() => dispatch({ type: "RETRY" }), [dispatch]);
  const cancel = useCallback(async () => {
    dispatch({ type: "CANCEL" });
    if (state.phase !== "flashing" && state.phase !== "verifying-flash") await closeDriver();
  }, [closeDriver, dispatch, state.phase]);
  const reset = useCallback(async () => {
    await closeDriver();
    await keyName.reset();
    setSelection(null);
    setBaseline(null);
    setReport(null);
    boardRef.current = null;
    dispatch({ type: "RESET" });
  }, [closeDriver, keyName]);

  /** From the review: pick another release or family. Nothing was written; the connection is closed. */
  const changeFirmware = useCallback(async () => {
    await closeDriver();
    setSelection(null);
    boardRef.current = null;
    dispatch({ type: "CHANGE_FIRMWARE" });
  }, [closeDriver]);

  /** Forgets an interrupted-write record that cannot be used (older format, other chip or release, or too old). */
  const discardPending = useCallback(async () => {
    clearPending();
    await changeFirmware();
  }, [changeFirmware]);

  /** Must run from a click (WebUSB device chooser). Optional: reads the running key (read-only) to compare after the write. */
  const readBaseline = useCallback(async (): Promise<boolean> => {
    const connector = createKeyConnector();
    if (!connector.supported()) return false;
    let conn: KeyConnection;
    try {
      const [vid, pid] = policy.native_usb.app;
      conn = await connector.connect(vid, pid);
    } catch {
      return false;
    }
    try {
      setBaseline(await readKeySnapshot(conn));
      return true;
    } catch {
      return false;
    } finally {
      await conn.close().catch(() => {});
    }
  }, []);
  const clearBaseline = useCallback(() => setBaseline(null), []);

  return {
    state,
    catalog,
    loadCatalog,
    defaultRelease: catalog.status === "ready" ? defaultRelease(catalog.catalog) : null,
    config,
    selection,
    name: keyName.name,
    log,
    baseline,
    report,
    actions: {
      begin,
      setRelease,
      setImage,
      setNameRequest,
      selectFirmware,
      back,
      choosePort,
      confirm,
      connectKey,
      submitPin: keyName.submitPin,
      applyName,
      skipCheck,
      retry,
      cancel,
      reset,
      changeFirmware,
      discardPending,
      readBaseline,
      clearBaseline,
    },
  };
}
