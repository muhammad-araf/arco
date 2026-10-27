# Client sign-off sheet — Seed Godown & Processing ERP

Every row starts blank/open. Nothing on this sheet is decided until
the client signs it: no row below records a decision, a date or a
signature, because none has been given. The configurable default the
app runs on until a decision lands is stated per row (see also
SETUP.md §11, the client decision log, which mirrors this sheet).

## Part A — Open decisions (spec §19 and wave-2 leftovers)

| # | Item | Configurable default until decided | Decision | Date | Signature |
|---|---|---|---|---|---|
| 1 | Business model: own seed, customer-owned, or both (§19 / §15.2) | `business_model = unconfirmed`; no model assumed | | | |
| 2 | COGS / stock valuation method (§19 / §15.2) | `valuation_method = unconfirmed`; valuation shows no number, COGS shows 0 with a warning | | | |
| 3 | Payroll rules: weekly off, paid leave, half-day factor, monthly proration denominator, overtime rate | `payroll_rules` placeholder values; payroll snapshots `applied_rate` per run | | | |
| 4 | Whether credit expenses are used | Credit expenses allowed but require a vendor (unpaid = payable, no cash row) | | | |
| 5 | One-bag / two-bag handling (bag-count conventions on receipt, packing and dispatch) | Bag counts recorded per line as entered; no one-bag/two-bag conversion applied anywhere | | | |
| 6 | Stage transfers (which processing stages move stock between godowns / stages, and at what point) | No automatic stage transfer is posted; transfers are explicit vouchers only | | | |
| 7 | Packing-fee bag-cost inclusion: does the packing fee include the bag's own cost, or is bag cost separate? | Packing charge = bags × rate only; bardana consumption costed separately from its ledger rows, never double-counted | | | |
| 8 | Treatment inventory impact: do packing treatments consume treatment stock? | Treatments are record-only on packing records; no treatment stock is deducted | | | |
| 9 | Gate-pass approver definition: who, by role, approves an awaiting-approval pass? | Interim: Owner/Admin only (`OWNER_ONLY` via the existing `requireRole` helper); no new role invented | | | |
| 10 | Historical-transaction import scope: which old vouchers / periods are imported, and from what cutover date? | `cutover_date = null` (no cutover set); Import page banner appears only once a date is set | | | |
| 11 | Job-posting = revenue? (machinery/packing charges not yet invoiced) | Not counted as revenue — revenue is recognised on the posted invoice only | | | |
| 12 | Maund weight (`maundKg`) for `per_maund` charging | `per_maund` requires an explicit client-approved value on the job; no universal maund value is assumed | | | |

## Part B — Acceptance checklist (go-live acceptance)

Each item is a check to run against the live project with the seeded
Owner/Admin signed in (see SETUP.md §7 for the procedure). A check
passes only when its observed result matches the "Expected" column;
record the date and the initials of whoever ran it. All rows are
currently unsigned.

| # | Acceptance check | Expected | Result | Date | Initials |
|---|---|---|---|---|---|
| A1 | Draft changes nothing | A draft voucher moves no ledger, no stock, no cash | | | |
| A2 | Posting twice changes balances once | Re-posting (same client token, or a posted voucher) returns the posted row unchanged; balances move once | | | |
| A3 | Receipt raises cash once, never revenue | Cash up once; P&L revenue unchanged by any receipt | | | |
| A4 | Vendor payment lowers payable and cash, not stock | Payable down, cash down, stock unchanged | | | |
| A5 | Daybook balances | Opening + receipts − payments = closing, per account | | | |
| A6 | Reversed voucher stays visible with its reason | Reversed row listed with status and reason; compensating rows present | | | |
| A7 | Role gates (live RLS + server checks) | Storekeeper: stock write succeeds, payroll write fails, direct PostgREST `UPDATE` on `profiles` fails; profile-less user: every action fails closed; Owner/Admin: stock write, role change and audit read all succeed | | | |
| A8 | Self-registration OFF | Authentication → Sign-ups is OFF in the live project | | | |
| A9 | RLS / GRANTs match the migrations | `pg_policies` and grants match `migration-rls-base-tables.sql` and `migration-rls-finance-replace.sql` | | | |
| A10 | Sample rows removed (old-schema databases only) | Untouched sample codes deleted (or renamed if now real data); every value shown comes from real masters, vouchers or ledgers | | | |
| A11 | Migrations applied in order | All 18 steps of SETUP.md §2 applied, including the gate-pass `ALTER TYPE` outside a transaction block, and atomic + wave-2 migrations before the code that calls them | | | |
| A12 | Double-submit / retry convergence | Double-clicking a post, and retrying after a failed post, never duplicates ledger rows | | | |
| A13 | Gate-pass approval flow (when enabled) | With `gatepass_approval_required` ON: posting submits without stock change; approval deducts; rejection returns to draft with reason | | | |
| A14 | Cost ledger gate (when enabled) | With `cost_ledger_enabled` ON: a posted batch writes packaging + input/output rows and a posted job writes its processing charge; with it OFF: no cost rows at all | | | |
| A15 | Valuation method respected | With `valuation_method` unconfirmed: valuation shows no number; with a method set: valuation matches posted, received purchase history only | | | |
| A16 | Backup restore test (§8) | Backup restored into a separate staging project; migrations check and §7 acceptance checks re-run against a known period; date and result recorded | | | |
| A17 | Staff training sign-off (§8) | Each role trained on its own pages only, on the staging project; per-role sign-off recorded | | | |
| A18 | A4 print pass | Inward slip, gate pass, batch sheet, job ticket and daybook print correctly on A4 | | | |

## Sign-off

| Role | Name | Signature | Date |
|---|---|---|---|
| Client / Owner | | | |
| Accountant | | | |
| Delivered by | | | |
