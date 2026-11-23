import { describe, expect, it } from "vitest";
import { parsePartitionTable } from "@/lib/flashing/partition-table";
import { PARTITIONS, partitionTable } from "../fixtures/firmware";

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
    const t = partitionTable();
    t[3 * 32 + 2] = 0x01;
    expect(parsePartitionTable(t, PARTITIONS).status).toBe("mismatch");
  });
});
