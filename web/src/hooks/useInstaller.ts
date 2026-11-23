// Drives the installer state machine: performs the device, network and flash side effects in order and feeds the
// reducer. Every write happens only in `confirm`, which the reducer gates on all required acknowledgements.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createUsbChecker } from "@/lib/device/create-usb-checker";
import { classifyError, DisconnectedError } from "@/lib/errors/classify";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { type Catalog, type CatalogRelease, defaultRelease, fetchCatalog } from "@/lib/firmware/catalog";
import { type DownloadedImage, downloadBuild } from "@/lib/firmware/download";
import { validateManifest } from "@/lib/firmware/manifest";
import { APP_DESC_IMAGE_OFFSET, policy } from "@/lib/firmware/policy";
import type { Build } from "@/lib/firmware/types";
import { parseAppDescriptor } from "@/lib/flashing/app-descriptor";
import { createDriver } from "@/lib/flashing/create-driver";
import type { FlashDriver, PortInfo } from "@/lib/flashing/driver";
import { md5Hex } from "@/lib/flashing/md5";
import { type AckId, decideInstallMode } from "@/lib/flashing/install-mode";
import { flashReducer, initialState, type FlashState, type Phase } from "@/lib/flashing/machine";
import { parsePartitionTable } from "@/lib/flashing/partition-table";

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

export interface Selection {
  release: CatalogRelease;
  build: Build;
}

export interface InstallerActions {
  start(): void;
  confirmHardware(boardId: string): void;
  selectFirmware(release: CatalogRelease, build: Build): void;
  choosePort(): Promise<void>;
  confirm(acks: AckId[]): Promise<void>;
  checkKey(): Promise<void>;
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
  selection: Selection | null;
  log: string[];
  actions: InstallerActions;
}

export function useInstaller(): Installer {
  const [state, dispatch] = useReducer(flashReducer, initialState);
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [log, setLog] = useState<string[]>([]);
  const driver = useRef<FlashDriver | null>(null);
  const images = useRef<DownloadedImage[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const disconnected = useRef(false);
  const unlisten = useRef<(() => void) | null>(null);

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

  const start = useCallback(() => {
    dispatch({ type: "START" });
    const problem = browserProblem();
    dispatch(problem ? { type: "BROWSER_UNSUPPORTED", code: problem } : { type: "BROWSER_OK" });
  }, [dispatch]);

  const confirmHardware = useCallback((boardId: string) => dispatch({ type: "HARDWARE_CONFIRMED", boardId }), [dispatch]);

  const selectFirmware = useCallback((r: CatalogRelease, b: Build) => {
    setSelection({ release: r, build: b });
    dispatch({ type: "FIRMWARE_SELECTED", tag: r.tag, buildId: b.id });
  }, []);

  /** Must run from a click: the browser only opens the device chooser in response to a user gesture. */
  const choosePort = useCallback(async () => {
    if (!selection) return;
    const { release: r, build: b } = selection;
    let phase: Phase = "requesting-permission";
    await closeDriver();
    const d = createDriver();
    driver.current = d;
    disconnected.current = false;
    images.current = [];
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
      if (chip.chipName !== policy.chip) throw new FirmwareError("unsupported-chip", `chip is ${chip.chipName}`);
      if (chip.secureDownloadMode) throw new FirmwareError("secure-download-mode", "secure download mode is enabled");
      if (chip.flashSize !== policy.flash_size) throw new FirmwareError("wrong-flash-size", `flash size is ${chip.flashSize ?? "unknown"}`);
      dispatch({ type: "COMPATIBLE" });
      phase = "fetching-metadata";
      validateManifest(r.manifest, r.tag);
      dispatch({ type: "MANIFEST_READY" });
      phase = "downloading";
      const imgs = await downloadBuild(r.tag, b, (received, total) => dispatch({ type: "DOWNLOAD_PROGRESS", received, total }));
      dispatch({ type: "DOWNLOADED" });
      phase = "verifying-integrity";
      images.current = imgs;
      dispatch({ type: "INTEGRITY_OK" });
      phase = "checking-flash-safety";
      const tableBlob = await d.readFlash(policy.partition_table.offset, policy.partition_table.read_length);
      const appBlob = await d.readFlash(policy.app_descriptor.offset - APP_DESC_IMAGE_OFFSET, policy.app_descriptor.read_length);
      const decision = decideInstallMode({ table: parsePartitionTable(tableBlob, b.partitions), app: parseAppDescriptor(appBlob), build: b });
      setLog(d.log());
      dispatch({ type: "SAFETY_DECIDED", decision });
      if (!decision.allowed) await closeDriver();
    } catch (err) {
      fail(err, phase);
      await closeDriver();
    }
  }, [closeDriver, fail, selection]);

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
  const checkKey = useCallback(async () => {
    const b = selection?.build;
    const checker = createUsbChecker();
    if (!b || !checker.supported()) {
      dispatch({ type: "DEVICE_NOT_DETECTED" });
      return;
    }
    try {
      dispatch({ type: "DEVICE_DETECTED", info: await checker.check(b.usb.vid, b.usb.pid) });
    } catch {
      dispatch({ type: "DEVICE_NOT_DETECTED" });
    }
  }, [selection]);

  const skipCheck = useCallback(() => dispatch({ type: "DEVICE_NOT_DETECTED" }), [dispatch]);
  const retry = useCallback(() => dispatch({ type: "RETRY" }), [dispatch]);
  const cancel = useCallback(async () => {
    dispatch({ type: "CANCEL" });
    if (state.phase !== "flashing" && state.phase !== "verifying-flash") await closeDriver();
  }, [closeDriver, dispatch, state.phase]);
  const reset = useCallback(async () => {
    await closeDriver();
    dispatch({ type: "RESET" });
  }, [closeDriver, dispatch]);

  return {
    state,
    catalog,
    loadCatalog,
    defaultRelease: catalog.status === "ready" ? defaultRelease(catalog.catalog) : null,
    selection,
    log,
    actions: { start, confirmHardware, selectFirmware, choosePort, confirm, checkKey, skipCheck, retry, cancel, reset },
  };
}
