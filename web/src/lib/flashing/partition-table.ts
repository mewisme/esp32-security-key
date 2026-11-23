// TypeScript port of tools/flash_dev.py:parse_device_table. Keep the two in step (same test vectors).
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
}

type Entry = TableEntry;

const hex = (n: number) => `0x${n.toString(16)}`;

function u32(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

export function parsePartitionTable(blob: Uint8Array, partitions: ManifestPartition[], p: FlashPolicy = defaultPolicy): TableResult {
  if (!blob.length) return { status: "garbage", detail: "no data read" };
  if (blob.every((x) => x === 0xff)) return { status: "blank", detail: "flash is blank, nothing to preserve" };
  const entries = new Map<string, Entry>();
  let pos = 0;
  let sawEnd = false;
  while (pos + 32 <= blob.length) {
    const e = blob.subarray(pos, pos + 32);
    pos += 32;
    if (e[0] === 0xaa && e[1] === 0x50) {
      const labelBytes = e.subarray(12, 28);
      const nul = labelBytes.indexOf(0);
      const label = new TextDecoder("ascii").decode(nul < 0 ? labelBytes : labelBytes.subarray(0, nul));
      entries.set(label, { type: e[2]!, subtype: e[3]!, offset: u32(e, 4), size: u32(e, 8) });
    } else if ((e[0] === 0xeb && e[1] === 0xeb) || e.every((x) => x === 0xff)) {
      sawEnd = true;
      break;
    } else {
      return { status: "garbage", detail: `unrecognised entry at table offset ${hex(pos - 32)}` };
    }
  }
  if (!entries.size || !sawEnd) return { status: "garbage", detail: "partition table is not terminated or empty" };
  const want = new Map(partitions.map((x) => [x.name, x]));
  for (const name of p.protected_partitions) {
    const w = want.get(name);
    const g = entries.get(name);
    if (!w) return { status: "mismatch", detail: `the firmware layout has no ${name}` };
    if (!g) return { status: "mismatch", detail: `device table has no ${name} partition` };
    if (g.offset !== w.offset || g.size !== w.size) {
      return {
        status: "mismatch",
        detail: `${name} on the device is [${hex(g.offset)}, size ${hex(g.size)}] but this firmware expects [${hex(w.offset)}, size ${hex(w.size)}]`,
      };
    }
  }
  const c = p.credential_partition;
  const cred = entries.get(c.name)!;
  if (cred.type !== c.type || cred.subtype !== c.subtype) {
    return { status: "mismatch", detail: `${c.name} on the device has an unexpected type/subtype` };
  }
  return { status: "match", detail: "device partition table matches this firmware", entries };
}
