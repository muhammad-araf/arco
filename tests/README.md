# Tests — Seed Godown & Processing ERP

Run the suite (no live database needed; these are pure-function unit tests):

```sh
npm test
```

The runner is Vitest 3 (devDependency, `test` script in `package.json`).
Config lives in `tests/vitest.config.ts` so that this QA work touches no
files outside `tests/` and `package.json` / `package-lock.json`.

## Layout

- `tests/unit/*.test.ts` — unit tests for the pure calculations in
  `lib/calc/*` (see `CALC_CONTRACT.md` for the exact signatures tested).
- `tests/unit/finance-definitions.test.ts` — P&L and allocation tests
  against `lib/calc/finance`, which does **not exist yet** (see below).
  This file is written-but-blocked until the backend adds that module.
- `tests/ACCEPTANCE.md` — traceability: every acceptance item in the
  functional spec (§22, §4.3, §6.5, §9.5, §12.4, §15, §16) and
  `IMPLEMENTATION_PLAN.md` §7, mapped to the test(s) covering it, with
  status `covered` / `pending-backend` / `pending-UI`.
- `tests/CALC_CONTRACT.md` — the exact `lib/calc` function signatures
  these tests assume, and the open gaps found while writing them.

## Current status (Phase 1)

`lib/calc/` is **not on `main` or on this branch** — it is committed on
the sibling `work/ui-print` branch (commit `b316583`: `weights`,
`charges`, `ledger`, `money`, `payroll`, `conversions`). On this branch
`npm test` therefore fails at import time (module absent) — that is the
honest blocked state, not a test bug. The same suite was verified
against the real `work/ui-print` copy in a throwaway detached worktree:
**63/63 tests pass across 7 files** (see `ACCEPTANCE.md` §H).
`finance-definitions.test.ts` fails at import time everywhere because
`lib/calc/finance` (invoice outstanding, P&L, packaging cost) has not
been written on any branch yet. Once both modules land on the
integration branch, re-run `npm test` with no test changes expected
beyond reconciling the signatures in `CALC_CONTRACT.md`.
