// State of the "Your key" page: one connection to the key (chosen by the user in the browser's device list), the firmware
// build it reports, and the passkey activity it pushes. Everything here is read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createKeyConnector } from "@/lib/device/create-key-connector";
import { BuildInfoUnsupportedError, readBuildInfo } from "@/lib/device/device-info";
import type { KeyConnection } from "@/lib/device/key-connector";
import type { KeyEvent } from "@/lib/device/key-events";
import type { BuildInfo } from "@/lib/device/mkauth";
import { policy } from "@/lib/firmware/policy";
import type { DeviceCheck } from "@/lib/flashing/machine";

export type ConnectState = { status: "idle" } | { status: "connecting" } | { status: "not-chosen" } | { status: "connected"; identity: DeviceCheck | null };

export type BuildState = { status: "idle" } | { status: "reading" } | { status: "ok"; info: BuildInfo } | { status: "outdated" } | { status: "failed"; detail: string };

export interface FeedItem {
  id: number;
  event: KeyEvent;
  /** The key had queued it before this page listened; when it happened is unknown. */
  backlog: boolean;
  /** Browser clock when the page received it (meaningful for live events only). */
  receivedAt: number;
}

export type WatchState = "idle" | "watching" | "stopped";

const FEED_LIMIT = 200;

export interface KeyDevice {
  supported: boolean;
  connect: ConnectState;
  build: BuildState;
  feed: FeedItem[];
  watch: WatchState;
  /** Must run from a click: the browser asks the user to choose the key. */
  connectKey(): Promise<void>;
  readAgain(): Promise<void>;
  startWatching(): void;
  stopWatching(): void;
  disconnect(): Promise<void>;
}

export function useKeyDevice(): KeyDevice {
  const connector = useMemo(() => createKeyConnector(), []);
  const [connect, setConnect] = useState<ConnectState>({ status: "idle" });
  const [build, setBuild] = useState<BuildState>({ status: "idle" });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [watch, setWatch] = useState<WatchState>("idle");
  const conn = useRef<KeyConnection | null>(null);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  const stopWatching = useCallback(() => abort.current?.abort(), []);

  const read = useCallback(async () => {
    const c = conn.current;
    if (!c) return;
    setBuild({ status: "reading" });
    try {
      setBuild({ status: "ok", info: await readBuildInfo(c) });
    } catch (e) {
      setBuild(e instanceof BuildInfoUnsupportedError ? { status: "outdated" } : { status: "failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const connectKey = useCallback(async () => {
    setConnect({ status: "connecting" });
    let c: KeyConnection;
    try {
      const [vid, pid] = policy.native_usb.app;
      c = await connector.connect(vid, pid);
    } catch {
      setConnect({ status: "not-chosen" });
      return;
    }
    conn.current = c;
    setFeed([]);
    setWatch("idle");
    setConnect({ status: "connected", identity: await c.identity().catch(() => null) });
    await read();
  }, [connector, read]);

  const readAgain = useCallback(async () => {
    // The management session cannot send commands while it listens for events.
    abort.current?.abort();
    await read();
  }, [read]);

  const startWatching = useCallback(() => {
    const c = conn.current;
    if (!c || abort.current) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setWatch("watching");
    c.watchEvents(
      (event, backlog) =>
        setFeed((f) => [...f, { id: nextId.current++, event, backlog, receivedAt: Date.now() }].slice(-FEED_LIMIT)),
      ctl.signal,
    )
      .then(() => setWatch("idle"))
      .catch(() => setWatch("stopped"))
      .finally(() => {
        if (abort.current === ctl) abort.current = null;
      });
  }, []);

  const disconnect = useCallback(async () => {
    abort.current?.abort();
    const c = conn.current;
    conn.current = null;
    await c?.close().catch(() => {});
    setConnect({ status: "idle" });
    setBuild({ status: "idle" });
    setFeed([]);
    setWatch("idle");
  }, []);

  useEffect(
    () => () => {
      abort.current?.abort();
      void conn.current?.close().catch(() => {});
    },
    [],
  );

  return { supported: connector.supported(), connect, build, feed, watch, connectKey, readAgain, startWatching, stopWatching, disconnect };
}
