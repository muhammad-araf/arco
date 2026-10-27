# Posting rules — Seed Godown & Processing ERP

Extracted from the server-action headers (`app/actions/*.ts`), the
pure calculation contract (`tests/CALC_CONTRACT.md`, `lib/calc/*`),
and `SETUP.md` §6. Where a rule below cites a spec section, the
section is the client specification's numbering as the code cites it.
These rules are invariants the code protects — they are not
configurable, and a UI change must never weaken one. Anything the
client has not decided is marked open and points at SETUP.md §11; no
rule here invents a decision.

## Universal rules (every voucher)

1. **Draft → posted → reversed, and nothing else.** Drafts change no
   ledger. Posting applies effects exactly once. Posted rows are
   never deleted and never edited in place; a mistake is fixed by a
   reversal with a mandatory reason, which inserts compensating
   ledger rows. Reversed rows stay visible with their reason.
2. **Exactly-once posting.** Creation is idempotent on `clientToken`
   (one UUID per submit; double-clicks and retries return the
   original row), and posting runs only on a draft — a repeat post
   returns the posted row unchanged. For inward, gate passes,
   transfers, adjustments and machinery jobs the flip runs inside
   `atomic_stock_transition()` (`supabase/migration-atomic-posting.sql`
   + `migration-atomic-lot.sql`): the voucher row is locked
   `FOR UPDATE`, the status is re-checked, all ledger lines are
   inserted with sequential running balances, the status flips and
   the idempotency key lands — in ONE transaction. A crash mid-post
   rolls everything back; a retry starts clean. The ledger identity
   (`voucher_type`, `voucher_id`, `entry_kind`, `line_no`) rejects a
   second copy of the same line. Batch posting stays loop-based
   (its flip also writes computed yield/variances and packaging
   legs outside any stock-only function); its exact-once comes from
   the same ledger identity plus the status-guarded flip, and a
   retry converges instead of duplicating. Residual risk, stated in
   the code: batch packaging legs and gate-pass return legs sit
   outside the atomic function.
3. **Status guards are server-side.** The UI check is never trusted:
   every post/reverse re-checks the stored status, re-checks
   server-side mass balance on stored values (batches), and
   re-checks `is_active` on every product (a stale form must never
   post an inactive product).
4. **Stock guards aggregate duplicate lines first.** Guards are
   computed per (godown, product, owner) pool, summing duplicate
   lines before comparing with the balance — two 60 kg lines against
   a 90 kg balance must fail as 120 kg, not pass twice as 60 kg.
5. **Owner scoping (the owner rule).** `party_id` NULL on a ledger
   row means company-owned stock. When a voucher is customer-owned,
   its input is consumed from the OWNER's pool and its output is
   credited to the OWNER's pool — company stock is never touched.
   Customer-owned material, batches and jobs carry
   `is_customer_owned` + `owner_party_id` / `customer_id` on the
   header; line-level `party_id` scopes gate-pass lines the same way.
6. **Running balances are sequential, never recomputed from scratch
   per row in the app.** `ledgerRunningBalance(prev, inward,
   outward) = prev + inward − outward`; stock balance from rows is
   `Σ inward − Σ outward`. The atomic function computes each new
   balance from the rows already visible in its transaction.
7. **Money and weights round to 2 decimals** (`roundMoney`,
   `roundWeight`); negative quantities/rates throw `RangeError`
   unless a rule states otherwise. `yieldPct = usable output /
   total input × 100`, 0 when input is 0 (never NaN); by-product
   and waste are NOT output. `variance = actual − planned`
   (quantity and %), % = 0 when planned is 0.
8. **Audit on every write.** Every create/post/reverse/approve/
   reject/adjust writes an `audit_log` row (before/after, actor,
   reason where mandatory). `audit_log` is append-only.
9. **Roles gate every write server-side** (`requireRole()` with the
   existing role constants; SETUP.md §4). Hiding a button is never
   enforcement. A signed-in user with no `profiles` row, an inactive
   profile, or an unrecognised role is denied everywhere.

## Stock (§4, §5)

- **Inward.** Gross − bags × tare = net (`netWeight`); a negative
  net throws. Bilty duplicates follow the `bilty_duplicate_check`
  setting (`off` / `warn` / `block`). New header fields
  (`received_by`, `by_hand`, `nature`) and line `lot_no` degrade
  safely when the live database lacks their columns (the draft is
  still created, with a warning) — until
  `migration-stock-inward-fields.sql` is applied.
- **Gate passes.** Posting deducts stock from the godown, party-
  scoped per line. When `gatepass_approval_required` is ON, posting
  only moves the pass to `awaiting_approval` with NO stock change;
  only an Owner/Admin approval (interim, pending the §19 approver
  definition) runs the stock guard at approval time and deducts.
  Rejection sends the pass back to draft with a stored
  `rejection_reason`. Returns are recorded per (product, owner)
  pool in `gate_pass_returns`; the pass status is derived from
  them: `partially_returned` while any dispatched quantity remains
  unreturned, `returned` only when the full quantity is back.
  `restock_decision = accepted` returns the quantity to stock;
  `rejected` records it but never restocks it.
- **Transfers and adjustments.** Transfers move stock between
  godowns in the same (product, owner) pool. Adjustments carry a
  signed quantity, a mandatory reason and an approver; both post
  and reverse through the atomic function.
- **Lots.** A line's `lot_number` (from inward `lot_no`) persists
  into `stock_ledger.lot_number` via `migration-atomic-lot.sql`;
  absent/empty means no lot tracking for that line and changes
  nothing else. Inventory lot filtering reads `lot_number`.

## Production (§6, §7, §8)

- **Recipes are immutable.** An edit never updates a live recipe
  row: `createRecipeVersion` retires the current version and
  inserts a NEW row with the same code and `version + 1`. Batches
  record `recipe_id` + `recipe_version_used` at draft time, so old
  batches keep the version they actually ran.
- **Batches.** Mass balance (output + by-product + waste ≤ input,
  no negatives, no output from zero input) is enforced at draft
  creation AND at posting, on stored values. Yield uses the SUM of
  ALL finished outputs / total input (by-product never counts); a
  batch with no finished rows falls back to its header output
  weight. Per-input variances vs plan are stored on the batch
  (`variances`), not dropped. The variance-tolerance gate runs
  BEFORE any stock moves: when `variance_tolerance_pct` is set and
  an input variance exceeds it, a variance reason must be on the
  batch (stored, or supplied with the post call) before posting.
  Null tolerance = disabled.
- **Packaging on batch post.** Packed + damaged bags both leave
  bardana stock (`packaging_types.current_stock` decremented,
  guarded); a `packing_records` row is written AND a bardana
  consumption row, so the ledger agrees with the stock card.
  Batch packing writes exactly ONE `packing_lines` row. Packed
  weight is the batch's actual output, never bags × capacity.
- **Machinery jobs.** The service charge is fixed at draft time by
  `machineryCharge()` for the job's rate basis and preserved at
  posting (a job created before its charge columns existed keeps
  its recorded charge instead of being silently rebilled):
  `per_bag` bills the ACTUAL bag count entered (never weight /
  50); `per_50kg` / `per_kg` / `per_maund` bill kg; `fixed`
  returns the rate; `per_maund` REQUIRES the explicit
  client-approved `maundKg` — no universal maund value is assumed
  anywhere (spec §3.1, §19). The stored bags / `maund_kg` let
  anyone recompute the charge afterwards. Multi-line jobs guard
  every line's input (aggregated per product + owner pool) and
  stock every line's output AND by-product; waste stays
  header-only, never stocked. A single-line job's by-product IS
  stocked. Posting creates NO invoice and NO receipt: the posted
  `service_charge` is the charge record billing reads later
  (`createInvoice`, `source_type = machinery_job`).
- **Packing (standalone).** `packingCharge = bags × rate`.
  `bagClosing = opening + purchased + returns − consumed − damaged
  + signed adjustments`, rounded to whole bags. Damaged bags are of
  the header bag type (or the first line's type for multi-line
  runs). Treatments on a packing record are record-only: no
  treatment stock is deducted (open item, SETUP.md §11 item 8).
- **Cost ledger (gated, wave 2).** When `cost_ledger_enabled` is
  false (default), batch/job posts write NO cost rows. When true,
  `postBatch` records packaging cost (bags × rate), per-input
  quantities (with a monetary amount only when `valuation_method`
  is set — otherwise NULL amount, basis `unconfirmed-method`), and
  per-output quantities; `postJob` records the stored service
  charge against the job's own charge basis (`rate_basis`). A
  cost-ledger failure is logged and never fails a post that already
  landed. No costing method is ever invented: ingredient amounts
  come only from `computeStockValuation()` in
  `lib/calc/finance-valuation.ts` over posted, received purchase
  history.

## Finance (§10–§12, §15)

- **Purchases.** Seed lines move stock and bardana lines move
  packaging ONLY when `receipt_status = received`. A `bill_only`
  purchase creates the payable and nothing else. Returns / credit
  notes link to the original purchase and reduce the payable (and
  stock/bardana, when the goods were received).
- **Invoices are the revenue record.** Revenue = posted invoices
  ONLY (service revenue from machinery/packing invoices, product
  sales from sale invoices). Machinery/packing charges that have
  not been invoiced are NOT counted as revenue (open item,
  SETUP.md §11 item 11).
- **Receipts are collections, not revenue.** A receipt debits cash
  and credits the receivable, with EXPLICIT allocation to invoices
  (`invoice_allocations`); any remainder is an unapplied advance
  on the receipt row. Nothing auto-blanket-allocates.
- **Payments stay distinct.** Purchase, payroll and expense
  settlements are separate `settlement_kind` values and separate
  allocation targets (`payment_allocations.target_type`). Paying a
  vendor never touches stock.
- **Unpaid expenses are payables, not cash outflow.** A `credit`
  expense posts no cash row; it is settled later via
  `allocatePayment` with `target_type = expense`. A credit expense
  with no vendor is blocked (a payable owed to nobody). A paid
  expense needs a cash account whose kind matches the payment
  method.
- **Daybook.** Per cash/bank account: `closing = opening + receipts
  − payments` (`daybookClosing`); transfers in/out fold into
  receipts/payments respectively and are also reported separately.
  A transfer debits one account and credits the other with the
  same `transfer_no`; it is never revenue or expense.
- **Party ledger sign convention.** `running_balance > 0` = the
  party owes the business (receivable); `< 0` = the business owes
  the party (payable). Opening = the party master's signed opening
  balance plus ledger entries before the range.
- **Opening balances are recorded once.** `opening_balances` is
  the auditable evidence record; the live opening lives in the
  master (`parties.opening_balance`,
  `cash_accounts.opening_balance`). Reports read masters + ledger
  history and must NOT add `opening_balances` again, or openings
  double-count.
- **P&L (§15).** COGS is an accountant-supplied approved valuation
  (`pl_cogs_approvals`, passed to `getPL` as `cogsAmount`) — when
  absent the report says so and shows 0 rather than silently using
  purchases as cost. Packaging cost = consumed-bag cost ONLY (bag
  purchases are never added, or purchase + consumption
  double-count). Payroll is a separate line. Bardana valuation is
  only the sum of `total_cost` values already recorded on
  bardana rows — it is NOT a closing-stock valuation, and is always
  returned with that label.
- **Stock valuation (§15.2).** `getStockValuation(method)` takes
  the method as an argument (the reports tab passes
  `valuation_method` from `getSettingsSnapshot()`):
  `last_purchase_cost` = closing stock × latest posted, received
  purchase price; `average_cost` = closing stock ×
  quantity-weighted average of posted, received purchase prices
  (Σ qty×price / Σ qty). `unconfirmed` (or anything else) returns
  method-not-set with NO number, never a guessed value. Products
  with stock but no purchase history are listed in
  `uncostedProductIds` with value null, never valued at 0.
  Bill-only purchases never price stock on hand (their prices are
  excluded: only posted, received purchases count).
- **Exports are audited.** Every CSV / Excel / PDF export of a
  report calls `logExport()` with the report name, format and
  filters.

## Payroll (§13)

- One attendance row per employee/date; corrections need a reason
  + audit. Payable days come from the configurable `payroll_rules`
  setting (weekly off, half-day factor, paid/unpaid leave &
  holidays, monthly fixed vs prorated, proration denominator).
- `dailyPay = (present + half × halfDayFactor) × dailyRate`
  (default factor 0.5); `monthlyProratedPay = salary × eligible /
  daysInMonth` where daysInMonth is the real calendar length, never
  assumed 30 (throws when 0); `advanceRecovery = min(balance,
  requested)` — never more than still owed.
- Each payroll row snapshots `applied_rate` at run time — later
  master rate changes never rewrite history. Approval locks the
  period; changes after approval use audited `adjustPayroll`
  (approved, unpaid only) or reversal. Multiple partial payments
  are allowed; each keeps date/method/reference. `paid_amount`
  is maintained incrementally (direct `payPayroll` payments and
  `allocatePayment` payroll allocations both append to
  `payroll_payments` history). A period with payments recorded
  cannot be reversed until those payments are reversed through
  their payment vouchers first. One live (non-reversed) run per
  employee/month/year.

## Settings gates (summary — full reference in SETUP.md §10)

`business_model` (unconfirmed = no model assumed),
`valuation_method` (unconfirmed = no number anywhere),
`gatepass_approval_required` (false = post dispatches directly),
`variance_tolerance_pct` (null = gate disabled),
`bilty_duplicate_check` (warn), `session_timeout_minutes` (60;
0 disables idle sign-out), `cutover_date` (null), `currency`
(PKR), `cost_ledger_enabled` (false = no cost rows). Every gate
reads the setting at action time; no gate value is hard-coded in
a page.
