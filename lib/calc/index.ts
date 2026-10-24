/**
 * lib/calc — pure calculation module for the Seed Godown & Processing ERP.
 *
 * RULES FOR THIS DIRECTORY (read before adding a function):
 * 1. Pure functions only: no DB access, no fetch, no Date.now, no side
 *    effects, no imports from server code. Every function is unit-testable
 *    in isolation.
 * 2. Decimal-safe: all money/weight results go through roundMoney /
 *    roundWeight (2 decimals, matching the NUMERIC(12,2)/(14,2) columns).
 * 3. NOTHING client-confirmation is hard-coded: the kg-per-maund factor,
 *    the billing basis (per_bag / per_50kg / per_kg / per_maund / fixed),
 *    the half-day factor, days-in-month and the yield definition (usable
 *    output only) are all parameters or documented choices in the function
 *    that owns them. In particular, 50 is never a universal rule — it
 *    appears only inside the explicitly-named `per_50kg` basis.
 * 4. Throw RangeError on invalid input (negative quantities, missing
 *    maund factor, ratio outside 0–100) rather than silently returning a
 *    plausible-looking wrong number. The one exception is a zero
 *    denominator: yieldPct / variance pct return 0 instead of NaN.
 *
 * Consumers: server actions under app/actions/* (backend + finance agents)
 * must use these helpers for every money/weight computation so that the UI,
 * the ledger and payroll can never disagree about arithmetic.
 */
export * from "./money";
export * from "./weights";
export * from "./charges";
export * from "./ledger";
export * from "./payroll";
export * from "./conversions";
