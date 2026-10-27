/**
 * Exact-once posting helpers (QA blocker B4).
 * Pure logic only: token stability, unique-violation detection, and
 * parsing of the atomic_stock_transition() result. The Postgres
 * function itself cannot run here (no live DB); its SQL is checked
 * structurally (see the Phase D report) and live in the deploy steps.
 */
import { describe, expect, it } from "vitest";
import {
  isUniqueViolation,
  newSubmissionToken,
  postToken,
  resetSubmissionToken,
  submissionToken,
} from "@/lib/idempotency";
import {
  callAtomicStockTransition,
  parseAtomicTransitionResult,
  type RpcCapable,
} from "@/lib/atomic";

describe("postToken (deterministic per-voucher token)", () => {
  it("is stable: same scope + voucher always yields the same token", () => {
    expect(postToken("inward:post", "abc-123")).toBe(
      postToken("inward:post", "abc-123"),
    );
  });

  it("differs per scope and per voucher, so a post token can never replay a reverse", () => {
    expect(postToken("inward:post", "abc-123")).not.toBe(
      postToken("inward:reverse", "abc-123"),
    );
    expect(postToken("inward:post", "abc-123")).not.toBe(
      postToken("inward:post", "def-456"),
    );
  });

  it("contains no timestamp, so a double-click replays instead of duplicating", () => {
    expect(postToken("gatepass:post", "v1")).not.toMatch(/\d{13}/);
  });
});

describe("submissionToken (one token per form submission)", () => {
  it("reuses the token across attempts until reset", () => {
    const ref: { current: string | null } = { current: null };
    const first = submissionToken(ref, "receipt");
    expect(submissionToken(ref, "receipt")).toBe(first);
    expect(first.startsWith("receipt-")).toBe(true);
  });

  it("issues a fresh token after reset, so the next submission is a new document", () => {
    const ref: { current: string | null } = { current: null };
    const first = submissionToken(ref, "receipt");
    resetSubmissionToken(ref);
    const second = submissionToken(ref, "receipt");
    expect(second).not.toBe(first);
  });

  it("newSubmissionToken never repeats across calls", () => {
    expect(newSubmissionToken("expense")).not.toBe(
      newSubmissionToken("expense"),
    );
  });
});

describe("isUniqueViolation", () => {
  it("recognises Postgres 23505 by code", () => {
    expect(isUniqueViolation({ code: "23505", message: "x" })).toBe(true);
  });

  it("recognises 23505 mentioned in the message", () => {
    expect(
      isUniqueViolation({ message: 'duplicate key value violates unique constraint "ux_stock_ledger_identity" (23505)' }),
    ).toBe(true);
  });

  it("rejects other errors, null, and strings", () => {
    expect(isUniqueViolation({ code: "23503", message: "fk" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});

describe("parseAtomicTransitionResult", () => {
  it("accepts all three outcomes with a status", () => {
    for (const outcome of ["transitioned", "already", "invalid"] as const) {
      expect(
        parseAtomicTransitionResult({ outcome, status: "posted", voucher: { id: "1" } }),
      ).toEqual({ outcome, status: "posted", voucher: { id: "1" } });
    }
  });

  it("rejects unknown outcomes, missing status, and non-objects", () => {
    expect(parseAtomicTransitionResult({ outcome: "posted", status: "posted" })).toBe(null);
    expect(parseAtomicTransitionResult({ outcome: "already" })).toBe(null);
    expect(parseAtomicTransitionResult(null)).toBe(null);
    expect(parseAtomicTransitionResult("already")).toBe(null);
  });
});

describe("callAtomicStockTransition", () => {
  const baseArgs = {
    voucherTable: "incoming_goods" as const,
    voucherId: "v-1",
    fromStatuses: ["draft"],
    toStatus: "posted",
    voucherType: "inward",
    voucherNo: "INW-000001",
    entryKind: "post" as const,
    lines: [
      {
        lineNo: 0,
        godownId: "g-1",
        productId: "p-1",
        partyId: null,
        inwardQty: 100,
        outwardQty: 0,
      },
    ],
    createdBy: "u-1",
    clientToken: "inward:post-v-1",
    scope: "inward:post",
  };

  it("passes the voucher, lines, and token through to the rpc", async () => {
    const seen: { current: { fn: string; args: Record<string, unknown> } | null } = {
      current: null,
    };
    const client: RpcCapable = {
      rpc: async (fn, args) => {
        seen.current = { fn, args };
        return {
          data: { outcome: "transitioned", status: "posted", voucher: { id: "v-1" } },
          error: null,
        };
      },
    };
    const res = await callAtomicStockTransition(client, baseArgs);
    expect(res.ok).toBe(true);
    expect(seen.current?.fn).toBe("atomic_stock_transition");
    const args = seen.current?.args as Record<string, unknown>;
    expect(args.p_voucher_table).toBe("incoming_goods");
    expect(args.p_client_token).toBe("inward:post-v-1");
    expect(args.p_lines).toEqual([
      {
        line_no: 0,
        godown_id: "g-1",
        product_id: "p-1",
        party_id: null,
        inward_qty: 100,
        outward_qty: 0,
        notes: null,
      },
    ]);
  });

  it("surfaces an rpc error as a fail-closed error (no fallback loop)", async () => {
    const client: RpcCapable = {
      rpc: async () => ({
        data: null,
        error: { message: "function does not exist" },
      }),
    };
    const res = await callAtomicStockTransition(client, baseArgs);
    expect(res).toEqual({ ok: false, error: "function does not exist" });
  });

  it("rejects a malformed function result instead of treating it as posted", async () => {
    const client: RpcCapable = {
      rpc: async () => ({ data: { outcome: "posted" }, error: null }),
    };
    const res = await callAtomicStockTransition(client, baseArgs);
    expect(res.ok).toBe(false);
  });
});
