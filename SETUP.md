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
| Everything else write-like | never Read-only manager |

Salary detail, profit/loss and bank/cash reports are therefore never
visible to Storekeeper / Production / Gate / Read-only roles through
these actions, even if a page links to them.

## 5. RLS approach (stated, with the reason)

**Recommended and implemented:** RLS is **enabled** on every new table
in `schema-finance.sql` with an authenticated-user policy
(`auth.role() = 'authenticated'`), and server-side role checks in the
actions are the real enforcement. The two layers are complementary:
RLS stops anonymous / stolen-anon-key access to the tables, while
`requireRole()` stops an authenticated Storekeeper from posting a
payroll run.

**Why RLS is not enabled on the pre-existing tables here:** tables from
`schema.sql` (stock ledger, cash ledger, masters) are owned by the
sibling core modules; enabling RLS on them from this slice could break
their actions before they add their own role gates. Before go-live,
enable RLS on those tables too with the same authenticated policy and
re-run the core modules' checks. Additionally, after first deploy, a
Supabase owner should revoke `UPDATE`/`DELETE` on `audit_log` for the
authenticated role in the dashboard — the table's policies already
grant only INSERT/SELECT, so this is belt-and-braces for append-only.

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
