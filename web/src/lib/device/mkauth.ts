// MKAUTH v1 APDUs and parsers, a byte-exact port of host/multikey-proto/src/lib.rs (docs/PROTOCOLS.md). Pure: no I/O.
import type { ErrorCode } from "../errors/catalog";
import { validateDeviceName } from "./device-name";

export type NameRequest = { mode: "keep" } | { mode: "default" } | { mode: "custom"; name: string };

const AID = [0xf0, 0x4d, 0x4b, 0x41, 0x55, 0x54, 0x48, 0x01];
const CLA = 0x80;
const INS_GET_INFO = 0x01;
const INS_DEVICE_NAME = 0x06;
const NAME_GET = 0x00;
const NAME_SET = 0x01;
const NAME_CLEAR = 0x02;
const NAME_MAX = 31;
const PIN_MIN = 6;
const PIN_MAX = 63;
const DEVICE_ID_LEN = 16;
const PUBKEY_LEN = 65;

export function selectApdu(): Uint8Array {
  return Uint8Array.from([0x00, 0xa4, 0x04, 0x00, AID.length, ...AID]);
}

export function getInfoApdu(): Uint8Array {
  return Uint8Array.from([CLA, INS_GET_INFO, 0, 0, 0x00]);
}

export function nameGetApdu(): Uint8Array {
  return Uint8Array.from([CLA, INS_DEVICE_NAME, NAME_GET, 0, 0x00]);
}

function nameApdu(p1: number, reenumerate: boolean, pin: Uint8Array, name: Uint8Array): Uint8Array {
  if (pin.length !== 0 && (pin.length < PIN_MIN || pin.length > PIN_MAX)) {
    throw new Error(`PIN must be ${PIN_MIN}..${PIN_MAX} bytes, got ${pin.length}`);
  }
  return Uint8Array.from([CLA, INS_DEVICE_NAME, p1, reenumerate ? 1 : 0, 1 + pin.length + name.length, pin.length, ...pin, ...name, 0x00]);
}

/** `80 06 01 P2 Lc pin_len PIN name 00`; `pin` is empty while the device is not enrolled. */
export function nameSetApdu(pin: Uint8Array, name: string, reenumerate: boolean): Uint8Array {
  const problem = validateDeviceName(name);
  if (problem) throw new Error(`invalid device name: ${problem}`);
  return nameApdu(NAME_SET, reenumerate, pin, new TextEncoder().encode(name));
}

/** `80 06 02 P2 Lc pin_len PIN 00`: restore the default name. */
export function nameClearApdu(pin: Uint8Array, reenumerate: boolean): Uint8Array {
  return nameApdu(NAME_CLEAR, reenumerate, pin, new Uint8Array(0));
}

export function parseInfo(data: Uint8Array): { enrolled: boolean; deviceId: Uint8Array } {
  if (data.length < 3 + DEVICE_ID_LEN) throw new Error(`bad info length ${data.length}`);
  if (data[0] !== 0x01) throw new Error(`unsupported MKAUTH version ${data[0]}`);
  const state = data[1];
  if (state !== 0 && state !== 1) throw new Error(`bad MKAUTH state ${state}`);
  const enrolled = state === 1;
  if (data.length !== 3 + DEVICE_ID_LEN + (enrolled ? PUBKEY_LEN : 0)) throw new Error(`bad info length ${data.length}`);
  return { enrolled, deviceId: data.slice(3, 3 + DEVICE_ID_LEN) };
}

export function parseDeviceName(data: Uint8Array): { custom: boolean; reenumerationPending: boolean; renameSupported: boolean; name: string } {
  const flags = data[0] ?? 0;
  if (data.length < 2 || data.length > 1 + NAME_MAX || (flags & ~0x07) !== 0) throw new Error(`bad device name response length ${data.length}`);
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(1));
  } catch {
    throw new Error("device name response is not UTF-8");
  }
  return { custom: (flags & 1) !== 0, reenumerationPending: (flags & 2) !== 0, renameSupported: (flags & 4) !== 0, name };
}

export function splitSw(resp: Uint8Array): { data: Uint8Array; sw: number } {
  if (resp.length < 2) throw new Error("response has no status word");
  const n = resp.length;
  return { data: resp.slice(0, n - 2), sw: ((resp[n - 2] ?? 0) << 8) | (resp[n - 1] ?? 0) };
}

export function swToNameError(sw: number): ErrorCode {
  if (sw === 0x6985) return "name-rename-disabled";
  if (sw === 0x6300) return "name-button-timeout";
  if ((sw & 0xfff0) === 0x63c0) return "name-pin-wrong";
  if (sw === 0x6983) return "name-pin-blocked";
  return "name-failed";
}
