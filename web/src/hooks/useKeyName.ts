// Applies a requested USB name to a connected key and tracks the outcome for the UI. Shared by the installer's Finish
// stage and the First use page. The management PIN is passed straight through to the key: it is never stored or logged.
import { useCallback, useRef, useState } from "react";
import type { KeyConnection } from "@/lib/device/key-connector";
import type { NameRequest } from "@/lib/device/mkauth";
import { applyNameRequest, type NameState } from "@/lib/device/personalize";
import type { ErrorCode } from "@/lib/errors/catalog";

export const IDLE_NAME: NameState = { status: "idle", applied: null };

interface Pending {
  conn: KeyConnection;
  request: NameRequest;
  defaultName: string;
}

export interface KeyName {
  name: NameState;
  /**
   * Applies `request` over `conn`. A missing or wrong management PIN leaves the connection open (state `needs-pin`) so
   * `submitPin` can continue; every other outcome closes it.
   */
  apply(conn: KeyConnection, request: NameRequest, defaultName: string, pin?: string | null): Promise<void>;
  submitPin(pin: string): Promise<void>;
  /** Records a failure that happened before a connection existed. */
  fail(error: ErrorCode, detail: string): void;
  /** `kept` for "don't change the name", otherwise back to idle. */
  set(state: NameState): void;
  /** Forgets the outcome and closes a connection kept open for a PIN. */
  reset(): Promise<void>;
}

export function useKeyName(): KeyName {
  const [name, setName] = useState<NameState>(IDLE_NAME);
  const pending = useRef<Pending | null>(null);

  const drop = useCallback(async () => {
    const p = pending.current;
    pending.current = null;
    if (p) await p.conn.close().catch(() => {});
  }, []);

  const apply = useCallback(
    async (conn: KeyConnection, request: NameRequest, defaultName: string, pin: string | null = null) => {
      const out = await applyNameRequest(conn, request, defaultName, pin, (status) =>
        setName((n) => ({ ...n, status, error: undefined, detail: undefined })),
      );
      if (out.status === "needs-pin" || out.error === "name-pin-wrong") {
        pending.current = { conn, request, defaultName };
        setName({ status: "needs-pin", error: out.error, detail: out.detail, triesLeft: out.triesLeft, applied: null });
        return;
      }
      pending.current = null;
      setName({ status: out.status, error: out.error, detail: out.detail, triesLeft: out.triesLeft, applied: out.status === "verified" ? out.name : null });
      await conn.close().catch(() => {});
    },
    [],
  );

  const submitPin = useCallback(
    async (pin: string) => {
      const p = pending.current;
      if (!p) {
        setName({ status: "failed", error: "name-transport-unavailable", detail: "the connection to the key was closed", applied: null });
        return;
      }
      await apply(p.conn, p.request, p.defaultName, pin);
    },
    [apply],
  );

  const fail = useCallback((error: ErrorCode, detail: string) => setName({ status: "failed", error, detail, applied: null }), []);
  const set = useCallback((state: NameState) => setName(state), []);
  const reset = useCallback(async () => {
    await drop();
    setName(IDLE_NAME);
  }, [drop]);

  return { name, apply, submitPin, fail, set, reset };
}
