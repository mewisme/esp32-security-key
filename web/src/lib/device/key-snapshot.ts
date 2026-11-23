// What a running key tells the page before and after an application-only update. Read-only: no button, no PIN, no write.
import { FirmwareError } from "../errors/firmware-error";
import type { KeyConnection } from "./key-connector";
import { type BuildInfo, buildInfoApdu, getInfoApdu, nameGetApdu, parseBuildInfo, parseDeviceName, parseInfo, selectApdu, splitSw } from "./mkauth";
import { NoAnswerError } from "./webccid";

export interface KeySnapshot {
  /** The firmware's own report; null when it could not be read. */
  build: BuildInfo | null;
  /** The firmware answered but predates BUILD_INFO (v0.3.1 added it). */
  buildOutdated: boolean;
  /** Current USB product name (custom or default), null when it could not be read. */
  name: string | null;
  /** MKAUTH enrollment state, null when it could not be read. */
  enrolled: boolean | null;
  /** 16-byte MKAUTH device id, lowercase hex, null when it could not be read. */
  deviceId: string | null;
}

const TIMEOUT_MS = 4000;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

async function send(conn: KeyConnection, apdu: Uint8Array) {
  return splitSw(await conn.transmit(apdu, TIMEOUT_MS));
}

/** A field that cannot be read stays null; a key that does not answer at all is rethrown so the caller can repeat. */
async function field<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof NoAnswerError) throw e;
    return null;
  }
}

async function once(conn: KeyConnection): Promise<KeySnapshot> {
  const sel = await send(conn, selectApdu());
  if (sel.sw !== 0x9000) throw new FirmwareError("name-failed", `MKAUTH SELECT answered ${sel.sw.toString(16)}`);
  let buildOutdated = false;
  const build = await field(async () => {
    const r = await send(conn, buildInfoApdu());
    if (r.sw === 0x6d00) {
      buildOutdated = true;
      return null;
    }
    return r.sw === 0x9000 ? parseBuildInfo(r.data) : null;
  });
  const info = await field(async () => {
    const r = await send(conn, getInfoApdu());
    return r.sw === 0x9000 ? parseInfo(r.data) : null;
  });
  const name = await field(async () => {
    const r = await send(conn, nameGetApdu());
    return r.sw === 0x9000 ? parseDeviceName(r.data).name : null;
  });
  return { build, buildOutdated, name, enrolled: info?.enrolled ?? null, deviceId: info ? hex(info.deviceId) : null };
}

/**
 * A key that has just been plugged in can drop the first command (the computer's own smart-card stack probes the same
 * applet), so a read that gets no answer is repeated on a fresh claim, `attempts` times in all.
 */
export async function readKeySnapshot(conn: KeyConnection, attempts = 3, pauseMs = 300): Promise<KeySnapshot> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await once(conn);
    } catch (e) {
      if (attempt >= attempts) throw e;
      if (!(e instanceof NoAnswerError)) throw e;
      await sleep(pauseMs);
    }
  }
}
