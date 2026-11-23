// e2e-only KeyConnector (FakeKeyConnector), swapped in by vite.config.ts in --mode e2e. An in-memory MKAUTH applet that
// decodes the real APDUs; the scenario comes from localStorage["multikeys-e2e-scenario"] (see scenario.ts).
import type { KeyConnection, KeyConnector } from "@/lib/device/key-connector";
import { validateDeviceName } from "@/lib/device/device-name";
import { getInfoApdu, buildInfoApdu, nameGetApdu, selectApdu } from "@/lib/device/mkauth";
import { type KeyEvent, parseKeyEvent } from "@/lib/device/key-events";
import { NoAnswerError } from "@/lib/device/webccid";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { readScenario, type ScriptedEvent } from "./scenario";

const OP_CODE = { "make-credential": 1, "get-assertion": 2, "user-presence": 3 } as const;
const RESULT_CODE = { pending: 0, ok: 1, error: 2 } as const;

/** A key event payload exactly as pico-fido's event_send lays it out. */
function encodeEvent(e: ScriptedEvent): Uint8Array {
  const text = new TextEncoder();
  const fields: number[] = [];
  const add = (tag: number, value: ArrayLike<number>) => fields.push(tag, value.length, ...Array.from(value));
  if (e.rpId !== undefined) add(1, text.encode(e.rpId));
  if (e.userName !== undefined) add(2, text.encode(e.userName));
  if (e.userDisplayName !== undefined) add(3, text.encode(e.userDisplayName));
  if (e.algorithm !== undefined) add(4, [(e.algorithm >>> 24) & 0xff, (e.algorithm >>> 16) & 0xff, (e.algorithm >>> 8) & 0xff, e.algorithm & 0xff]);
  if (e.authFlags !== undefined) add(5, [e.authFlags]);
  if (e.error !== undefined) add(6, [e.error]);
  if (e.credentialCount !== undefined) add(7, [e.credentialCount]);
  if (e.operation !== undefined) add(8, [OP_CODE[e.operation]]);
  return Uint8Array.from([OP_CODE[e.op], RESULT_CODE[e.result], 3 + fields.length, ...fields]);
}

/** A BUILD_INFO response (without the status word) as the firmware lays it out. */
function encodeBuildInfo(b: NonNullable<NonNullable<ReturnType<typeof readScenario>["key"]>["build"]>): number[] {
  const text = new TextEncoder();
  const out: number[] = [0x01];
  const add = (tag: number, value: ArrayLike<number>) => out.push(tag, value.length, ...Array.from(value));
  const hex = (h: string) => Array.from({ length: h.length / 2 }, (_, i) => Number.parseInt(h.slice(2 * i, 2 * i + 2), 16));
  add(0x01, text.encode("multikey-fido"));
  add(0x02, text.encode(b.version ?? "0.2.0"));
  add(0x03, text.encode("v5.5.6"));
  add(0x04, text.encode(b.commit ?? "281fae077113"));
  add(0x05, hex(b.imageSha256 ?? "ab".repeat(32)));
  add(0x06, hex("cd".repeat(32)));
  add(0x07, text.encode("16MB"));
  add(0x08, [0x01, 0x00, 0x00, 0x00]);
  add(0x09, [(b.flashEncryption ? 1 : 0) | (b.secureBoot ? 2 : 0)]);
  add(0x0a, [0x09, 0x00, 0x00, 0x02]);
  add(0x0b, [0x01]);
  add(0x0c, [0x00, 0x00, 0x01, 0x2c]);
  add(0x0d, [0x00, 0x02, 0x00, 0x00, ...text.encode("factory")]);
  return out;
}

declare global {
  interface Window {
    __keyWrites?: { op: "set" | "clear"; name?: string }[];
  }
}

const DEFAULT_NAME = "MultiKeys Security Key";
const SERIAL = "e2e-0001";

interface KeyState {
  name: string;
  custom: boolean;
  /** Stored name differs from the enumerated one until the next re-enumeration. */
  enumerated: string;
  tries: number;
}

// Module-level: survives connect() calls within one page load. Initialised lazily from the scenario.
let state: KeyState | null = null;

function keyState(): KeyState {
  if (!state) {
    const k = readScenario().key ?? {};
    const name = k.name ?? DEFAULT_NAME;
    state = { name, custom: k.custom ?? false, enumerated: name, tries: 8 };
  }
  return state;
}

const sw = (data: number[], code: number) => Uint8Array.from([...data, code >> 8, code & 0xff]);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Commands left to drop after the simulated restart (scenario key.silentAfterRestart).
let silent = 0;

/** The key re-enumerated: the host now sees the stored name, and the first reads may go unanswered. */
function restart() {
  const s = keyState();
  s.enumerated = s.name;
  silent = readScenario().key?.silentAfterRestart ?? 0;
}

async function handle(apdu: Uint8Array): Promise<Uint8Array> {
  const k = readScenario().key ?? {};
  const s = keyState();
  if (same(apdu, selectApdu())) {
    if (silent > 0) {
      silent -= 1;
      throw new NoAnswerError("the simulated key dropped the command");
    }
    return sw([...new TextEncoder().encode("MKAUTH 1")], 0x9000);
  }
  if (same(apdu, getInfoApdu())) {
    const info = [0x01, k.enrolledPin !== undefined ? 1 : 0, 0, ...new Array<number>(16).fill(0xab)];
    if (k.enrolledPin !== undefined) info.push(...new Array<number>(65).fill(0x04));
    return sw(info, 0x9000);
  }
  if (same(apdu, nameGetApdu())) {
    const flags = (s.custom ? 1 : 0) | (s.name !== s.enumerated ? 2 : 0) | (k.renameSupported === false ? 0 : 4);
    return sw([flags, ...new TextEncoder().encode(s.name)], 0x9000);
  }
  if (same(apdu, buildInfoApdu())) return k.build ? sw(encodeBuildInfo(k.build), 0x9000) : sw([], 0x6d00);
  if (apdu[0] !== 0x80 || apdu[1] !== 0x06 || (apdu[2] !== 1 && apdu[2] !== 2)) return sw([], 0x6d00);
  if (k.renameSupported === false) return sw([], 0x6985);
  const lc = apdu[4] ?? 0;
  const pinLen = apdu[5] ?? 0;
  const pin = apdu.slice(6, 6 + pinLen);
  const name = apdu.slice(6 + pinLen, 5 + lc);
  if (k.enrolledPin !== undefined) {
    if (s.tries === 0) return sw([], 0x6983);
    if (new TextDecoder().decode(pin) !== k.enrolledPin) {
      s.tries -= 1;
      return sw([], s.tries === 0 ? 0x6983 : 0x63c0 | s.tries);
    }
    s.tries = 8;
  } else if (pinLen !== 0) return sw([], 0x6a80);
  if ((k.button ?? "press") === "timeout") {
    await sleep(300);
    return sw([], 0x6300);
  }
  await sleep(150);
  window.__keyWrites ??= [];
  if (apdu[2] === 1) {
    const text = new TextDecoder().decode(name);
    if (validateDeviceName(text) !== null) return sw([], 0x6a80);
    s.name = text;
    s.custom = true;
    window.__keyWrites.push({ op: "set", name: text });
  } else {
    s.name = DEFAULT_NAME;
    s.custom = false;
    window.__keyWrites.push({ op: "clear" });
  }
  if (k.dropWriteAnswer) {
    restart();
    throw new NoAnswerError("the simulated key's answer was lost");
  }
  return sw([], 0x9000);
}

class FakeKeyConnection implements KeyConnection {
  async identity() {
    if (readScenario().checker === "throw") throw Object.assign(new Error("No device selected."), { name: "NotFoundError" });
    return { productName: keyState().enumerated, manufacturerName: "MultiKeys", serialNumber: SERIAL, landingUrl: "https://multikeys.mewis.me" };
  }

  transmit(apdu: Uint8Array) {
    return handle(apdu);
  }

  async waitForReenumeration(timeoutMs: number) {
    if ((readScenario().key?.reenumerate ?? "ok") === "never") {
      await sleep(Math.min(timeoutMs, 500));
      throw new FirmwareError("name-not-verified", "the simulated key did not come back");
    }
    await sleep(200);
    restart();
  }

  async watchEvents(onEvent: (event: KeyEvent, backlog: boolean) => void, signal: AbortSignal) {
    const events = readScenario().key?.events ?? [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    // The bytes go through the production decoder, exactly as a real key's would.
    const push = (e: ScriptedEvent, backlog: boolean) => onEvent(parseKeyEvent(encodeEvent(e)), backlog);
    for (const e of events.filter((x) => x.queued)) push(e, true);
    for (const e of events.filter((x) => !x.queued)) timers.push(setTimeout(() => push(e, false), e.afterMs));
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    for (const t of timers) clearTimeout(t);
  }

  async close() {}
}

export class FakeKeyConnector implements KeyConnector {
  supported() {
    return true;
  }

  async connect(): Promise<KeyConnection> {
    // The browser's device chooser was dismissed.
    if (readScenario().chooser === "cancel") throw Object.assign(new Error("No device selected."), { name: "NotFoundError" });
    return new FakeKeyConnection();
  }
}

export function createKeyConnector(): KeyConnector {
  return new FakeKeyConnector();
}
