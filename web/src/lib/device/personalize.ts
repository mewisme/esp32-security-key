// Applies a NameRequest to a connected key through MKAUTH INS 06 and verifies the result. The PIN exists only as the `pin`
// argument; it is never stored or logged.
import type { ErrorCode } from "../errors/catalog";
import { FirmwareError } from "../errors/firmware-error";
import type { KeyConnection } from "./key-connector";
import { getInfoApdu, nameClearApdu, nameGetApdu, nameSetApdu, type NameRequest, parseDeviceName, parseInfo, selectApdu, splitSw, swToNameError } from "./mkauth";
import { NoAnswerError } from "./webccid";

export type NameStatus = "idle" | "connecting" | "needs-pin" | "press-button" | "reconnecting" | "verified" | "kept" | "unverified" | "failed";

export interface NameOutcome {
  status: NameStatus;
  name: string | null;
  error?: ErrorCode;
  detail?: string;
  triesLeft?: number;
}

/** What the UI shows about a rename: the latest status, why it failed, and the verified product name once applied. */
export interface NameState {
  status: NameStatus;
  error?: ErrorCode;
  detail?: string;
  triesLeft?: number;
  applied: string | null;
}

/**
 * How patiently the page waits for a key that is slow to answer. A key that has just restarted its USB connection is
 * probed by the computer's own smart-card stack at the same moment, and the firmware serves one interface at a time, so
 * the first command on the management interface can be dropped (seen on Windows: a SELECT sent 1 ms after the key came
 * back was never answered, one sent a second later was answered in 10 ms). Reads wait, then repeat on a fresh claim.
 */
export interface Timing {
  /** Pause after the key came back, before the first read. */
  settleMs: number;
  /** Reads before the write (repeated only when the key does not answer). */
  initialAttempts: number;
  /** Reads after the key restarted (also repeated while the interface cannot be claimed yet). */
  restartAttempts: number;
  /** Time one read (SELECT, then GET) may take. */
  readTimeoutMs: number;
  pauseMs: number;
}

export const TIMING: Timing = { settleMs: 1000, initialAttempts: 3, restartAttempts: 6, readTimeoutMs: 2000, pauseMs: 300 };

const COMMAND_TIMEOUT_MS = 5000;
const WRITE_TIMEOUT_MS = 25000;
const REENUM_TIMEOUT_MS = 10000;

function failed(error: ErrorCode, detail: string, extra: Partial<NameOutcome> = {}): NameOutcome {
  return { status: "failed", name: null, error, detail, ...extra };
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

async function send(conn: KeyConnection, apdu: Uint8Array, timeoutMs: number) {
  return splitSw(await conn.transmit(apdu, timeoutMs));
}

/** The interface could not be (re)claimed yet: the device object is stale or Windows has not bound the driver again. */
function notReady(e: unknown): boolean {
  if (e instanceof FirmwareError) return e.code === "name-transport-unavailable";
  return typeof DOMException !== "undefined" && e instanceof DOMException && ["NotFoundError", "NetworkError", "InvalidStateError"].includes(e.name);
}

/** SELECT, then GET name; throws FirmwareError("name-failed") on a failing status word. */
async function readName(conn: KeyConnection, timeoutMs: number) {
  const sel = await send(conn, selectApdu(), timeoutMs);
  if (sel.sw !== 0x9000) throw new FirmwareError("name-failed", `SELECT status ${sel.sw.toString(16)}`);
  const got = await send(conn, nameGetApdu(), timeoutMs);
  if (got.sw !== 0x9000) throw new FirmwareError(swToNameError(got.sw), `GET name status ${got.sw.toString(16)}`);
  return parseDeviceName(got.data);
}

/** `readName`, repeated while the key does not answer (and, after a restart, while the interface is not ready). */
async function readNameRetrying(conn: KeyConnection, attempts: number, t: Timing, afterRestart: boolean) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await readName(conn, t.readTimeoutMs);
    } catch (e) {
      if (!(e instanceof NoAnswerError) && !(afterRestart && notReady(e))) throw e;
      last = e;
      await sleep(t.pauseMs);
    }
  }
  throw last;
}

export async function applyNameRequest(
  conn: KeyConnection,
  req: NameRequest,
  defaultName: string,
  pin: string | null,
  on: (s: NameStatus) => void,
  timing: Timing = TIMING,
): Promise<NameOutcome> {
  if (req.mode === "keep") return { status: "kept", name: null };
  try {
    on("connecting");
    const current = await readNameRetrying(conn, timing.initialAttempts, timing, false);
    if (!current.renameSupported) return failed("name-rename-disabled", "firmware built without renaming");
    const target = req.mode === "custom" ? req.name : defaultName;
    const wantCustom = req.mode === "custom";
    if (current.name === target && current.custom === wantCustom) return { status: "verified", name: target };

    const info = await send(conn, getInfoApdu(), COMMAND_TIMEOUT_MS);
    if (info.sw !== 0x9000) throw new FirmwareError("name-failed", `GET_INFO status ${info.sw.toString(16)}`);
    const { enrolled } = parseInfo(info.data);
    if (enrolled && pin === null) return { status: "needs-pin", name: null };

    const pinBytes = pin === null ? new Uint8Array(0) : new TextEncoder().encode(pin);
    const apdu = wantCustom ? nameSetApdu(pinBytes, target, true) : nameClearApdu(pinBytes, true);
    on("press-button");
    // `answered` stays false when the key said nothing at all; its own "button not pressed" is the status word 6300.
    let answered = false;
    try {
      const wrote = await send(conn, apdu, WRITE_TIMEOUT_MS);
      if (wrote.sw !== 0x9000) {
        const code = swToNameError(wrote.sw);
        return failed(code, `status ${wrote.sw.toString(16)}`, code === "name-pin-wrong" ? { triesLeft: wrote.sw & 0x0f } : {});
      }
      answered = true;
    } catch (e) {
      if (!(e instanceof NoAnswerError)) throw e;
    }

    on("reconnecting");
    if (answered) {
      try {
        await conn.waitForReenumeration(REENUM_TIMEOUT_MS);
      } catch (e) {
        if (e instanceof FirmwareError && e.code === "name-not-verified") return { status: "unverified", name: target, error: e.code, detail: e.detail };
        throw e;
      }
    }

    // Read back what the key reports now: after a restart, or, when it never answered the write, to learn whether the
    // name changed anyway.
    on("connecting");
    await sleep(timing.settleMs);
    let after;
    try {
      after = await readNameRetrying(conn, timing.restartAttempts, timing, true);
    } catch (e) {
      if (!(e instanceof NoAnswerError) && !notReady(e)) throw e;
      const detail = e instanceof Error ? e.message : String(e);
      // The key took the name (or its answer was lost) but never answered afterwards: say it is not confirmed.
      return answered ? { status: "unverified", name: target, error: "name-not-verified", detail } : failed("name-transport-unavailable", detail);
    }
    const seen = (await conn.identity()).productName;
    if (after.name === target && after.custom === wantCustom && !after.reenumerationPending && seen === target) return { status: "verified", name: target };
    if (!answered && after.name !== target) return failed("name-transport-unavailable", `the key never answered the write and still reports ${JSON.stringify(after.name)}`);
    return { status: "unverified", name: target, error: "name-not-verified", detail: `key reports ${JSON.stringify(seen)}` };
  } catch (e) {
    if (e instanceof FirmwareError) return failed(e.code, e.detail);
    return failed("name-failed", e instanceof Error ? e.message : String(e));
  }
}
