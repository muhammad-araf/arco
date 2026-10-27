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

In the Supabase SQL editor (or `psql` / Supabase CLI), run:

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
  a backup.
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
6. **Backup restore test** (§8) and staff training sign-off.
