# Data dictionary — Seed Godown & Processing ERP

Source of truth for column lists is the schema itself:
`supabase/schema.sql`, `supabase/schema-finance.sql`, and the
`supabase/migration-*.sql` files (apply order in `SETUP.md` §2).
This document names every entity and its key fields, and expands the
in-app dictionary tab (Migration page → "Data Dictionary & Excel
Mapping") beyond the importable types: voucher headers, ledgers,
finance, payroll and audit entities are all covered here. Where a
column below was added by a migration rather than the base schema, the
migration file is named. Nothing here invents a field: if a field is
not in the schema or a migration, it is not listed.

Conventions used everywhere: `id` is a UUID primary key; voucher
numbers (`voucher_no`, `pass_no`, `batch_no`, `job_no`, `invoice_no`,
`receipt_no`, `payment_no`, `expense_no`, `transfer_no`,
`adjustment_no`, `return_no`) are unique, non-reusable document
numbers issued by `doc_numbering` (see `next_doc_number()`); `status`
on a voucher is `draft` → `posted` → `reversed` (gate passes also use
`awaiting_approval`, `returned`, `partially_returned`); money is
NUMERIC rounded to 2 decimals; weights are NUMERIC kg rounded to 2
decimals; `party_id` NULL means company-owned stock (see
`docs/posting-rules.md`).

## In-app dictionary tab (Migration page) — Excel mapping

These are the mappings the Migration page itself shows. They are the
starting point for historical imports; the import scope itself is still
a client decision (SETUP.md §11, item 10).

| Excel sheet | Excel column | System field | Target table |
|---|---|---|---|
| IN GOODS | Source / Supplier | `party_id` | `incoming_goods` |
| IN GOODS | Bilty No / Truck | `bilty_no` / `vehicle_no` | `incoming_goods` |
| MACHINERY | 50-Unit Basis Rate | `rate_basis` (`per_50kg`) | `machinery_jobs` |
| FINAL UNIT | 1-Bag / 2-Bag Bardana | `packaging_type_id` & `bags_count` | `packing_records` |
| OUT GOING | Gate Pass No | `pass_no` (unique, non-reusable) | `gate_passes` |
| P.ID P-L | Net Profit Calc | `net_profit = Revenue − COGS − Overheads` | reports (computed, not a table) |

Importable master/stock shapes (same page): products (`code`,
`name`, `category`, `default_unit`, `weight_per_bag`, `min_stock`,
`notes`); parties (`code`, `name`, `type`, `contact_person`,
`phone`, `address`, `opening_balance`, `balance_type`, `notes`);
opening stock (`product_code`, `godown_code`, `quantity`,
`as_of`, `source_note`).

## Masters

- **godowns** — `code`, `name`, `address`, `is_active`.
- **products** — `code`, `name`, `category`, `default_unit`,
  `weight_per_bag`, `min_stock`, `notes`, `is_active`. Inactive
  products can never be received, consumed or dispatched (server
  check, not just UI filtering).
- **parties** — `code`, `name`, `type` (`customer` | `supplier` |
  `both` | `source`), `contact_person`, `phone`, `address`,
  `opening_balance` (+ `balance_type`), `notes`, `is_active`.
  Migration-added: tax fields
  (`migration-settings-processing-types.sql`).
- **machines** — `code`, `name`, `processing_type`,
  `operator_name`, `notes`, `is_active`.
- **packaging_types** (bardana) — `code`, `name`, `capacity_kg`,
  `current_stock` (bags), `reorder_level`, `cost_per_bag`,
  `is_active`.
- **employees** — `code`, `full_name`, `designation`, `phone`,
  `pay_type` (`monthly` | `daily` | …), `base_rate`,
  `joining_date`, `is_active`.
  Migration-added: payment-preference fields
  (`migration-settings-processing-types.sql`).
- **processing_types** — `name`, `is_active`
  (`migration-settings-processing-types.sql`); the controlled list of
  processing types. Empty is a valid starting state — forms fall back
  to free text.
- **expense_categories** — `name`, `description`, `is_operating`,
  `is_active`.
- **cash_accounts** — `code`, `name`, `account_kind` (`cash` | `bank`
  | `online`), `opening_balance`, `is_active`.
- **profiles** — `id` (= Supabase Auth user id), `role` (see
  SETUP.md §4), `display_name`, `is_active`. One row per operator;
  no row = every action fails closed.
- **app_settings** — `key`, `value` (JSONB), `updated_by`,
  `updated_at`. Keys are documented in SETUP.md §10; `payroll_rules`
  and `pl_config` belong to their own modules and are not settings
  keys.
- **doc_numbering** — `series`, `prefix`, `last_no`. Advanced only
  by the atomic `next_doc_number()` RPC, never by page code.
- **idempotency_keys** — `client_token`, `scope`, `voucher_type`,
  `voucher_id`, `voucher_no`, `result` (JSONB). The replay record for
  double-submit protection.

## Stock vouchers and lines

- **incoming_goods** — `voucher_no`, `date`, `party_id`, `godown_id`,
  `bilty_no`, `vehicle_no`, `driver_name`, `driver_phone`,
  `transport_company`, `total_bags`, `total_net_weight_kg`,
  `total_value`, `notes`, `is_customer_owned`, `owner_party_id`,
  `status`, `posted_at`. Migration-added: `received_by`, `by_hand`,
  `nature` (`migration-stock-inward-fields.sql`); `attachment_url`,
  `attachment_note` (`migration-attachments.sql`); `created_by`,
  `updated_by` (`migration-header-actors.sql`).
- **incoming_goods_items** — `incoming_id`, `product_id`,
  `bags_count`, `gross_weight_kg`, `tare_weight_kg`,
  `net_weight_kg`, `rate_per_unit`, `total_value`.
  Migration-added: `lot_no` (`migration-stock-inward-fields.sql`).
- **gate_passes** — `pass_no`, `date`, `customer_id`, `godown_id`,
  `destination`, `vehicle_no`, `driver_name`, `driver_phone`,
  `transporter`, `order_ref`, `total_bags`, `total_weight_kg`,
  `notes`, `status`, `dispatched_at`. Migration-added: `receiver_name`,
  `receiver_contact`, `dispatch_mode`, `prepared_by`, `approved_by`,
  `rejection_reason`, `reversal_reason`, `return_reason`,
  `returned_at`, `reversed_at`
  (`migration-gatepass-receiver.sql`); `attachment_url`,
  `attachment_note` (`migration-attachments.sql`); `created_by`,
  `updated_by` (`migration-header-actors.sql`).
- **gate_pass_items** — `gate_pass_id`, `product_id`, `bags_count`,
  `net_weight_kg`, `gross_weight_kg`, `remarks`, `party_id` (line
  owner scope), `packaging_type_id` (bag type for the line).
- **gate_pass_returns** — `gate_pass_id`, `product_id`, `party_id`,
  `qty_kg`, `reason`, `date`. Migration-added: `condition`,
  `restock_decision` (`accepted` = quantity returns to stock,
  `rejected` = recorded but never restocked).
- **godown_transfers** — `transfer_no`, `date`, `from_godown_id`,
  `to_godown_id`, `product_id`, `party_id`, `qty_kg`, `reason`,
  `notes`, `status`, `posted_at`, `reversal_reason`, `reversed_at`.
- **stock_adjustments** — `adjustment_no`, `date`, `godown_id`,
  `product_id`, `party_id`, `qty_kg` (signed), `reason`, `approver`,
  `notes`, `status`, `posted_at`, `reversal_reason`, `reversed_at`.

## Production

- **recipes** — `code`, `name`, `version`, `output_product_id`,
  `packaging_type_id`, `status` (`active` | `retired`). Immutable
  once created: an edit retires the version and inserts a new row
  with the same code and `version + 1`. Batches record
  `recipe_id` + `recipe_version_used` at draft time.
- **recipe_items** — `recipe_id`, `product_id`,
  `required_ratio_pct`.
- **production_batches** — `batch_no`, `date`, `recipe_id`,
  `recipe_version_used`, `machine_id`, `godown_id`,
  `planned_size_kg`, `actual_input_kg`, `actual_output_kg`,
  `output_product_id`, `byproduct_product_id`, `byproduct_kg`,
  `waste_kg`, `yield_pct`, `packaging_type_id`, `bags_consumed`,
  `packing_rate_per_bag`, `damaged_bags`, `is_customer_owned`,
  `owner_party_id`, `customer_id`, `order_ref`, `operator_name`,
  `variance_reason`, `variances` (stored per-input JSON),
  `status`, `posted_at`. Migration-added: batch/recipe fields
  (`migration-production-job-lines.sql`); `created_by`,
  `updated_by` (`migration-header-actors.sql`).
- **production_batch_inputs** — `batch_id`, `product_id`,
  `planned_qty_kg`, `actual_qty_kg`, `party_id`.
- **production_batch_outputs** — `batch_id`, `product_id`,
  `output_type` (`finished` | `byproduct`), `qty_kg`.
- **machinery_jobs** — `job_no`, `date`, `customer_id`,
  `machine_id`, `godown_id`, `processing_type`, `operator_name`,
  `input_product_id`, `input_weight_kg`, `output_product_id`,
  `output_weight_kg`, `byproduct_product_id`,
  `byproduct_weight_kg`, `waste_weight_kg`, `bags`, `maund_kg`,
  `rate_basis`, `rate`, `service_charge` (fixed at draft time),
  `is_customer_owned`, `status`, `posted_at`, `reversal_reason`,
  `reversed_at`. Migration-added: `operator_name` and header
  by-product fields (`migration-production-job-lines.sql`);
  `created_by`, `updated_by` (`migration-header-actors.sql`).
- **machinery_job_lines** (`migration-production-job-lines.sql`) —
  `job_id`, `line_no`, `input_product_id`, `input_qty_kg`,
  `output_product_id`, `output_qty_kg`, `byproduct_product_id`,
  `byproduct_qty_kg`.
- **packing_records** — `packing_no`, `date`, `job_or_batch_id`,
  `output_product_id`, `packaging_type_id`, `bags_count`,
  `capacity_kg`, `total_packed_kg`, `packing_rate`,
  `packing_charge`, `damaged_bags`, `party_id`,
  `processing_type`, `source_product_id`, `net_weight_kg`,
  `processing_amount`, `manual_packing_fee`, `notes`, `status`.
  Migration-added: `created_by`, `updated_by`
  (`migration-header-actors.sql`).
- **packing_lines** (`migration-production-job-lines.sql`) —
  `packing_record_id`, `line_no`, `packaging_type_id`, `bags`,
  `packed_kg`, `charge`. A batch packing writes exactly one line;
  the standalone form may write many.
- **packing_treatment_inputs** (`migration-production-job-lines.sql`)
  — `packing_record_id`, `material_name`, `qty`, `unit`, `note`.
  Record-only: treatments never deduct treatment stock (SETUP.md
  §11, item 8).
- **production_cost_ledger** (`migration-production-cost-ledger.sql`,
  gated — see SETUP.md §10 `cost_ledger_enabled`) — `batch_id`
  (nullable), `job_id` (nullable), `cost_type`, `amount`
  (nullable), `qty_kg` (nullable), `basis`, `recorded_at`. CHECK:
  exactly one of `batch_id` / `job_id` is set.

## Ledgers (append-only history; never edited, only compensated)

- **stock_ledger** — `date`, `voucher_type`, `voucher_id`,
  `voucher_no`, `godown_id`, `product_id`, `party_id`,
  `inward_qty`, `outward_qty`, `unit`, `running_balance`,
  `lot_number`, `notes`, `created_by`, `entry_kind` (`post` |
  `reversal` | `return`), `line_no`. The
  (`voucher_type`, `voucher_id`, `entry_kind`, `line_no`) unique
  identity is what makes posting exact-once.
- **cash_ledger** — `date`, `voucher_type`, `voucher_id`,
  `voucher_no`, `account` (`cash` | `bank` | `online`), `description`,
  `debit`, `credit`, `running_balance`, `created_by`
  (added by `schema-finance.sql`), `line_no` (added by
  `migration-atomic-posting.sql`).
- **party_ledger** — `date`, `party_id`, `entry_type`
  (`opening` | `purchase` | `purchase_return` | `invoice` |
  `receipt` | `payment` | `expense_credit` | `expense_payment` |
  `payroll` | `adjustment` | `reversal`), `voucher_type`,
  `voucher_id`, `voucher_no`, `debit`, `credit`,
  `running_balance`, `notes`, `created_by`, `line_no` (added by
  `migration-atomic-posting.sql`). Sign: `running_balance > 0` =
  party owes the business; `< 0` = business owes the party.
- **bardana_ledger** — `date`, `packaging_type_id`, `godown_id`,
  `voucher_type`, `voucher_id`, `voucher_no`, `in_qty`, `out_qty`,
  `running_balance`, `total_cost`, `notes`, `created_by`. Genuine
  consumption voucher types are only `packing` and `batch_packing`
  (see `lib/calc/finance-valuation.ts`).

## Finance

- **purchases** — `purchase_no`, `date`, `vendor_id`,
  `invoice_ref`, `godown_id`, `receipt_status` (`received` |
  `bill_only`), `discount_amount`, `tax_amount`, `total_amount`,
  `paid_amount`, `balance_amount`, `status`, `posted_at`,
  `reversal_reason`, `created_by`. Migration-added: finance fields
  (`migration-finance-fields.sql`); `updated_by`
  (`migration-header-actors.sql`).
- **purchase_items** — `purchase_id`, `product_id`,
  `packaging_type_id`, `item_type` (`seed` | `packaging`),
  `bags_count`, `quantity`, `unit`, `unit_price`, `line_total`.
- **purchase_returns** / **purchase_return_items** — `return_no`,
  `purchase_id`, `date`, `reason`, `status`, `posted_at`; items link
  to the original `purchase_item_id`.
- **customer_invoices** — `invoice_no`, `date`, `customer_id`,
  `source_type` (`machinery_job` | `packing` | `product_sale`),
  `source_id`, `source_ref`, `total_amount`, `paid_amount`,
  `balance_amount`, `status`, `posted_at`, `reversal_reason`,
  `created_by`. Migration-added: `updated_by`
  (`migration-header-actors.sql`).
- **invoice_lines** — `invoice_id`, `description`, `product_id`,
  `quantity`, `unit_price`, `line_total`, `source_type`,
  `source_id`.
- **customer_receipts** — `receipt_no`, `date`, `customer_id`,
  `cash_account_id`, `account`, `payment_method`, `amount`,
  `unapplied_amount`, `reference_no`, `notes`, `status`,
  `posted_at`, `reversal_reason`, `created_by`. Migration-added:
  `purpose` (`migration-finance-fields.sql`); `updated_by`
  (`migration-header-actors.sql`).
- **invoice_allocations** — `receipt_id`, `invoice_id`, `amount`.
  Explicit only — nothing auto-blanket-allocates.
- **vendor_payments** — `payment_no`, `date`, `vendor_id`,
  `cash_account_id`, `account`, `payment_method`, `amount`,
  `settlement_kind` (`purchase` | `payroll` | `expense`),
  `reference_no`, `notes`, `status`, `posted_at`,
  `reversal_reason`, `created_by`. Migration-added: `updated_by`
  (`migration-header-actors.sql`).
- **payment_allocations** — `payment_id`, `target_type`
  (`purchase` | `expense` | `payroll`), `target_id`, `amount`.
- **cash_transfers** — `transfer_no`, `date`, `from_account_id`,
  `to_account_id`, `amount`, `reference_no`, `notes`,
  `created_by`.
- **expenses** — `expense_no`, `date`, `category_name`,
  `category_id`, `payee`, `vendor_id`, `amount`, `payment_method`,
  `cash_account_id`, `settlement` (`paid` | `credit`), `location`,
  `paid_amount`, `balance_amount`, `description`, `status`,
  `posted_at`, `created_by`. Migration-added: `attachment_url`,
  `attachment_note` (`migration-attachments.sql`); `updated_by`
  (`migration-header-actors.sql`).
- **pl_cogs_approvals** (`migration-finance-cogs-approvals.sql`) —
  `period_year`, `period_month`, `amount`, `basis`, `note`,
  `approved_by`. The accountant-supplied COGS per period.
- **opening_balances** — `balance_kind`, `entity_key`, `party_id`,
  `cash_account_id`, `product_id`, `packaging_type_id`,
  `godown_id`, `employee_id`, `amount`, `as_of`, `source_note`,
  `approved_by`, `created_by`. Evidence record only: reports read
  masters + ledger history and must NOT add this again (openings
  would double-count).

## Payroll

- **attendance** — `employee_id`, `date`, `status`
  (`attendance_status_enum`: present / half / leave / absent /
  holiday), `overtime_hours`,
  `notes`, `correction_reason`, `created_by`, `updated_by`. One
  row per employee/date; corrections need a reason + audit.
- **payroll_periods** — `employee_id`, `period_start`,
  `period_end`, `month`, `year`, `pay_type`, `applied_rate`
  (snapshotted at run time), `payable_days`, `present_days`,
  `half_days`, `leave_days`, `absent_days`, `holiday_days`,
  `overtime_hours`, `base_pay`, `overtime_pay`, `bonus`,
  `advance_recovery`, `deductions`, `previous_balance`,
  `gross_pay`, `net_payable`, `paid_amount`, `balance_amount`,
  `status` (`draft` | `approved` | `reversed`), `approved_by`,
  `approved_at`, `reversal_reason`, `created_by`.
  Migration-added: `updated_by` (`migration-header-actors.sql`).
- **payroll_payments** — `payroll_id`, `date`, `amount`,
  `payment_method`, `cash_account_id`, `account`, `reference_no`,
  `notes`, `created_by`. Multiple partial payments allowed; each
  keeps date/method/reference.
- **employee_advances** — `employee_id`, `date`, `amount`,
  `recovered_amount`, `status`, `notes`, `created_by`.

## Audit

- **audit_log** — `created_at`, `user_id`, `user_email`, `action`,
  `entity_type`, `entity_id`, `voucher_no`, `before_summary`
  (JSONB), `after_summary` (JSONB), `reason`, `metadata` (JSONB).
  Append-only: no UPDATE/DELETE policy and grants revoked.
