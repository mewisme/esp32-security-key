// Applies a NameRequest to a connected key through MKAUTH INS 06 and verifies the result. The PIN exists only as the `pin`
// argument; it is never stored or logged.
import type { ErrorCode } from "../errors/catalog";
import { FirmwareError } from "../errors/firmware-error";
import type { KeyConnection } from "./key-connector";
import { getInfoApdu, nameClearApdu, nameGetApdu, nameSetApdu, type NameRequest, parseDeviceName, parseInfo, selectApdu, splitSw, swToNameError } from "./mkauth";

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

const COMMAND_TIMEOUT_MS = 5000;
const WRITE_TIMEOUT_MS = 25000;
const REENUM_TIMEOUT_MS = 10000;

function failed(error: ErrorCode, detail: string, extra: Partial<NameOutcome> = {}): NameOutcome {
  return { status: "failed", name: null, error, detail, ...extra };
}

async function send(conn: KeyConnection, apdu: Uint8Array, timeoutMs: number) {
  return splitSw(await conn.transmit(apdu, timeoutMs));
}

/** SELECT, then GET name; throws FirmwareError("name-failed") on a failing status word. */
async function readName(conn: KeyConnection) {
  const sel = await send(conn, selectApdu(), COMMAND_TIMEOUT_MS);
  if (sel.sw !== 0x9000) throw new FirmwareError("name-failed", `SELECT status ${sel.sw.toString(16)}`);
  const got = await send(conn, nameGetApdu(), COMMAND_TIMEOUT_MS);
  if (got.sw !== 0x9000) throw new FirmwareError(swToNameError(got.sw), `GET name status ${got.sw.toString(16)}`);
  return parseDeviceName(got.data);
}

export async function applyNameRequest(
  conn: KeyConnection,
  req: NameRequest,
  defaultName: string,
  pin: string | null,
  on: (s: NameStatus) => void,
): Promise<NameOutcome> {
  if (req.mode === "keep") return { status: "kept", name: null };
  try {
    on("connecting");
    const current = await readName(conn);
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
    const wrote = await send(conn, apdu, WRITE_TIMEOUT_MS);
    if (wrote.sw !== 0x9000) {
      const code = swToNameError(wrote.sw);
      return failed(code, `status ${wrote.sw.toString(16)}`, code === "name-pin-wrong" ? { triesLeft: wrote.sw & 0x0f } : {});
    }

    on("reconnecting");
    try {
      await conn.waitForReenumeration(REENUM_TIMEOUT_MS);
    } catch (e) {
      if (e instanceof FirmwareError && e.code === "name-not-verified") return { status: "unverified", name: target, error: e.code, detail: e.detail };
      throw e;
    }

    const after = await readName(conn);
    const seen = (await conn.identity()).productName;
    if (after.name === target && after.custom === wantCustom && !after.reenumerationPending && seen === target) return { status: "verified", name: target };
    return { status: "unverified", name: target, error: "name-not-verified", detail: `key reports ${JSON.stringify(seen)}` };
  } catch (e) {
    if (e instanceof FirmwareError) return failed(e.code, e.detail);
    return failed("name-failed", e instanceof Error ? e.message : String(e));
  }
}
