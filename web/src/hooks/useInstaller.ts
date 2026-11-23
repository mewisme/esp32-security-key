// Drives the installer state machine: performs the device, network and flash side effects in order and feeds the
// reducer. Every write happens only in `confirm`, which the reducer gates on all required acknowledgements. Choices made
// before connecting (release, device name) live in `config`, which survives Back/Continue and reloads of the tab.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { selectProfile, type Support } from "@/lib/compatibility/profiles";
import { createKeyConnector } from "@/lib/device/create-key-connector";
import type { KeyConnection } from "@/lib/device/key-connector";
import type { NameRequest } from "@/lib/device/mkauth";
import type { NameState } from "@/lib/device/personalize";
import { useKeyName } from "@/hooks/useKeyName";
import { classifyError, DisconnectedError } from "@/lib/errors/classify";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { type Catalog, type CatalogRelease, defaultRelease, fetchCatalog } from "@/lib/firmware/catalog";
import { type DownloadedImage, downloadBuild } from "@/lib/firmware/download";
import { validateManifest } from "@/lib/firmware/manifest";
import { APP_DESC_IMAGE_OFFSET, type HardwareProfile, policy } from "@/lib/firmware/policy";
import type { Build } from "@/lib/firmware/types";
import { parseAppDescriptor } from "@/lib/flashing/app-descriptor";
import { createDriver } from "@/lib/flashing/create-driver";
import type { FlashDriver, PortInfo } from "@/lib/flashing/driver";
import { md5Hex } from "@/lib/flashing/md5";
import { type AckId, decideInstallMode } from "@/lib/flashing/install-mode";
import { flashReducer, initialState, type FlashState, type Phase } from "@/lib/flashing/machine";
import { parsePartitionTable } from "@/lib/flashing/partition-table";
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
  /** Label of the tested hardware this board matches (only when support is hardware-verified). */
  verifiedAs: string | null;
}

export interface InstallerActions {
  /** Stage 1 -> 2: checks the browser, then continues. Safe to call again after Back. */
  begin(): void;
  setRelease(tag: string): void;
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
  actions: InstallerActions;
}

export function useInstaller(): Installer {
  const [state, dispatch] = useReducer(flashReducer, initialState);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [config, setConfig] = useState<InstallerConfig>(loadConfig);
  const [selection, setSelection] = useState<Selection | null>(null);
  const keyName = useKeyName();
  const [log, setLog] = useState<string[]>([]);
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

  const setRelease = useCallback((tag: string) => setConfig((c) => ({ ...c, tag })), []);
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
      const picked = selectProfile(chip, release.manifest.builds, state.image);
      if (!picked.ok) throw new FirmwareError(picked.code, picked.detail);
      const b = picked.build;
      setSelection({ release, build: b, profile: picked.profile, support: picked.support, verifiedAs: picked.verifiedAs });
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
      const tableBlob = await d.readFlash(policy.partition_table.offset, policy.partition_table.read_length);
      const appBlob = await d.readFlash(policy.app_descriptor.offset - APP_DESC_IMAGE_OFFSET, policy.app_descriptor.read_length);
      const decision = decideInstallMode({
        table: parsePartitionTable(tableBlob, b.partitions),
        app: parseAppDescriptor(appBlob),
        build: b,
        untestedHardware: picked.support !== "hardware-verified",
      });
      setLog(d.log());
      dispatch({ type: "SAFETY_DECIDED", decision });
      if (!decision.allowed) await closeDriver();
    } catch (err) {
      fail(err, phase);
      await closeDriver();
    }
  }, [closeDriver, fail, releaseFor, state.image, state.tag]);

  const confirm = useCallback(async (acks: AckId[]) => {
    const d = driver.current;
    const decision = state.decision;
    if (!d || !decision || state.phase !== "awaiting-confirmation" || !decision.acks.every((a) => acks.includes(a))) return;
    dispatch({ type: "CONFIRMED", acks });
    let phase: Phase = "flashing";
    try {
      const byOffset = new Map(images.current.map((i) => [i.offset, i.data]));
      const writes = decision.writes.map((w) => {
        const data = w.kind === "fill" ? new Uint8Array(w.length).fill(0xff) : byOffset.get(w.offset);
        if (!data || data.length !== w.length) throw new FirmwareError("manifest-invalid", `no verified data for ${w.role}`);
        return { offset: w.offset, data };
      });
      await d.write(writes, (written, total) => dispatch({ type: "PROGRESS", written, total }));
      if (disconnected.current) throw new DisconnectedError();
      dispatch({ type: "WRITTEN" });
      phase = "verifying-flash";
      for (const w of writes) {
        const got = (await d.md5(w.offset, w.data.length)).toLowerCase();
        if (got !== md5Hex(w.data)) throw new Error(`flash at 0x${w.offset.toString(16)} does not match (md5 ${got})`);
      }
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
  }, [closeDriver, dispatch, fail, state.decision, state.phase]);

  /** Must run from a click (WebUSB device chooser). */
  const connectKey = useCallback(async () => {
    const b = selection?.build;
    const connector = createKeyConnector();
    const wantsName = config.name.mode !== "keep";
    if (!b || !connector.supported()) {
      dispatch({ type: "DEVICE_NOT_DETECTED" });
      if (wantsName) keyName.fail("name-transport-unavailable", "WebUSB is not available");
      return;
    }
    await keyName.reset();
    keyName.set(wantsName ? { status: "connecting", applied: null } : { status: "kept", applied: null });
    let conn: KeyConnection;
    try {
      conn = await connector.connect(b.usb.vid, b.usb.pid);
      dispatch({ type: "DEVICE_DETECTED", info: await conn.identity() });
    } catch {
      dispatch({ type: "DEVICE_NOT_DETECTED" });
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
  }, [config.name, keyName, selection]);

  const applyName = useCallback(() => connectKey(), [connectKey]);
  const skipCheck = useCallback(() => dispatch({ type: "DEVICE_NOT_DETECTED" }), [dispatch]);
  const retry = useCallback(() => dispatch({ type: "RETRY" }), [dispatch]);
  const cancel = useCallback(async () => {
    dispatch({ type: "CANCEL" });
    if (state.phase !== "flashing" && state.phase !== "verifying-flash") await closeDriver();
  }, [closeDriver, dispatch, state.phase]);
  const reset = useCallback(async () => {
    await closeDriver();
    await keyName.reset();
    setSelection(null);
    dispatch({ type: "RESET" });
  }, [closeDriver, keyName]);

  return {
    state,
    catalog,
    loadCatalog,
    defaultRelease: catalog.status === "ready" ? defaultRelease(catalog.catalog) : null,
    config,
    selection,
    name: keyName.name,
    log,
    actions: {
      begin,
      setRelease,
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
    },
  };
}
