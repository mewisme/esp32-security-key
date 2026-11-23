import { describe, expect, it } from "vitest";
import { parsePartitionTable } from "@/lib/flashing/partition-table";
import type { ManifestPartition } from "@/lib/firmware/types";
import vectorsJson from "../../../tests/vectors/partition_tables.json" with { type: "json" };
import { PARTITIONS, partitionTable } from "../fixtures/firmware";

interface Vectors {
  pad_to: number;
  flash_size: string;
  layout: ManifestPartition[];
  cases: { id: string; why: string; table_hex: string; pad: boolean; status: string; exact?: boolean }[];
}

// The same file is judged by tools/flash_dev.py in tests/flash/test_partition_vectors.py.
const vectors = vectorsJson as Vectors;

describe("shared partition table vectors", () => {
  for (const c of vectors.cases) {
    it(`${c.id}: ${c.why}`, () => {
      const bytes = Uint8Array.from(c.table_hex.match(/../g) ?? [], (h) => parseInt(h, 16));
      const blob = c.pad ? Uint8Array.from({ length: vectors.pad_to }, (_, i) => bytes[i] ?? 0xff) : bytes;
      const r = parsePartitionTable(blob, vectors.layout, undefined, vectors.flash_size);
      expect(r.status, r.detail).toBe(c.status);
      if (c.exact !== undefined) {
        expect(r.exact, r.layoutDetail).toBe(c.exact);
        expect(r.layoutDetail === undefined).toBe(c.exact);
      }
    });
  }
});

// Same vectors as tests/flash/test_flash_dev.py (DeviceTable).
describe("parsePartitionTable", () => {
  it("blank", () => {
    expect(parsePartitionTable(new Uint8Array(0xc00).fill(0xff), PARTITIONS).status).toBe("blank");
  });

  it("match", () => {
    expect(parsePartitionTable(partitionTable(), PARTITIONS).status).toBe("match");
  });

  it("part0 moved -> mismatch", () => {
    const r = parsePartitionTable(partitionTable({ part0Offset: 0x300000 }), PARTITIONS);
    expect(r.status).toBe("mismatch");
    expect(r.detail).toMatch(/part0/);
  });

  it("garbage", () => {
    const g = new Uint8Array(256 * 12).map((_, i) => i % 256);
    expect(parsePartitionTable(g, PARTITIONS).status).toBe("garbage");
  });

  it("unterminated -> garbage", () => {
    expect(parsePartitionTable(partitionTable({ terminated: false }), PARTITIONS).status).toBe("garbage");
  });

  it("empty read -> garbage", () => {
    expect(parsePartitionTable(new Uint8Array(0), PARTITIONS).status).toBe("garbage");
  });

  it("part0 with the wrong type -> mismatch", () => {
    expect(parsePartitionTable(partitionTable({ part0Type: 0x01 }), PARTITIONS).status).toBe("mismatch");
  });
});
