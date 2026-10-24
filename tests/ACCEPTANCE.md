# Acceptance traceability — Seed Godown & Processing ERP

Sources mapped, in full:

- Functional spec (`Seed_Godown_Software_Full_Functional_Specification.pdf`):
  §22 developer acceptance checklist (12 items), §4.3 inward (5),
  §6.5 batch (4), §9.5 gate pass (7), §12.4 daybook (4), §15 P&L
  definitions, §16 reports (16 rows).
- `IMPLEMENTATION_PLAN.md` §7 developer acceptance checklist (7 items).

Status vocabulary (exactly one per item):

- `covered` — a test in this directory asserts it and passes against
  the real implementation (see §H for what "passes" means in Phase 1).
- `pending-backend` — needs server actions / DB behaviour (posting,
  guards, uniqueness, reversals, allocations, record retention) and
  cannot be proven by pure-function tests; verified in Phase 2.
- `pending-UI` — needs a screen, print layout, or user-visible flow;
  verified in Phase 2.

Phase 1 ground rules: there is NO live Supabase project and NO `.env`,
so Phase 1 tests are pure-function unit tests only (no DB, no network).
Anything that needs a posted voucher, a ledger row in the database, a
printed page, or a second click in a browser is honestly
`pending-backend` / `pending-UI` below — not faked with mocks of the
system under test.

Test files referenced (all under `tests/unit/` unless noted):

- `inward.test.ts` — net weight (6 tests)
- `production.test.ts` — planned qty, yield %, variance (10)
- `machinery.test.ts` — machinery charges, all rate bases (8)
- `packing.test.ts` — packing charge, bardana closing (8)
- `ledger.test.ts` — running balances, stock from rows, daybook (9)
- `money.test.ts` — decimal-safe rounding (4)
- `payroll.test.ts` — daily/monthly/overtime/piece-rate/advance/net (18)
- `finance-definitions.test.ts` — P&L + allocation (12, BLOCKED:
  `lib/calc/finance` does not exist on any branch yet)

## A. Spec §22 — developer acceptance checklist

| # | §22 item | Status | Test(s) / what Phase 2 must verify |
|---|----------|--------|-------------------------------------|
| 22-1 | No draft voucher changes stock or financial balances | pending-backend | Draft/posted state machine in server actions; draft creates no `stock_ledger` / `cash_ledger` / `party_ledger` rows. Verify with a draft then a balance read, on a live DB. |
| 22-2 | Every posted voucher affects the correct ledger exactly once | pending-backend | Idempotency: same voucher posted twice (double-click, retry) yields one set of ledger rows. Calc level covered: `ledger.test.ts` (running-balance fold, `stockBalanceFromRows`). |
| 22-3 | All posted stock movement is traceable to a voucher and user | pending-backend | Every `stock_ledger` row carries `voucher_type`/`voucher_no`/`created_by`; UI ledger shows the source. Calc level covered: `ledger.test.ts`. |
| 22-4 | Gate pass number unique; posted dispatch deducts stock; return/reversal linked and auditable | pending-backend | Sequential, never-reused numbers (incl. after cancellation); dispatch deducts exactly once; return references the original pass and restocks only accepted qty. See also §9.5 below. |
| 22-5 | Production batch deducts actual inputs, adds outputs/by-products, consumes packaging per approved rules | pending-backend | Posting behaviour in batch actions. Calc level covered: `production.test.ts` (yield/variance), `packing.test.ts` (`bagClosing`), `ledger.test.ts` (in/out fold). |
| 22-6 | Customer receipt reduces allocated receivable and increases cash/bank; does not create duplicate revenue | pending-backend | Receipt posting + allocation. Definition tests written but BLOCKED: `finance-definitions.test.ts` ("receipt is not revenue", `invoiceOutstanding`) needs `lib/calc/finance`. |
| 22-7 | Vendor payment reduces payable and cash/bank; does not deduct inventory again | pending-backend | Payment posting must touch party + cash ledgers only, never `stock_ledger`. No calc test can prove a negative posting effect. |
| 22-8 | Payroll uses approved attendance and pay rules and retains historical rates/payments | pending-backend (math covered) | Math covered: `payroll.test.ts` (daily, monthly prorated, half-day, overtime, advance recovery, snapshot-rate semantics). Record retention — the payroll row storing the rate applied even after the master rate changes — is backend behaviour, Phase 2. Open gap: `computePayroll` has no `previousBalance` input (spec §13.3 lists it); see §G. |
| 22-9 | Daybook opening + receipts − payments = closing for each account and period | covered (formula) | `ledger.test.ts` — `daybookClosing` (incl. overdraft shown as negative, not hidden). Per-account/per-period aggregation over real `cash_ledger` rows is Phase 2 backend verification. |
| 22-10 | Reports match underlying ledger totals and filters; exports respect permissions | pending-backend / pending-UI | Report totals recomputed from ledger rows for a filtered period; export permission check. See §E per report. |
| 22-11 | Role permissions prevent unauthorized posting, cancellation, payroll/profit viewing, master changes | pending-backend (CONFLICT — see §G) | Spec §17 describes multi-role permissions, but `IMPLEMENTATION_PLAN.md` §1 states the user requirement is a SINGLE unified role (Administrator / Master Operator) with no permission barriers. Phase 2 must confirm which governs before this item can be tested either way. |
| 22-12 | Backup restore tested; client staff trained; source + deployment docs handed over | pending-UI | Out of Phase 1 scope; operational sign-off, not code tests. |

## B. IMPLEMENTATION_PLAN.md §7 — developer acceptance checklist

| # | Plan §7 item | Status | Maps to / notes |
|---|--------------|--------|-----------------|
| P-1 | No Draft Impact | pending-backend | Same as 22-1. |
| P-2 | Exact-Once Posting | pending-backend | Same as 22-2. Requires idempotency key / status guard in actions, plus double-submit protection in UI. |
| P-3 | Unique Gate Pass Numbers | pending-backend | Same as 22-4 (numbering part). |
| P-4 | Stock Guard | pending-backend | Outward gate passes and batches blocked from driving stock negative. Note the deliberate split: `ledger.test.ts` asserts the calc does NOT clamp (a negative result means the action must have blocked it) — the guard itself is backend behaviour. |
| P-5 | Traceability | pending-backend | Same as 22-3, plus cash ledger rows. |
| P-6 | Print Perfection | pending-UI | Inward slips, gate passes, daybooks format cleanly on A4 with no interface clutter. Needs print-layout review + printed-output check in Phase 2. |
| P-7 | Single-Role Simplicity | pending-UI | All operations reachable from one console with no permission roadblocks. Conflicts with spec §17 roles — see 22-11 / §G. |

## C. Module acceptance tests

### §4.3 — Inward receiving

| # | Item | Status | Test(s) / notes |
|---|------|--------|-----------------|
| 4.3-1 | Draft receiving voucher does not change stock | pending-backend | Same family as 22-1. |
| 4.3-2 | Posting increases stock by the posted quantity exactly once | pending-backend | Calc level: `ledger.test.ts` fold. |
| 4.3-3 | A second click/retry cannot post the same voucher twice | pending-backend | Same as P-2. |
| 4.3-4 | Invalid negative/zero quantities or missing required product are blocked | pending-backend (calc throws covered) | `inward.test.ts` asserts `netWeight` throws on negative gross/bags/tare and on a negative net result. Voucher-level validation (zero qty, missing product) is backend behaviour. |
| 4.3-5 | Cancelled/reversed receipt restores the prior stock position and remains visible in audit history | pending-backend | Reversal entry with reason; original never silently deleted. |

### §6.5 — Recipe / batch

| # | Item | Status | Test(s) / notes |
|---|------|--------|-----------------|
| 6.5-1 | Recipe version used by an old batch cannot change when a new version is approved | pending-backend | Batch must snapshot `recipe_id` + version at posting. |
| 6.5-2 | Posting a batch deducts actual inputs and adds actual outputs exactly once | pending-backend | Calc level: `production.test.ts`, `ledger.test.ts`. |
| 6.5-3 | Insufficient stock is handled according to the configured policy | pending-backend (policy open) | Spec says "warn/block according to policy" — the policy itself is a client decision (§19), not yet recorded. Same guard family as P-4. |
| 6.5-4 | Yield/variance results match hand-calculated approved examples | covered | `production.test.ts`: spec §6.3 example (70/30 of 100 kg), yield 92/100 = 92%, variance ±5 kg / ±7.14%. "Approved examples supplied by the client" do not exist yet — these tests use the spec's own illustrative numbers. |

### §9.5 — Gate pass

| # | Item | Status | Test(s) / notes |
|---|------|--------|-----------------|
| 9.5-1 | Draft gate pass does not change stock | pending-backend | Same family as 22-1. |
| 9.5-2 | Posting reduces the correct stock quantity exactly once | pending-backend | Calc level: `ledger.test.ts` fold. |
| 9.5-3 | Insufficient stock is blocked or requires an explicitly approved override with audit trail | pending-backend | Same guard family as P-4; override path must log approver + reason. |
| 9.5-4 | Cancelled posted pass restores stock via reversal and remains searchable | pending-backend | Same family as 4.3-5. |
| 9.5-5 | Partial return increases stock only for accepted/restocked quantity | pending-backend | Return references the original pass; rejected/damaged qty must not restock. |
| 9.5-6 | Gate pass number remains unique and is not reused | pending-backend | Same as P-3. |
| 9.5-7 | Only permitted roles can approve, post or cancel; every action is logged | pending-backend (CONFLICT) | Same conflict as 22-11: single-role plan vs multi-role spec §17. |

### §12.4 — Daybook

| # | Item | Status | Test(s) / notes |
|---|------|--------|-----------------|
| 12.4-1 | A posted receipt increases the correct cash account once | pending-backend (calc covered) | `ledger.test.ts` — `cashRunningBalance` fold (receipt then expense). Account selection + exact-once posting is backend. |
| 12.4-2 | A posted cash expense decreases the correct cash account once and appears in the selected expense category | pending-backend (calc covered) | Same fold test; category attribution is backend. |
| 12.4-3 | Paying a vendor invoice reduces payable and cash/bank, not stock quantity again | pending-backend | Same as 22-7. |
| 12.4-4 | Voided transactions remain auditable and balances recalculate consistently | pending-backend | Void = reversal with reason; balances recomputed from rows, never edited totals (`stockBalanceFromRows` pattern, `ledger.test.ts`). |

## D. Spec §15 — P&L definitions

All definition tests live in `finance-definitions.test.ts` and are
BLOCKED on the missing `lib/calc/finance` module (see
`CALC_CONTRACT.md`). Statuses below are therefore `pending-backend`
even where the test is already written.

| # | §15 definition | Status | Notes |
|---|---------------|--------|-------|
| 15-1 | Service revenue = posted machinery/processing/treatment/packing charges, EXCLUDING customer receipts | pending-backend | Test "receipt is not revenue" written (blocked). A receipt is cash collection (§11.2), not revenue. |
| 15-2 | Product sales revenue = posted invoices for products sold | pending-backend | Only if the business sells its own seed (model (a)/(c) — see 15-6). |
| 15-3 | COGS = approved inventory valuation × sold quantity, NOT all purchases in the month | pending-backend | Test "does not treat all purchases as cost" written (blocked). Valuation method is a client decision (§19). |
| 15-4 | Packaging cost = consumed bag cost (or approved inclusive model); bag purchase AND consumption must not both be expensed | pending-backend | Test "keeps purchase cost out of P&L" written (blocked). `bagClosing` itself is covered (`packing.test.ts`). |
| 15-5 | Operating expenses = posted expense vouchers in operating categories; payroll may be separate per policy | pending-backend | Category/policy decision for the accountant. |
| 15-6 | Net profit = revenue − recognised COGS/services − operating expenses (plan formula: (service + sales) − (COGS + packaging + operating + payroll)) | pending-backend | Test written (blocked), incl. a loss case (negative, not clamped). |
| 15-7 | Business model decision: (a) buy/sell own seed, (b) process customer-owned seed for a fee, (c) both | OPEN — client confirmation (§15.2, §19) | Changes ownership, valuation, billing and revenue recognition. Blocks final P&L sign-off, not the arithmetic tests. |

## E. Spec §16 — reports & exports

Every report must show its date range/filters, a total row where
meaningful, and export to PDF/Excel. Report totals must reconcile to
ledger rows (22-10). All rows are `pending-backend` / `pending-UI`
except for the calc-level pieces noted.

| Report | Status | Calc coverage / Phase 2 check |
|--------|--------|-------------------------------|
| Stock summary (opening, inward, consumed, produced, dispatched, adjusted, closing) | pending-backend / pending-UI | Closing arithmetic pattern covered by `ledger.test.ts` + `packing.test.ts` (`bagClosing`). |
| Stock ledger (date, voucher type/no., in/out, running balance, source/lot, user) | pending-backend / pending-UI | Running balance per row covered: `ledger.test.ts`. |
| Incoming goods (date range, supplier, product, bilty, location, qty/weight) | pending-backend / pending-UI | Net weight covered: `inward.test.ts`. |
| Production / recipe batch (recipe/version, planned/actual, yield, wastage, packaging, operator, cost) | pending-backend / pending-UI | Yield/variance/planned qty covered: `production.test.ts`. |
| Machinery jobs (date, customer, machine/type, in/out, rate basis, charge, outstanding) | pending-backend / pending-UI | All rate bases covered: `machinery.test.ts`. |
| Final unit / packing (product, treatment, bag types/counts, packing charges, consumption, output) | pending-backend / pending-UI | Packing charge + bag closing covered: `packing.test.ts`. |
| Gate pass register (pass no., date, customer, vehicle, items, qty/weight, status, approver, return/reversal) | pending-backend / pending-UI | No calc piece; numbering + status + linkage all backend. |
| Purchases / vendors (vendor, invoice, items, qty, total, paid, remaining, age) | pending-backend / pending-UI | Outstanding formula written but blocked: `finance-definitions.test.ts`. |
| Bardana ledger (bag type, opening, purchased, consumed, damaged, returned, closing, valuation) | pending-backend / pending-UI | Closing covered: `packing.test.ts` (`bagClosing`). Valuation needs the approved costing method. |
| Attendance / payroll (employee, present/absent/leave days, payable, paid, advance, balance) | pending-backend / pending-UI | Pay math covered: `payroll.test.ts`. |
| Expenses (category, payee, account, amount, period totals) | pending-backend / pending-UI | No calc piece beyond daybook totals. |
| Daybook / cashbook (opening, receipts, payments, transfers, closing per account) | pending-backend / pending-UI | Closing formula covered: `ledger.test.ts` (`daybookClosing`). Transfers must net across accounts (spec §12.3), Phase 2. |
| Customer statement (opening, charges/invoices, receipts, credits, running balance) | pending-backend / pending-UI | Running-balance pattern covered: `ledger.test.ts`. Allocation formula blocked: `finance-definitions.test.ts`. |
| Vendor statement (opening payable, purchases, payments, credits, running balance) | pending-backend / pending-UI | Same as customer statement. |
| Profit & loss (approved revenue, cost of goods/services, packaging, operating expenses, net result) | pending-backend / pending-UI | Formula written but blocked: `finance-definitions.test.ts` (§D). |
| Audit log (user, action, entity/voucher, before/after, timestamp, reason) | pending-backend / pending-UI | No calc piece; needs audit rows on every create/edit/post/approve/cancel/return/export. |

## F. Related formula rules covered by unit tests

These are not headed "acceptance tests" in the spec but are the
formulas the acceptance items depend on; all are `covered`:

| Rule (spec) | Test file |
|-------------|-----------|
| Net weight = gross − bags × tare, incl. zero bags (§4, plan Module 2) | `inward.test.ts` |
| Planned component = planned size × ratio (§6.4) | `production.test.ts` |
| Yield % = usable output / total input × 100; variance = actual − planned, qty + % (§6.4) | `production.test.ts` |
| Machinery charge, per_bag / per_50kg / per_kg / per_maund / fixed (§7.2) | `machinery.test.ts` |
| Packing charge = bags × rate; bag closing = opening + purchased + returns − consumed − damaged ± adjustments (§8.2) | `packing.test.ts` |
| Ledger running balance; stock balance from rows (§5.2) | `ledger.test.ts` |
| Daybook closing = opening + receipts − payments (§12.3) | `ledger.test.ts` |
| Payroll: daily, monthly prorated, half-day, overtime, piece-rate, advance recovery capped, net payable (§13.3–§13.4) | `payroll.test.ts` |
| Decimal-safe money/weight arithmetic (§1.2) | `money.test.ts` |
| Unit conversions kg ↔ maund ↔ bags with caller-supplied factors (§3.1: no universal conversion) | NOT tested — `lib/calc/conversions.ts` exists on `work/ui-print` but conversion tests were out of the Phase 1 list; add in Phase 2 if the backend keeps the module. |

## G. Open items and conflicts found during Phase 1

1. **`lib/calc/finance` missing** — invoice outstanding, P&L and
   packaging-cost helpers do not exist on any branch. 12 tests in
   `finance-definitions.test.ts` are written and blocked on it.
2. **Payroll `previousBalance`** — spec §13.3 lists previous balance
   as a payroll component, but `computePayroll` has no such input.
   Needs a backend decision on sign convention before it can be tested.
3. **Single-role vs multi-role conflict** — spec §17/§9.5-7/§22-11
   assume roles and permissions; `IMPLEMENTATION_PLAN.md` §1 says the
   user explicitly required a single unified role with no permission
   barriers. This changes what "permitted roles" tests can assert.
4. **Client-confirmation items still open (spec §19)** — kg-per-maund
   factor, unit conversions, machinery rate formula per processing
   type, business model (§15.2), P&L formula sign-off, packing-fee
   inclusivity, receipt allocation policy, payroll/leave rules,
   inventory valuation method, insufficient-stock policy (warn vs
   block). Tests deliberately parameterise these instead of hard-coding
   them (e.g. `per_maund` throws without an explicit `maundKg`).
5. **No live Supabase project, no `.env`** — all integration checks
   (posting, guards, numbering, reversals, print) await a live DB.

## H. Phase 1 test results (exact)

- **On this branch (`work/tests`, from `main`): BLOCKED.** `lib/calc/`
  is absent, so all 8 test files fail at import time
  (`Cannot find module '@/lib/calc/*'`). No test results are claimed
  from this run.
- **Verification run against the real implementation:** the same
  suite was run in a throwaway detached worktree at `work/ui-print`
  commit `b316583` (where `lib/calc/` is committed), using this
  repo's installed Vitest 3.2.7:
  - 7 files passed, **63/63 tests passed** — `inward` 6, `production`
    10, `machinery` 8, `packing` 8, `ledger` 9, `money` 4, `payroll` 18.
  - 1 file failed at import time — `finance-definitions.test.ts`
    (12 tests), `Cannot find module '@/lib/calc/finance'`, because
    that module does not exist on that branch either.
  - The worktree was removed after the run; nothing from it was
    committed here.
- **What Phase 2 needs:** `lib/calc/finance` on the integration
  branch; server actions + a live Supabase project with migrations and
  `.env`; UI pages wired to the actions; print layouts. Then: full
  `npm test`, `npx tsc --noEmit`, `npm run build`, and a walk of
  every `pending-backend` / `pending-UI` item above with
  file + line + reproduction for each failure. Test files may be
  fixed; implementation files may not (unless explicitly asked).
