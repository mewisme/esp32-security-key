// TypeScript port of tools/flash_dev.py:parse_app_descriptor.
import { APP_DESC_IMAGE_OFFSET } from "../firmware/policy";

export interface AppDescriptor {
  version: string;
  project_name: string;
  time: string;
  date: string;
  idf_ver: string;
}

const MAGIC = 0xabcd5432;

/** `blob` = at least 256 bytes from the start of an app image (flash read at the app offset). */
export function parseAppDescriptor(blob: Uint8Array): AppDescriptor | null {
  const d = blob.subarray(APP_DESC_IMAGE_OFFSET, APP_DESC_IMAGE_OFFSET + 0xe0);
  if (d.length < 128) return null;
  const magic = (d[0]! | (d[1]! << 8) | (d[2]! << 16) | (d[3]! << 24)) >>> 0;
  if (magic !== MAGIC) return null;
  const cstr = (start: number, length: number) => {
    const s = d.subarray(start, start + length);
    const nul = s.indexOf(0);
    return Array.from(nul < 0 ? s : s.subarray(0, nul), (c) => (c < 0x80 ? String.fromCharCode(c) : "\ufffd")).join("");
  };
  return { version: cstr(16, 32), project_name: cstr(48, 32), time: cstr(80, 16), date: cstr(96, 16), idf_ver: cstr(112, 32) };
}
