/**
 * STOCK-DASH pure helpers: bilty duplicate-check mode normalisation
 * and FIFO stock-ageing buckets. No DB, no imports beyond the helper.
 */
import { describe, expect, it } from "vitest";
import {
  ageingBucket,
  fifoAgeing,
  normalizeBiltyMode,
} from "@/lib/stock-helpers";
import { callAtomicStockTransition, type RpcCapable } from "@/lib/atomic";

describe("normalizeBiltyMode", () => {
  it("absent / null / unknown resolves to warn (the brief's default)", () => {
    expect(normalizeBiltyMode(null)).toBe("warn");
    expect(normalizeBiltyMode(undefined)).toBe("warn");
    expect(normalizeBiltyMode("")).toBe("warn");
    expect(normalizeBiltyMode("something-else")).toBe("warn");
    expect(normalizeBiltyMode({})).toBe("warn");
  });
  it("passes block and off through, case-insensitively", () => {
    expect(normalizeBiltyMode("block")).toBe("block");
    expect(normalizeBiltyMode("BLOCK")).toBe("block");
    expect(normalizeBiltyMode("off")).toBe("off");
    expect(normalizeBiltyMode({ mode: "block" })).toBe("block");
    expect(normalizeBiltyMode({ value: "off" })).toBe("off");
  });
  it("warn stays warn", () => {
    expect(normalizeBiltyMode("warn")).toBe("warn");
  });
});

describe("atomic lot_number (backward compatible)", () => {
  it("passes lot_number through when set, null when omitted", async () => {
    const seen: Record<string, unknown>[] = [];
    const client: RpcCapable = {
      rpc: async (_fn, args) => {
        seen.push(args);
        return { data: { outcome: "transitioned", status: "posted", voucher: {} }, error: null };
      },
    };
    const base = {
      voucherTable: "incoming_goods" as const, voucherId: "v1", fromStatuses: ["draft"],
      toStatus: "posted", voucherType: "inward", voucherNo: "INW-1", entryKind: "post" as const,
      createdBy: "u1",
    };
    await callAtomicStockTransition(client, {
      ...base,
      lines: [{ lineNo: 0, godownId: "g1", productId: "p1", partyId: null, inwardQty: 10, outwardQty: 0, lotNumber: "LOT-9" }],
    });
    await callAtomicStockTransition(client, {
      ...base,
      lines: [{ lineNo: 0, godownId: "g1", productId: "p1", partyId: null, inwardQty: 10, outwardQty: 0 }],
    });
    const lines0 = (seen[0].p_lines as { lot_number: string | null }[]);
    const lines1 = (seen[1].p_lines as { lot_number: string | null }[]);
    expect(lines0[0].lot_number).toBe("LOT-9");
    expect(lines1[0].lot_number).toBeNull();
  });
});

describe("ageingBucket edges", () => {
  it("30 -> 0-30, 31 -> 31-60, 60 -> 31-60, 61 -> 61-90, 90 -> 61-90, 91 -> 90+", () => {
    expect(ageingBucket(0)).toBe("0-30");
    expect(ageingBucket(30)).toBe("0-30");
    expect(ageingBucket(31)).toBe("31-60");
    expect(ageingBucket(60)).toBe("31-60");
    expect(ageingBucket(61)).toBe("61-90");
    expect(ageingBucket(90)).toBe("61-90");
    expect(ageingBucket(91)).toBe("90+");
    expect(ageingBucket(400)).toBe("90+");
  });
});

describe("fifoAgeing", () => {
  it("consumes oldest lots first and buckets the remainder", () => {
    const pools = fifoAgeing(
      [
        { godown_id: "g1", product_id: "p1", party_id: null, date: "2026-01-01T00:00:00Z", inward_qty: 100, outward_qty: 0 },
        { godown_id: "g1", product_id: "p1", party_id: null, date: "2026-10-20T00:00:00Z", inward_qty: 50, outward_qty: 0 },
        { godown_id: "g1", product_id: "p1", party_id: null, date: "2026-10-27T00:00:00Z", inward_qty: 0, outward_qty: 80 },
      ],
      "2026-10-27",
    );
    expect(pools).toHaveLength(1);
    // 100 (Jan) - 80 consumed = 20 left in 90+; 50 (Oct 20, 7 days) in 0-30.
    expect(pools[0].buckets).toEqual({ "0-30": 50, "31-60": 0, "61-90": 0, "90+": 20 });
    expect(pools[0].total_kg).toBe(70);
  });
  it("floors a pool at zero when outward exceeds inward history", () => {
    const pools = fifoAgeing(
      [{ godown_id: "g1", product_id: "p1", party_id: null, date: "2026-10-01T00:00:00Z", inward_qty: 10, outward_qty: 40 }],
      "2026-10-27",
    );
    expect(pools).toHaveLength(0);
  });
  it("ignores rows dated after the as-of date and keeps pools separate", () => {
    const pools = fifoAgeing(
      [
        { godown_id: "g1", product_id: "p1", party_id: null, date: "2026-10-01T00:00:00Z", inward_qty: 10, outward_qty: 0 },
        { godown_id: "g1", product_id: "p1", party_id: null, date: "2026-12-01T00:00:00Z", inward_qty: 99, outward_qty: 0 },
        { godown_id: "g2", product_id: "p1", party_id: null, date: "2026-10-01T00:00:00Z", inward_qty: 5, outward_qty: 0 },
      ],
      "2026-10-27",
    );
    expect(pools).toHaveLength(2);
    expect(pools.find((p) => p.godown_id === "g1")?.total_kg).toBe(10);
  });
});
