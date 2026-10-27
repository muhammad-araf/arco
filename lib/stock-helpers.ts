/**
 * Pure stock helpers for the STOCK-DASH scope (dashboard / inward /
 * inventory). No imports, so these are unit-testable without a DB:
 *
 * - bilty duplicate-check mode: read from the `bilty_duplicate_check`
 *   app_settings row (owned by the settings team). Never hard-coded
 *   here: the mode is always an input, and an absent / unrecognised
 *   value resolves to "warn", per the spec-compliance brief.
 * - FIFO stock ageing: ledger rows are consumed oldest-first per
 *   (godown, product, owner) pool. This is an APPROXIMATION — it uses
 *   ledger dates only, opening_balances rows (which carry no ledger
 *   date) are excluded, and the bucket edges are the standard
 *   0–30 / 31–60 / 61–90 / 90+ day buckets pending client
 *   confirmation. No bucket edge or business value is invented as
 *   confirmed policy.
 */

export type BiltyDuplicateMode = "warn" | "block" | "off";

/** Normalise any stored shape of the bilty setting to a mode. */
export function normalizeBiltyMode(value: unknown): BiltyDuplicateMode {
  const raw =
    typeof value === "string"
      ? value
      : value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).mode ??
          (value as Record<string, unknown>).value ??
          (value as Record<string, unknown>).setting ??
          ""
        : "";
  const s = String(raw).trim().toLowerCase();
  if (s === "block") return "block";
  if (s === "off") return "off";
  return "warn";
}

export type AgeingBucket = "0-30" | "31-60" | "61-90" | "90+";

/** Bucket label for an age in whole days. Edges are inclusive on the
 *  lower bound: day 30 is 0–30, day 31 is 31–60, day 90 is 61–90. */
export function ageingBucket(ageDays: number): AgeingBucket {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

export interface AgeingLedgerRow {
  godown_id: string;
  product_id: string;
  party_id: string | null;
  /** ISO date of the ledger row. */
  date: string;
  inward_qty: number;
  outward_qty: number;
}

export interface AgeingPool {
  godown_id: string;
  product_id: string;
  party_id: string | null;
  buckets: Record<AgeingBucket, number>;
  total_kg: number;
}

/** Whole days between two ISO dates (date part only, UTC). */
function wholeDays(fromISO: string, toISO: string): number {
  const from = Date.parse(`${String(fromISO).slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${String(toISO).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 86400000));
}

/**
 * FIFO ageing per pool. Rows must be in ledger order (date, then
 * insertion order); outward rows consume the oldest remaining inward
 * lots first. A pool whose outward exceeds its inward history is
 * floored at zero — a negative remainder is a data problem, not a
 * bucket. Rows dated after `asOfISO` are ignored (they are not stock
 * on hand at that date). Quantities are rounded to 2dp, matching the
 * ledger writers.
 */
export function fifoAgeing(
  rows: AgeingLedgerRow[],
  asOfISO: string,
): AgeingPool[] {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  type Lot = { date: string; qty: number };
  const pools = new Map<string, { godown_id: string; product_id: string; party_id: string | null; lots: Lot[] }>();
  for (const row of rows) {
    if (String(row.date).slice(0, 10) > String(asOfISO).slice(0, 10)) continue;
    const key = `${row.godown_id}|${row.product_id}|${row.party_id ?? ""}`;
    let pool = pools.get(key);
    if (!pool) {
      pool = { godown_id: row.godown_id, product_id: row.product_id, party_id: row.party_id, lots: [] };
      pools.set(key, pool);
    }
    const inward = Number(row.inward_qty) || 0;
    if (inward > 0) pool.lots.push({ date: row.date, qty: round2(inward) });
    let outward = Number(row.outward_qty) || 0;
    while (outward > 0 && pool.lots.length > 0) {
      const lot = pool.lots[0];
      const take = Math.min(lot.qty, outward);
      lot.qty = round2(lot.qty - take);
      outward = round2(outward - take);
      if (lot.qty <= 0) pool.lots.shift();
    }
  }
  const out: AgeingPool[] = [];
  for (const pool of pools.values()) {
    const buckets: Record<AgeingBucket, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    let total = 0;
    for (const lot of pool.lots) {
      if (lot.qty <= 0) continue;
      const bucket = ageingBucket(wholeDays(lot.date, asOfISO));
      buckets[bucket] = round2(buckets[bucket] + lot.qty);
      total = round2(total + lot.qty);
    }
    if (total <= 0) continue;
    out.push({ godown_id: pool.godown_id, product_id: pool.product_id, party_id: pool.party_id, buckets, total_kg: total });
  }
  return out;
}
