// TypeScript port of tools/flash_dev.py:parse_device_table. Keep the two in step: tests/vectors/partition_tables.json is
// run by both (web/tests/unit/partition-table.test.ts and tests/flash/test_partition_vectors.py).
//
// Two different questions are answered separately:
//   * protectedCompatible: the protected partitions (nvs, phy_init, part0) are where this firmware expects them, so
//     a full install may rewrite everything else and the stored data stays addressable ("match").
//   * matchesLayoutExactly: the device table equals the firmware layout entry for entry (names, type, subtype,
//     offset, size, nothing extra). Only this lets the application-only update write into the existing layout.
// A table that is not well formed (bad entry, wrong checksum, duplicate names, overlaps, entries outside the flash,
// data after the end marker) is "garbage": nothing is decided from it.
import { md5Hex } from "./md5";
import { type FlashPolicy, policy as defaultPolicy } from "../firmware/policy";
import type { ManifestPartition } from "../firmware/types";

export type TableStatus = "blank" | "match" | "mismatch" | "garbage";

export interface TableEntry {
  type: number;
  subtype: number;
  offset: number;
  size: number;
}

export interface TableResult {
  status: TableStatus;
  detail: string;
  /** Every entry of the device table; present only when `status` is "match". */
  entries?: ReadonlyMap<string, TableEntry>;
  /** Present when `status` is "match": the device table equals the firmware layout entry for entry. */
  exact?: boolean;
  /** Present when `status` is "match" and `exact` is false: the first difference from the firmware layout. */
  layoutDetail?: string;
}

const TABLE_SECTOR = 0x1000;
const ENTRY = 32;

const hex = (n: number) => `0x${n.toString(16)}`;

function u32(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

const allFf = (b: Uint8Array) => b.every((x) => x === 0xff);

/** Flash size in bytes for "4MB" / "8MB" / "16MB"; null for anything else. */
function flashBytes(size: string | null): number | null {
  const m = size === null ? null : /^(\d+)MB$/.exec(size);
  return m ? Number(m[1]) * 1024 * 1024 : null;
}

// ESP-IDF partition type and subtype names (components/partition_table/gen_esp32part.py) that the layouts here may use.
const TYPE_CODES: Record<string, number> = { app: 0x00, data: 0x01 };
const SUBTYPE_CODES: Record<string, Record<string, number>> = {
  app: { factory: 0x00, test: 0x20 },
  data: { ota: 0x00, phy: 0x01, nvs: 0x02, coredump: 0x03, nvs_keys: 0x04, efuse: 0x05, undefined: 0x06 },
};

/** A partitions.csv type or subtype as the number stored in the table, or null when it is a name this code does not know. */
function code(value: string, names: Record<string, number> | undefined): number | null {
  if (/^(0x[0-9a-f]+|\d+)$/i.test(value)) return Number(value);
  return names?.[value] ?? null;
}

/** Null when the device table equals the firmware layout entry for entry, otherwise the first difference. */
export function matchesLayoutExactly(entries: ReadonlyMap<string, TableEntry>, partitions: ManifestPartition[]): string | null {
  for (const w of partitions) {
    const g = entries.get(w.name);
    if (!g) return `the device table has no ${w.name} partition`;
    const type = code(w.type, TYPE_CODES);
    const subtype = type === null ? null : code(w.subtype, SUBTYPE_CODES[w.type]);
    if (type === null || subtype === null) return `${w.name} has a type this check cannot compare (${w.type}/${w.subtype})`;
    if (g.type !== type || g.subtype !== subtype) return `${w.name} on the device has another type or subtype than this firmware`;
    if (g.offset !== w.offset || g.size !== w.size) {
      return `${w.name} on the device is [${hex(g.offset)}, size ${hex(g.size)}] but this firmware expects [${hex(w.offset)}, size ${hex(w.size)}]`;
    }
  }
  const known = new Set(partitions.map((x) => x.name));
  for (const name of entries.keys()) if (!known.has(name)) return `the device table has a partition this firmware does not define (${name})`;
  return null;
}

/** Null when every protected partition is where this firmware expects it (and part0 has its type), otherwise a mismatch detail. */
export function protectedCompatible(entries: ReadonlyMap<string, TableEntry>, partitions: ManifestPartition[], p: FlashPolicy): string | null {
  const want = new Map(partitions.map((x) => [x.name, x]));
  for (const name of p.protected_partitions) {
    const w = want.get(name);
    const g = entries.get(name);
    if (!w) return `the firmware layout has no ${name}`;
    if (!g) return `device table has no ${name} partition`;
    if (g.offset !== w.offset || g.size !== w.size) {
      return `${name} on the device is [${hex(g.offset)}, size ${hex(g.size)}] but this firmware expects [${hex(w.offset)}, size ${hex(w.size)}]`;
    }
  }
  const c = p.credential_partition;
  const cred = entries.get(c.name);
  if (!cred || cred.type !== c.type || cred.subtype !== c.subtype) return `${c.name} on the device has an unexpected type/subtype`;
  return null;
}

/** Why the entries cannot be a valid table, or null. */
function structureProblem(entries: ReadonlyMap<string, TableEntry>, p: FlashPolicy, flashSize: string | null): string | null {
  const first = p.partition_table.offset + TABLE_SECTOR;
  const limit = flashBytes(flashSize) ?? 0x1_0000_0000;
  for (const [name, e] of entries) {
    if (e.size === 0) return `${name} has size 0`;
    if (e.offset < first) return `${name} starts inside the bootloader or the partition table (${hex(e.offset)})`;
    if (e.offset + e.size > limit) return `${name} ends at ${hex(e.offset + e.size)}, beyond the flash`;
  }
  const byOffset = [...entries].sort((a, b) => a[1].offset - b[1].offset);
  for (let i = 1; i < byOffset.length; i++) {
    const [an, a] = byOffset[i - 1]!;
    const [bn, b] = byOffset[i]!;
    if (a.offset + a.size > b.offset) return `${an} overlaps ${bn}`;
  }
  return null;
}

export function parsePartitionTable(
  blob: Uint8Array,
  partitions: ManifestPartition[],
  p: FlashPolicy = defaultPolicy,
  /** The flash size of the build ("16MB"); entries beyond it make the table unusable. */
  flashSize: string | null = null,
): TableResult {
  if (!blob.length) return { status: "garbage", detail: "no data read" };
  if (allFf(blob)) return { status: "blank", detail: "flash is blank, nothing to preserve" };
  const entries = new Map<string, TableEntry>();
  let pos = 0;
  let sawEnd = false;
  while (pos + ENTRY <= blob.length) {
    const e = blob.subarray(pos, pos + ENTRY);
    pos += ENTRY;
    if (e[0] === 0xaa && e[1] === 0x50) {
      const labelBytes = e.subarray(12, 28);
      const nul = labelBytes.indexOf(0);
      const label = new TextDecoder("ascii").decode(nul < 0 ? labelBytes : labelBytes.subarray(0, nul));
      if (entries.has(label)) return { status: "garbage", detail: `the partition name ${label} appears twice` };
      entries.set(label, { type: e[2]!, subtype: e[3]!, offset: u32(e, 4), size: u32(e, 8) });
    } else if (e[0] === 0xeb && e[1] === 0xeb) {
      // ESP-IDF's checksum entry: the MD5 of every entry before it.
      const stored = Array.from(e.subarray(16, 32), (b) => b.toString(16).padStart(2, "0")).join("");
      if (stored !== md5Hex(blob.subarray(0, pos - ENTRY))) return { status: "garbage", detail: "the partition table checksum does not match its entries" };
      sawEnd = true;
      break;
    } else if (allFf(e)) {
      sawEnd = true;
      break;
    } else {
      return { status: "garbage", detail: `unrecognised entry at table offset ${hex(pos - ENTRY)}` };
    }
  }
  if (!entries.size || !sawEnd) return { status: "garbage", detail: "partition table is not terminated or empty" };
  if (!allFf(blob.subarray(pos))) return { status: "garbage", detail: "there is data after the end of the partition table" };
  const bad = structureProblem(entries, p, flashSize);
  if (bad) return { status: "garbage", detail: bad };
  const mismatch = protectedCompatible(entries, partitions, p);
  if (mismatch) return { status: "mismatch", detail: mismatch };
  const difference = matchesLayoutExactly(entries, partitions);
  return {
    status: "match",
    detail: difference === null ? "device partition table matches this firmware" : "the protected partitions match, but the layout is not identical to this firmware",
    entries,
    exact: difference === null,
    ...(difference === null ? {} : { layoutDetail: difference }),
  };
}
