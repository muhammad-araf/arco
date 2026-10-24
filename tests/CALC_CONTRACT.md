# `lib/calc` contract assumed by these tests

Status note (Phase 1): at the time these tests were written, `lib/calc/`
was committed on the sibling `work/ui-print` branch (commit `b316583`)
but absent from `main` and from this branch. The signatures below were
read from that committed copy and verified by running this suite
against it (63/63 pass — see `ACCEPTANCE.md` §H). If the backend lands
a different shape on the integration branch, reconcile THIS file and
the tests together — do not silently change a test to match a wrong
implementation, and do not change the implementation to match a test
without checking the spec section cited.

## Existing modules (tested, passing in Phase 1 run)

All money/weight results are rounded to 2 decimals. All of these throw
`RangeError` on negative quantities/rates unless stated otherwise.

### `lib/calc/weights`

- `netWeight(grossKg, bags, tarePerBagKg) => number`
  Gross − bags × tare; throws if the result would be negative.
  Spec §4 / IMPLEMENTATION_PLAN Module 2.
- `plannedComponentQty(plannedSizeKg, ratioPct) => number`
  Planned size × ratio / 100; ratio must be 0–100. Spec §6.4.
- `yieldPct(outputKg, inputKg) => number`
  Usable output / total input × 100; 0 when input is 0 (never NaN).
  By-product/waste are NOT output. Spec §6.4.
- `variance(actual, planned) => { qty, pct }`
  qty = actual − planned; pct = qty / planned × 100, or 0 when planned
  is 0. Spec §6.4.

### `lib/calc/charges`

- `machineryCharge(billableQty, basis, rate, maundKg?) => number`
  Basis is `RateBasis` (`per_bag | per_50kg | per_kg | per_maund |
  fixed`, from `lib/types/database`). `per_bag` treats the quantity as
  a bag count; `per_50kg` divides kg by 50; `per_kg` multiplies kg;
  `fixed` returns the rate; `per_maund` REQUIRES an explicit
  client-approved `maundKg` and throws without it — no universal maund
  value exists (spec §3.1, §19). Spec §7.2.
- `packingCharge(bags, ratePerBag) => number`
  Bags × rate. Spec §8.2.
- `bagClosing(opening, purchased, returnedIn, consumed, damaged,
  adjustments) => number`
  Opening + purchased + returns − consumed − damaged + signed
  adjustments, rounded to whole bags. Spec §8.2.

### `lib/calc/ledger`

- `ledgerRunningBalance(prevBalance, inwardQty, outwardQty) => number`
  Single-row: prev + inward − outward. Sequences are tested by folding
  rows. Spec §5.2.
- `stockBalanceFromRows(rows: { inward_qty, outward_qty }[]) => number`
  Sum of inward − outward. Spec §5.2.
- `daybookClosing(openingBalance, receipts, payments) => number`
  Opening + receipts − payments. Spec §12.3. Transfers in/out fold
  into receipts/payments respectively (spec §12.3).
- `cashRunningBalance(prevBalance, debit, credit) => number`
  Single-row: prev + debit − credit.

### `lib/calc/money`

- `roundTo(value, decimals = 2)`, `roundMoney(value)`,
  `roundWeight(value)`, `add(a, b, decimals = 2)`,
  `sub(a, b, decimals = 2)`, `mul(a, b, decimals = 2)`.
  Non-finite input to `roundTo` maps to 0. Spec §1.2.

### `lib/calc/payroll`

- `dailyPay(presentDays, halfDays, dailyRate, halfDayFactor = 0.5)`
  (present + half × factor) × rate. Spec §13.4.
- `monthlyProratedPay(monthlySalary, eligibleDays, daysInMonth)`
  Salary × eligible / daysInMonth; daysInMonth is the real calendar
  length, never assumed 30; throws when 0. Spec §13.4.
- `overtimePay(hours, ratePerHour)`, `pieceRatePay(units, ratePerUnit)`.
- `advanceRecovery(advanceBalance, requestedRecovery)`
  min(balance, requested) — never more than still owed. Spec §13.3.
- `computePayroll(input) => PayrollBreakdown`
  Input: `basePay`, optional `overtimeHours`, `overtimeRatePerHour`,
  `bonus`, `advanceBalance`, `advanceRecoveryRequested`, `deductions`.
  Gross = base + overtime + bonus; net = gross − advance − deductions,
  floored at 0. Spec §13.3.

## Missing module (tests written, BLOCKED)

### `lib/calc/finance` — does not exist yet

Needed by `tests/unit/finance-definitions.test.ts`:

- `invoiceOutstanding(invoiceTotal, allocatedPayments, credits) =>
  number`
  Total − allocated payments − credits. ONLY payments explicitly
  allocated to this invoice are subtracted (spec §10.2: no
  auto-blanket allocation). NOT clamped: a negative result is an
  unapplied advance (spec §11.2).
- `netProfit({ serviceRevenue, productSalesRevenue, cogs,
  packagingCost, operatingExpenses, payroll }) => number`
  (service + sales) − (cogs + packaging + operating + payroll).
  Receipts are NOT an input (spec §15.1: a receipt is cash collection,
  not revenue); purchases are NOT an input (only approved COGS hits
  P&L). IMPLEMENTATION_PLAN Module 9.
- `packagingCost(consumedBags, costPerBag) => number`
  Consumed × cost. Purchase cost must not be added again (spec §15.1:
  no bag double-count).

## Open gaps found while writing tests (for backend owners)

1. **Previous balance in payroll** (spec §13.3 lists it as a payroll
   component): `computePayroll` has no `previousBalance` input. Until
   the backend decides its sign convention (owed-to vs owed-by
   employee), no test asserts it — see ACCEPTANCE.md item P-13.
2. **Maund conversion factor**: deliberately NOT in `lib/calc` — it is
   a client-confirmation item (spec §19). Callers must supply the
   approved kg-per-maund; tests use 40 only as an example value.
3. **Money rounding rules** (spec §1.2): 2-decimal rounding is assumed
   throughout; the client-approved currency/rounding policy is still
   an open confirmation item.
