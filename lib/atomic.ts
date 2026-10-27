/**
 * Client for the atomic_stock_transition() Postgres function
 * (supabase/migration-atomic-posting.sql). The function runs ONE
 * transaction: lock the voucher row FOR UPDATE, refuse a voucher that
 * is no longer in a postable status, insert the ledger lines, flip
 * the status, store the idempotency key. A concurrent post of the
 * same voucher blocks on the lock and then sees the new status, so
 * it replays instead of duplicating; a crash rolls everything back.
 *
 * This module is deliberately free of supabase/next imports so the
 * parsing logic is unit-testable: callers pass a minimal rpc-capable
 * client (the real supabase client satisfies RpcCapable).
 */

export interface StockTransitionLine {
  lineNo: number;
  godownId: string;
  productId: string;
  partyId: string | null;
  inwardQty: number;
  outwardQty: number;
  notes?: string | null;
  /**
   * Optional lot number (lot traceability, STOCK-DASH). Carried into
   * stock_ledger.lot_number when the DB function accepts it; omitted
   * (null) means no lot tracking for this line and behaviour is
   * unchanged. Backward compatible: every existing caller omits it.
   * NOTE for live verification: the deployed atomic_stock_transition()
   * SQL must be updated to persist lot_number from this field — until
   * then the function ignores the key and lots do not land in the
   * ledger (see the STOCK-DASH final report).
   */
  lotNumber?: string | null;
}

export interface AtomicTransitionArgs {
  voucherTable:
    | "incoming_goods"
    | "gate_passes"
    | "godown_transfers"
    | "stock_adjustments"
    | "machinery_jobs";
  voucherId: string;
  /** Statuses the transition may start from, e.g. ["draft"]. */
  fromStatuses: string[];
  toStatus: string;
  voucherType: string;
  voucherNo: string;
  entryKind: "post" | "reversal";
  lines: StockTransitionLine[];
  createdBy: string;
  clientToken?: string | null;
  scope?: string | null;
  reversalReason?: string | null;
}

export interface AtomicTransitionResult {
  outcome: "transitioned" | "already" | "invalid";
  status: string;
  voucher: unknown;
}

export interface RpcCapable {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Parse the function's jsonb return, rejecting anything malformed. */
export function parseAtomicTransitionResult(
  data: unknown,
): AtomicTransitionResult | null {
  if (!data || typeof data !== "object") return null;
  const outcome = (data as { outcome?: unknown }).outcome;
  const status = (data as { status?: unknown }).status;
  if (
    outcome !== "transitioned" &&
    outcome !== "already" &&
    outcome !== "invalid"
  ) {
    return null;
  }
  if (typeof status !== "string") return null;
  return {
    outcome,
    status,
    voucher: (data as { voucher?: unknown }).voucher ?? null,
  };
}

/**
 * Call atomic_stock_transition. Returns ok:false on an rpc failure —
 * which is fail-CLOSED: if the function errored, its transaction
 * rolled back, so no ledger row and no status flip landed. Callers
 * must surface the error, never fall back to a manual loop.
 */
export async function callAtomicStockTransition(
  client: RpcCapable,
  args: AtomicTransitionArgs,
): Promise<
  | { ok: true; result: AtomicTransitionResult }
  | { ok: false; error: string }
> {
  const { data, error } = await client.rpc("atomic_stock_transition", {
    p_voucher_table: args.voucherTable,
    p_voucher_id: args.voucherId,
    p_from_statuses: args.fromStatuses,
    p_to_status: args.toStatus,
    p_voucher_type: args.voucherType,
    p_voucher_no: args.voucherNo,
    p_entry_kind: args.entryKind,
    p_lines: args.lines.map((l) => ({
      line_no: l.lineNo,
      godown_id: l.godownId,
      product_id: l.productId,
      party_id: l.partyId,
      inward_qty: l.inwardQty,
      outward_qty: l.outwardQty,
      notes: l.notes ?? null,
      lot_number: l.lotNumber?.trim() ? l.lotNumber.trim() : null,
    })),
    p_created_by: args.createdBy,
    p_client_token: args.clientToken ?? null,
    p_scope: args.scope ?? null,
    p_reversal_reason: args.reversalReason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const parsed = parseAtomicTransitionResult(data);
  if (!parsed) {
    return {
      ok: false,
      error: "Atomic post returned an unexpected result.",
    };
  }
  return { ok: true, result: parsed };
}
