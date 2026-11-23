// Reads what firmware a connected key runs (MKAUTH INS 07). Read-only: no button, no PIN.
import { FirmwareError } from "../errors/firmware-error";
import type { KeyConnection } from "./key-connector";
import { type BuildInfo, buildInfoApdu, parseBuildInfo, selectApdu, splitSw } from "./mkauth";
import { NoAnswerError } from "./webccid";

/** The key answers, but its firmware was built before the BUILD_INFO command existed (status 6D00). */
export class BuildInfoUnsupportedError extends Error {
  constructor() {
    super("this firmware predates BUILD_INFO (MKAUTH INS 07)");
    this.name = "BuildInfoUnsupportedError";
  }
}

const READ_TIMEOUT_MS = 4000;
const ATTEMPTS = 3;
const PAUSE_MS = 300;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function once(conn: KeyConnection): Promise<BuildInfo> {
  const sel = splitSw(await conn.transmit(selectApdu(), READ_TIMEOUT_MS));
  if (sel.sw !== 0x9000) throw new FirmwareError("name-failed", `MKAUTH SELECT answered ${sel.sw.toString(16)}`);
  const r = splitSw(await conn.transmit(buildInfoApdu(), READ_TIMEOUT_MS));
  if (r.sw === 0x6d00) throw new BuildInfoUnsupportedError();
  if (r.sw !== 0x9000) throw new FirmwareError("name-failed", `BUILD_INFO answered ${r.sw.toString(16)}`);
  return parseBuildInfo(r.data);
}

/**
 * A key that has just been plugged in or has restarted its USB connection can drop the first command (the computer's
 * smart-card stack probes the same applet at that moment), so an unanswered read is repeated on a fresh claim.
 */
export async function readBuildInfo(conn: KeyConnection): Promise<BuildInfo> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await once(conn);
    } catch (e) {
      if (!(e instanceof NoAnswerError) || attempt >= ATTEMPTS) throw e;
      await sleep(PAUSE_MS);
    }
  }
}
