// e2e-only KeyConnector (FakeKeyConnector), swapped in by vite.config.ts in --mode e2e. An in-memory MKAUTH applet that
// decodes the real APDUs; the scenario comes from localStorage["multikeys-e2e-scenario"] (see scenario.ts).
import type { KeyConnection, KeyConnector } from "@/lib/device/key-connector";
import { validateDeviceName } from "@/lib/device/device-name";
import { getInfoApdu, nameGetApdu, selectApdu } from "@/lib/device/mkauth";
import { FirmwareError } from "@/lib/errors/firmware-error";
import { readScenario } from "./scenario";

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

async function handle(apdu: Uint8Array): Promise<Uint8Array> {
  const k = readScenario().key ?? {};
  const s = keyState();
  if (same(apdu, selectApdu())) return sw([...new TextEncoder().encode("MKAUTH 1")], 0x9000);
  if (same(apdu, getInfoApdu())) {
    const info = [0x01, k.enrolledPin !== undefined ? 1 : 0, 0, ...new Array<number>(16).fill(0xab)];
    if (k.enrolledPin !== undefined) info.push(...new Array<number>(65).fill(0x04));
    return sw(info, 0x9000);
  }
  if (same(apdu, nameGetApdu())) {
    const flags = (s.custom ? 1 : 0) | (s.name !== s.enumerated ? 2 : 0) | (k.renameSupported === false ? 0 : 4);
    return sw([flags, ...new TextEncoder().encode(s.name)], 0x9000);
  }
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
    const s = keyState();
    s.enumerated = s.name;
  }

  async close() {}
}

export class FakeKeyConnector implements KeyConnector {
  supported() {
    return true;
  }

  async connect(): Promise<KeyConnection> {
    return new FakeKeyConnection();
  }
}

export function createKeyConnector(): KeyConnector {
  return new FakeKeyConnector();
}
