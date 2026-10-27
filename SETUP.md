# Seed Godown & Processing ERP — Setup & Deployment Notes (Finance / Payroll / Auth)

This document covers the backend-finance slice: `app/actions/finance.ts`,
`app/actions/payroll.ts`, `app/actions/auth.ts`, `lib/audit.ts` and
`supabase/schema-finance.sql`. It assumes the base schema in
`supabase/schema.sql` is applied first.

> **Role-model decision (read this first).** The client PDF (§17) wins
> over `IMPLEMENTATION_PLAN.md`'s single-role note. The plan's
> "Administrator / Master Operator" is the **Owner/Admin** role; the
> other six PDF roles are enforced **server-side** at the top of every
> sensitive action via `requireRole()` in `app/actions/auth.ts`. Hiding
> a button in the UI is never enforcement. The app still works
> immediately out of the box because exactly **one** Owner/Admin
> operator is seeded (§3 below) — after that, other operators are added
> by that owner, never by a back door.

## 1. Create a Supabase project

1. Create a project at <https://supabase.com/dashboard> (any region close
   to the business; note the hosting region for the data-privacy record).
2. In **Project Settings → API**, copy the Project URL and the anon /
   publishable key.
3. Copy `.env.example` to `.env.local` and fill in the two values:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. **No service_role key is used.** Server actions use the signed-in
   operator's session (Supabase SSR cookie client), so RLS and the
   server-side role checks both apply. Never put a service_role key in
   a `NEXT_PUBLIC_*` variable or commit it anywhere.

## 2. Apply the migrations, in this order

In the Supabase SQL editor (or `psql` / Supabase CLI), run every file
below, in this exact order. Every migration after step 2 is idempotent
(safe to re-run), unless its own header says otherwise. Two ordering
rules are load-bearing — violating them breaks the app, it does not
just warn:

- **`migration-gatepass-receiver.sql` (step 12): its `ALTER TYPE …
  ADD VALUE` statement must run OUTSIDE a transaction block.** Some
  SQL editors wrap a whole file in one transaction; run that statement
  on its own first, then the rest of the file.
- **Apply steps 8 and 14–18 BEFORE deploying app code that calls them.**
  Until `migration-atomic-posting.sql` is applied, post actions fail
  cleanly with "function does not exist" and write nothing; until the
  wave-2 migrations (steps 14–18) are applied, the code that writes
  the new columns/tables fails instead of degrading. The full
  wave-2 code set must therefore only be deployed after this whole
  list is applied.

1. `supabase/schema.sql` — masters, stock ledger, cash ledger, vouchers.
2. `supabase/schema-finance.sql` — purchases, invoices, receipts,
   allocations, payments, expenses extensions, party/bardana ledgers,
   attendance, payroll, profiles, audit log, opening balances,
   cash accounts, configurable settings, and RLS policies.

`schema-finance.sql` never edits `schema.sql`; it only `ALTER TABLE …
ADD COLUMN IF NOT EXISTS` on the two pre-existing tables it extends
(`cash_ledger`, `expenses`). It is idempotent for types and columns
(`IF NOT EXISTS` / `ON CONFLICT DO NOTHING` guards), but the RLS
policy block will error if re-run after policies already exist — apply
it once per project, or drop the policies first on a re-run.

3. `supabase/migration-stock-summary-rpc.sql` — performance only, no data
   change: a `stock_summary()` grouped-sum function so the dashboard,
   stock, production, and gate-pass pages stop shipping the whole ledger
   to aggregate it in code. Recommended: without it the app still works
   (it falls back to the JS aggregation automatically), just slower as
   the ledger grows.
4. `supabase/migration-rls-base-tables.sql` — **security, required
   before go-live.** Enables RLS on every base table from `schema.sql`
   (masters, stock/cash ledgers, vouchers, doc numbering, idempotency
   keys) with role-scoped policies, and defines the
   `public.current_app_role()` lookup the policies use. Idempotent
   (safe to re-run).
5. `supabase/migration-rls-finance-replace.sql` — **security, required
   before go-live, apply after step 4.** Drops the old finance
   "authenticated full" policies from `schema-finance.sql` (which let
   any authenticated user rewrite `profiles`, including their own
   role) and replaces them with role-scoped policies: profiles
   writable only by Owner/Admin, finance/payroll writes restricted by
   role, audit_log inserts restricted to recognised operators and
   reads restricted to Owner/Admin and Accountant. Idempotent (safe
   to re-run).
6. `supabase/migration-stock-partial-returns.sql` — gate-pass partial
   returns: pass status (`partially_returned` / `returned`) is derived
   from the `gate_pass_returns` rows; no new quantity columns.
7. `supabase/migration-production-fixes.sql` — production-chain fixes
   (QA blocker B8 + production majors), including the single-active-
   recipe index. Exception to the idempotency note: that index fails
   if the live database already holds two active versions of one
   recipe code — retire the duplicates first, then re-run.
8. `supabase/migration-atomic-posting.sql` — **apply BEFORE deploying
   app code that calls it (see the rule above).** Exact-once posting:
   `atomic_stock_transition()` (ledger identity + one-transaction
   post/flip/idempotency key) for inward, gate passes, transfers,
   adjustments and machinery jobs.
9. `supabase/migration-settings-processing-types.sql` — the
   `processing_types` master list plus party tax fields and employee
   payment-preference fields.
10. `supabase/migration-finance-fields.sql` — finance field additions
    (receipt purpose / received-by, purchase and invoice fields).
11. `supabase/migration-finance-cogs-approvals.sql` — the
    `pl_cogs_approvals` table (accountant-approved COGS per period)
    with RLS for that new table only.
12. `supabase/migration-gatepass-receiver.sql` — gate-pass receiver /
    dispatch / prepared-by / approved-by / rejection fields, the
    `awaiting_approval` status, return condition + restock decision,
    and per-line bag type. **Run its `ALTER TYPE … ADD VALUE`
    outside a transaction block (see the rule above).**
13. `supabase/migration-production-job-lines.sql` — multi-line
    machinery jobs, packing lines, treatment inputs (record-only),
    batch/recipe fields, with RLS for the new tables only.
14. `supabase/migration-stock-inward-fields.sql` — inward header
    fields (`received_by`, `by_hand`, `nature`) and the line `lot_no`
    column the inward action already writes tolerantly.
15. `supabase/migration-attachments.sql` — reference-only attachment
    columns (`attachment_url` + `attachment_note`, both nullable) on
    `incoming_goods`, `gate_passes` and `expenses`. No storage bucket
    and no storage policy is created — attachments are links to
    documents stored elsewhere, never uploads.
16. `supabase/migration-atomic-lot.sql` — replaces
    `atomic_stock_transition()` with a version identical to step 8
    except that it also persists each line's optional `lot_number`
    JSON key into `stock_ledger.lot_number`. Step 8's file itself is
    left untouched because it is already applied on live databases.
17. `supabase/migration-production-cost-ledger.sql` — the gated
    `production_cost_ledger` table (exactly one of `batch_id` /
    `job_id` per row) with RLS for that new table only. Writing is
    gated by the `cost_ledger_enabled` setting (§10), default off.
18. `supabase/migration-header-actors.sql` — nullable `created_by` +
    `updated_by` TEXT columns on the header tables (`incoming_goods`,
    `gate_passes`, `production_batches`, `machinery_jobs`,
    `packing_records`, `purchases`, `customer_invoices` (= "invoices"),
    `customer_receipts` (= "receipts"), `vendor_payments`, `expenses`,
    `payroll_periods`). Tables that already carry a `created_by` UUID
    column (`purchases`, `vendor_payments`, `payroll_periods`,
    `expenses`) keep it; only `updated_by` is added there. No RLS
    policy is touched.

> **Live verification of steps 4–5 (cannot be done from this repo —
> there is no live database here).** After applying, in the live
> project: (a) sign in as a Storekeeper and confirm a stock write
> succeeds, a payroll write fails, and a direct PostgREST `UPDATE` on
> `profiles` fails; (b) sign in as a user with no `profiles` row and
> confirm every action fails closed; (c) sign in as Owner/Admin and
> confirm a stock write, a role change, and an audit read all succeed;
> (d) confirm effective policies (`select * from pg_policies where
> schemaname = 'public'`) and GRANTs (`\z` in psql) match the two
> migration files. Also confirm in **Authentication → Sign-ups**
> that self-registration is OFF: the code now denies profile-less
> users everywhere, but the toggle itself is a project setting this
> repo cannot set.

> **Demo data — read before delivery.** `supabase/schema.sql` ships NO
> demo business data (the old §5 sample godowns, products, machines,
> parties, and employees were removed). But a live database created from
> an OLD copy of the schema already contains those sample rows, and
> removing them from the file does not remove them from that database.
> Before delivery, delete the sample rows from the live project (they
> are identifiable by code — godowns `GDN-01`–`GDN-03`, products
> `RAW-WHT-01`, `RAW-COT-02`, `FIN-WHT-01`, `BYP-PHOK-01`, `BYP-BRK-02`,
> packaging `BAG-50-PP`, `BAG-100-JT`, `BAG-25-LD`, machines
> `MCH-GRD-01`, `MCH-GRV-02`, `MCH-TRT-03`, parties `CUST-001`,
> `SUPP-001`, `BOTH-001`, employees `EMP-001`–`EMP-003`) — but ONLY
> if those codes are still the untouched samples; if the business has
> started using a code for real data, keep that row and rename it
> instead. After cleanup, every value the app shows comes from real
> masters, vouchers, or ledgers.

## 3. Seed the single Owner/Admin operator

Supabase Auth users cannot be invented by SQL, so seeding is two steps
(the operator chooses a real email/password — **no credentials are
invented or shipped in this repo**):

1. **Create the Auth user.** In Supabase **Authentication → Users →
   Add user**, create a user with the operator's real email and a
   strong password (or "Send invite" so they set their own). Copy the
   new user's UUID from the Users list.
2. **Link the profile row.** In the SQL editor, run (replace the UUID
   and name):

```sql
insert into public.profiles (id, role, display_name)
values ('<PASTE-AUTH-USER-UUID-HERE>', 'owner_admin', 'Owner / Admin')
on conflict (id) do update set role = 'owner_admin', is_active = true;
```

3. Sign in with that user. Until then, every sensitive action fails
   closed with "Authentication required" — the app never silently runs
   as admin.
4. The owner then adds further operators the same way (Auth user first,
   then a `profiles` row with their role), or via `setUserRole()` for
   role changes (audited, reason mandatory; the last active
   Owner/Admin cannot be demoted, so the business cannot lock itself
   out).

Suggested first-run masters (via the existing masters UI / SQL):
one `cash_accounts` row per real account (e.g. `CASH-01` Main Cash,
`BANK-01` Bank Account), expense categories, and opening balances
recorded once in the masters (see §6).

## 4. Role matrix (server-side enforcement)

| Action group | Allowed roles |
|---|---|
| Finance writes: purchases, invoices, receipts, payments, expenses, transfers, opening balances, cash accounts | Owner/Admin, Accountant |
| Daybook, party/vendor statements, P&L | Owner/Admin, Accountant |
| Plain lists (purchases, invoices, receipts, expenses, bardana ledger) | any signed-in operator |
| Attendance, payroll runs, approvals, adjustments, advances | Owner/Admin, HR/payroll |
| Payroll payments | Owner/Admin, HR/payroll, Accountant |
| Payroll register / unpaid salaries / attendance reads | Owner/Admin, HR/payroll, Accountant |
| Profiles, role changes, payroll-rule changes | Owner/Admin only |
| Stock writes: inward, transfers, adjustments, gate passes | Owner/Admin, Storekeeper |
| Production writes: recipes, recipe versions, batches | Owner/Admin, Production operator |
| Machinery writes: service-job drafts, posts, reversals | Owner/Admin, Production operator |
| Master-data writes: godowns, products, parties, machines, packaging types, employees | Owner/Admin only |
| Stock/master reads (lists, single rows, ledger, summary) | any signed-in operator |
| Everything else write-like | never Read-only manager |

A signed-in user with no `profiles` row, an inactive profile, or an
unrecognised role string is denied by every gate — `getCurrentActor`
never defaults to Owner/Admin. Legacy `owner` / `admin` role spellings
are treated as Owner/Admin wherever the app checks a role, and the
last-admin guard in `setUserRole` counts all three spellings, so the
business cannot demote its way into a lockout through a legacy row.

Salary detail, profit/loss and bank/cash reports are therefore never
visible to Storekeeper / Production / Gate / Read-only roles through
these actions, even if a page links to them.

## 5. RLS approach (stated, with the reason)

**Implemented:** RLS is **enabled on every table** — the finance
tables from `schema-finance.sql` (as replaced by
`migration-rls-finance-replace.sql`) and the base tables from
`schema.sql` (via `migration-rls-base-tables.sql`). Policies are
role-scoped, not "any authenticated user": reads are open to any
signed-in operator for business tables, while writes require the
role(s) in the §4 matrix, resolved through
`public.current_app_role()` (a SECURITY DEFINER lookup on `profiles`
via `auth.uid()`). The two layers are complementary: RLS stops a
direct PostgREST call from bypassing the app, while `requireRole()`
in the actions is the primary gate the UI flows through.

Two deliberate exceptions, both documented in the migration files:
(1) `packaging_types` UPDATE also allows Production operator, because
batch posting consumes/restores `current_stock` there — creating a
packaging type stays Owner/Admin only. (2) Draft-cleanup DELETEs are
allowed only on still-draft voucher headers (and, for recipes, on a
header with no lines yet); posted history can never be deleted
through a policy. `audit_log` has no UPDATE/DELETE policy and its
UPDATE/DELETE grants are revoked in the finance migration, so it stays
append-only. The old "authenticated full" policy text in
`schema-finance.sql` is superseded by the replacement migration and
must not be re-applied on its own after step 5 of §2.

## 6. Posting rules (the invariants the code protects)

- **Draft → posted → reversed.** Drafts change no ledger. Posting
  applies effects exactly once: creation is idempotent on
  `clientToken` (pass a UUID per submit; double-clicks/retries return
  the original row), and posting only runs on a draft — a repeat post
  returns the posted row unchanged. Reversals need a mandatory reason
  and insert compensating ledger rows; posted rows are never deleted.
- **Purchases.** Seed lines move stock and bardana lines move packaging
  **only** when `receipt_status = 'received'`. A `bill_only` purchase
  creates the payable and nothing else. Returns/credit notes link to
  the original purchase and reduce the payable (and stock/bardana,
  when the goods were received).
- **Receipts are collections, not revenue.** A receipt debits cash and
  credits the receivable, with **explicit** allocation to invoices;
  any remainder is an unapplied advance on the receipt row. Nothing
  auto-blanket-allocates.
- **Payments stay distinct.** Purchase settlement, payroll settlement
  and expense payments are separate `settlement_kind` values and
  separate allocation targets. Paying a vendor never touches stock.
- **Unpaid expenses are payables, not cash outflow.** A `credit`
  expense posts no cash row; it is settled later via `allocatePayment`
  with `targetType: 'expense'`.
- **Daybook.** Per cash/bank account: `closing = opening + receipts −
  payments` (transfers in/out are inside receipts/payments and are
  also reported separately). A transfer debits one account and credits
  the other with the same `transfer_no`; it is never revenue/expense.
- **Party ledger sign convention.** `running_balance > 0` = the party
  owes the business (receivable); `< 0` = the business owes the party
  (payable). Opening = the party master's signed opening balance plus
  ledger entries before the range.
- **Opening balances are recorded once.** `opening_balances` is the
  auditable evidence record; the live opening lives in the master
  (`parties.opening_balance`, `cash_accounts.opening_balance`). Reports
  read masters + ledger history and must **not** add
  `opening_balances` again, or openings double-count.
- **P&L (§15).** Revenue = **posted invoices only** (service revenue
  from machinery/packing invoices, product sales from sale invoices);
  receipts are excluded. COGS is an **accountant-supplied approved
  valuation** passed to `getPL` as `cogsAmount` — when it is absent
  the report says so and shows 0 rather than silently using purchases
  as cost. Packaging cost = consumed-bag cost only (bag purchases are
  never added, or purchase + consumption double-count). Payroll is a
  separate line. See "What remains" for the still-unconfirmed items.
- **Payroll.** One attendance row per employee/date; corrections need
  a reason + audit. Payable days come from the configurable
  `payroll_rules` setting (weekly off, half-day factor, paid/unpaid
  leave & holidays, monthly fixed vs prorated, proration denominator).
  Each payroll row snapshots `applied_rate` at run time — later master
  rate changes never rewrite history. Approval locks the period;
  changes after approval use audited `adjustPayroll` (approved, unpaid
  only) or reversal. Multiple partial payments are allowed; each keeps
  date/method/reference. `paid_amount` is maintained incrementally
  (direct `payPayroll` payments and `allocatePayment` payroll
  allocations both append to `payroll_payments` history).

## 7. Run and verify locally

```bash
cp .env.example .env.local   # then fill in real values (or dummy values
                             # for a compile-only check — see below)
npm install
npx tsc --noEmit
npm run build
```

With dummy env values the build passes but every action returns
"Supabase is not configured" or "Authentication required" at runtime —
that is the fail-closed behaviour, not a bug. With a real project and
the seeded owner signed in, the acceptance checks are: draft changes
nothing; posting twice changes balances once; a receipt raises cash
once and never raises revenue; a vendor payment lowers the payable and
cash but not stock; daybook opening + receipts − payments = closing
for one account; a reversed voucher stays visible with its reason.

## 8. Backup / restore

- **Supabase:** enable daily backups in the project (Pro plan) or
  schedule `pg_dump` against the project's Postgres connection string
  (stored in the operator's password manager, never in the repo).
  Backups contain Auth users, profiles, ledgers and the audit log —
  treat backup files as production data.
- **Restore test (required before go-live):** restore a backup into a
  *separate* staging project, run the migrations check (§2), sign in
  as the seeded owner, and re-run the §7 acceptance checks against a
  known period. Record the date and result; an untested backup is not
  a backup. **Status: still a live operation — no restore test has
  been run against a real project from this repo, because there is no
  live database here. Do not mark it done until a dated, signed-off
  restore run exists.**
- **Staff training:** train each role on its own pages only (a
  Storekeeper never needs the payroll screens), using the staging
  project restored above, and record a per-role sign-off. **Status:
  still a live operation — no training sign-off exists yet.** Until
  it does, go-live is not complete even if every migration is applied.
- **Code:** this repo is the source of truth for schema and actions;
  never hand-edit production tables without a matching migration file
  committed here.

## 9. What remains before go-live

1. **Live Supabase project + real env values** (nothing is invented
   here); apply both schemas; seed the owner (§3); verify RLS on the
   pre-existing tables (§5).
2. **Client/accountant sign-off (spec §19, must not be guessed):**
   business model (§15.2: own seed / customer-owned / both), COGS
   valuation method, whether packing fees include bag cost, payroll
   rules (weekly off, paid leave, half-day, monthly proration
   denominator, overtime rate), and whether credit expenses are used.
   The current `payroll_rules` / `pl_config` seed values are
   placeholders, and `getPL` warns loudly until COGS is supplied.
3. **UI wiring:** the 14 dashboard pages still run on the
   localStorage prototype; they need to call these actions (out of
   scope for this slice — do not wire pages without the owner's word
   on the page work).
4. **Auth UX:** a sign-in page + session timeout handling (Supabase
   Auth session expiry; the spec asks for session timeout and
   encrypted connections — HTTPS is automatic on Vercel/Supabase).
5. **Core-module tables the P&L intentionally does not guess:**
   machinery-job / packing charges that have not been invoiced are not
   counted as revenue — revenue is recognised on the posted invoice.
   If the business wants job-posting = revenue, that is a §15.2
   decision to record, then invoice creation from jobs becomes the
   bridge (invoices already carry `source_type`/`source_id` links).
6. **Backup restore test** (§8) and staff training sign-off — both
   still live operations (see §8 and §11); neither is done by
   applying migrations or by this document.

## 10. Settings reference (app_settings keys)

Every business value that used to be hard-coded lives as a row in
`app_settings` (value is JSONB). The Settings page is the only place an
operator changes them; reads go through `getSettingsSnapshot()`, which
resolves each key against its default below. Writes are Owner/Admin
only and audited. Nothing here invents a business value: every key
below resolves to its stated default when its row is absent, and an
"unconfirmed" default means "not decided yet" — the code must never
guess past it.

| Key | Default | What it gates |
|---|---|---|
| `company` | `null` | Company name, address, phone, email, logo URL printed on slips and passes. Null = not set yet; prints omit it. |
| `business_model` | `unconfirmed` | Own seed / customer-owned / both (`own`, `customer`, `both`). While `unconfirmed`, no model is assumed anywhere. |
| `valuation_method` | `unconfirmed` | Stock valuation method (`last_purchase_cost`, `average_cost`). The reports valuation tab reads exactly this key via `getSettingsSnapshot()` and passes it to `getStockValuation(method)`; while `unconfirmed`, valuation returns method-not-set with no number. It also gates cost-ledger ingredient amounts (§11 of the code, `lib/cost-ledger.ts`). |
| `currency` | `PKR` | Currency code shown on money values. |
| `session_timeout_minutes` | `60` | Idle sign-out delay; `0` disables idle sign-out. Negative / non-integer values are rejected. |
| `cutover_date` | `null` | Go-live cutover date (ISO `YYYY-MM-DD`); the Import page shows a banner for it. Empty = no cutover set. |
| `gatepass_approval_required` | `false` | When `true`, posting a gate pass only submits it for approval (`awaiting_approval`) with NO stock change; only an Owner/Admin approval deducts stock. When `false`, posting dispatches directly. |
| `variance_tolerance_pct` | `null` | Batch input-variance tolerance (%). Null = disabled. When set, a batch whose input variance exceeds it cannot post without a recorded variance reason. |
| `bilty_duplicate_check` | `warn` | Duplicate bilty handling on inward: `off` (skip), `warn` (proceed with a warning), `block` (reject). |
| `cost_ledger_enabled` | `false` | **Wave-2 gate.** When `false` (the default), batch/job posts write NO `production_cost_ledger` rows — current behaviour. When `true`, posts record packaging cost, input/output quantities, and the job processing charge (see the migration in §2 step 17). |

Two rows the code reads but this page deliberately does NOT own:
`payroll_rules` (payroll module) and `pl_config` (finance module) are
not in `SETTING_KEYS` and `updateAppSetting()` rejects them. Note the
stale wording in one finance comment that calls `pl_config` the
valuation source: the reports valuation tab does NOT read `pl_config`
— it reads `valuation_method` (verified in the wave-2 program).

## 11. Client decision log (spec §19 — all open, none decided)

Every row below is **open** until the client decides it. Until then the
app runs on the configurable default in the right-hand column — a
neutral default, never a hard-coded business value and never a guessed
decision. When a decision lands, record the date and signature here
and change the setting (or the code comment that points at it) in the
same change; do not silently edit the default.

| # | Open item | Configurable default until decided | Decision | Date | Signature |
|---|---|---|---|---|---|
| 1 | Business model (§19 / §15.2): own seed, customer-owned, or both | `business_model = unconfirmed`; no model assumed | _open_ | | |
| 2 | COGS / stock valuation method (§19 / §15.2) | `valuation_method = unconfirmed`; valuation shows no number, COGS shows 0 with a warning | _open_ | | |
| 3 | Payroll rules: weekly off, paid leave, half-day factor, monthly proration denominator, overtime rate | `payroll_rules` placeholder values; payroll snapshots `applied_rate` per run so a later decision never rewrites history | _open_ | | |
| 4 | Whether credit expenses are used | Credit expenses allowed but require a vendor (unpaid = payable, no cash row) | _open_ | | |
| 5 | One-bag / two-bag handling (bag-count conventions on receipt, packing and dispatch) | Bag counts are recorded per line as entered; no one-bag/two-bag conversion is applied anywhere | _open_ | | |
| 6 | Stage transfers (which processing stages move stock between godowns / stages, and at what point) | No automatic stage transfer is posted; transfers are explicit vouchers only | _open_ | | |
| 7 | Packing-fee bag-cost inclusion: does the packing fee include the bag's own cost, or is bag cost separate? | Packing charge = bags × rate only; bag (bardana) consumption is costed separately from its ledger rows, never double-counted | _open_ | | |
| 8 | Treatment inventory impact: do packing treatments consume treatment stock? | Treatments are record-only on packing records; no treatment stock is deducted | _open_ | | |
| 9 | Gate-pass approver definition: who, by role, approves an awaiting-approval pass? | Interim: Owner/Admin only (`OWNER_ONLY` via the existing `requireRole` helper); no new role invented | _open_ | | |
| 10 | Historical-transaction import scope: which old vouchers / periods are imported, and from what cutover date? | `cutover_date = null` (no cutover set); Import page shows its banner only once a date is set | _open_ | | |
| 11 | Job-posting = revenue? (machinery/packing charges not yet invoiced) | Not counted as revenue — revenue is recognised on the posted invoice only | _open_ | | |
| 12 | Backup restore test + staff training sign-off (live operations, §8) | Neither is done; go-live is incomplete until both have dated sign-offs | _open_ | | |
