// MKAUTH v1 APDUs and parsers, a byte-exact port of host/multikey-proto/src/lib.rs (docs/PROTOCOLS.md). Pure: no I/O.
import type { ErrorCode } from "../errors/catalog";
import { validateDeviceName } from "./device-name";

export type NameRequest = { mode: "keep" } | { mode: "default" } | { mode: "custom"; name: string };

const AID = [0xf0, 0x4d, 0x4b, 0x41, 0x55, 0x54, 0x48, 0x01];
const CLA = 0x80;
const INS_GET_INFO = 0x01;
const INS_DEVICE_NAME = 0x06;
const INS_BUILD_INFO = 0x07;
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

/** `80 07 00 00 00`: read what the firmware is (no button, no PIN). */
export function buildInfoApdu(): Uint8Array {
  return Uint8Array.from([CLA, INS_BUILD_INFO, 0, 0, 0x00]);
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

/** What the running firmware reports about itself (MKAUTH INS 07). A field is absent when the firmware did not send it. */
export interface BuildInfo {
  project?: string;
  version?: string;
  idfVersion?: string;
  /** 12 hex digits, `+dirty` when tracked files were modified at build time, or `unknown`. */
  commit?: string;
  /** Lowercase hex SHA-256 of the app image as flashed: equals `images[role=app].sha256` of a release manifest. */
  imageSha256?: string;
  elfSha256?: string;
  /** Flash size the image was built for, e.g. `16MB`. */
  flashBuiltFor?: string;
  /** Flash size the chip reports, in bytes. */
  flashChipBytes?: number;
  flashEncryption?: boolean;
  secureBoot?: boolean;
  /** `esp_chip_model_t`. */
  chipModel?: number;
  /** Full chip revision, `major * 100 + minor`. */
  chipRevision?: number;
  chipCores?: number;
  /** `esp_reset_reason_t` of this boot. */
  resetReason?: number;
  uptimeSeconds?: number;
  partitionOffset?: number;
  partitionLabel?: string;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Parses a BUILD_INFO response: `fmt(1)=01`, then `tag | len | value` entries. Text is accepted only as printable ASCII,
 * so nothing a device sends can inject control characters into the page; unknown tags are skipped.
 */
export function parseBuildInfo(data: Uint8Array): BuildInfo {
  if (data.length === 0) throw new Error("empty build info response");
  if (data[0] !== 0x01) throw new Error(`unsupported build info format ${data[0]}`);
  const info: BuildInfo = {};
  const seen = new Set<number>();
  const text = (v: Uint8Array) => {
    if (!v.every((c) => c >= 0x20 && c <= 0x7e)) throw new Error("build info text is not printable ASCII");
    return new TextDecoder().decode(v);
  };
  const exact = (v: Uint8Array, n: number) => {
    if (v.length !== n) throw new Error("build info entry has the wrong length");
  };
  const be32 = (v: Uint8Array) => ((v[0] ?? 0) * 0x1000000 + ((v[1] ?? 0) << 16) + ((v[2] ?? 0) << 8) + (v[3] ?? 0)) >>> 0;
  let rest = data.subarray(1);
  while (rest.length > 0) {
    if (rest.length < 2) throw new Error("truncated build info entry");
    const tag = rest[0] as number;
    const len = rest[1] as number;
    if (rest.length < 2 + len) throw new Error("truncated build info entry");
    const v = rest.subarray(2, 2 + len);
    rest = rest.subarray(2 + len);
    if (seen.has(tag)) throw new Error("repeated build info entry");
    seen.add(tag);
    switch (tag) {
      case 0x01:
        info.project = text(v);
        break;
      case 0x02:
        info.version = text(v);
        break;
      case 0x03:
        info.idfVersion = text(v);
        break;
      case 0x04:
        info.commit = text(v);
        break;
      case 0x05:
        exact(v, 32);
        info.imageSha256 = hex(v);
        break;
      case 0x06:
        exact(v, 32);
        info.elfSha256 = hex(v);
        break;
      case 0x07:
        info.flashBuiltFor = text(v);
        break;
      case 0x08:
        exact(v, 4);
        info.flashChipBytes = be32(v);
        break;
      case 0x09:
        exact(v, 1);
        info.flashEncryption = ((v[0] as number) & 0x01) !== 0;
        info.secureBoot = ((v[0] as number) & 0x02) !== 0;
        break;
      case 0x0a:
        exact(v, 4);
        info.chipModel = v[0] as number;
        info.chipRevision = ((v[1] as number) << 8) | (v[2] as number);
        info.chipCores = v[3] as number;
        break;
      case 0x0b:
        exact(v, 1);
        info.resetReason = v[0] as number;
        break;
      case 0x0c:
        exact(v, 4);
        info.uptimeSeconds = be32(v);
        break;
      case 0x0d:
        if (v.length < 4) throw new Error("build info entry has the wrong length");
        info.partitionOffset = be32(v);
        info.partitionLabel = text(v.subarray(4));
        break;
      default:
        break; // a tag from a newer firmware
    }
  }
  return info;
}

const CHIP_MODELS: Record<number, string> = { 1: "ESP32", 2: "ESP32-S2", 5: "ESP32-C3", 9: "ESP32-S3", 12: "ESP32-C2", 13: "ESP32-C6", 16: "ESP32-H2", 18: "ESP32-P4" };

/** Name of an `esp_chip_model_t` value. */
export function chipModelName(model: number): string | null {
  return CHIP_MODELS[model] ?? null;
}

const RESET_REASONS: Record<number, string> = {
  0: "unknown",
  1: "power-on",
  2: "external pin",
  3: "software restart",
  4: "panic",
  5: "interrupt watchdog",
  6: "task watchdog",
  7: "other watchdog",
  8: "deep sleep wake-up",
  9: "brownout",
  10: "SDIO",
  11: "USB",
  12: "JTAG",
  13: "eFuse error",
  14: "power glitch",
  15: "CPU lock-up",
};

/** Name of an `esp_reset_reason_t` value. */
export function resetReasonName(reason: number): string | null {
  return RESET_REASONS[reason] ?? null;
}
