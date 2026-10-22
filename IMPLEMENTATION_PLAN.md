# Seed Godown & Processing ERP (`arco`)
## Comprehensive System Specification & Implementation Plan
**Single-Role Architecture (Administrator / Master Operator)**  
*Engineered from the Functional Specification & Architectural Lessons from `restaurantmanagement`*

---

## 1. Executive Summary & Core Architectural Principle

The **Seed Godown & Processing System** is a purpose-built ERP replacing complex Excel-based godown spreadsheets into an atomic, relational, single-ledger business management application. It tracks physical grain movements from **Receiving (Inward)** $\rightarrow$ **Machinery / Processing & Recipes** $\rightarrow$ **Bardana / Treatment & Packing** $\rightarrow$ **Dispatch (Gate Pass)**, along with parallel commercial workflows (**Purchases, Vendor Payables, Customer Billing, Cashbook / Daybook, Attendance & Payroll, and P&L**).

### Core Design Rules
1. **Single-Role Architecture**: Per explicit user requirement, the application operates under a **Single Unified Role (`Administrator / Master Operator`)**. 
   - No permission barriers, role switching, or hidden views.
   - The operator has full control to create, post, cancel (via reversal), adjust, and review every module.
   - Every transaction still captures an audit trail (`created_by`, `posted_at`, `status`).
2. **Single Transaction Ledger**: 
   - Stock balances, customer/vendor balances, packaging inventory, and cash positions are computed directly from immutable ledger transaction rows (`stock_ledger`, `party_ledger`, `cash_ledger`).
   - Manual balance overrides and independent totals that can drift are strictly prohibited.
3. **Draft $\rightarrow$ Posted $\rightarrow$ Reversed Flow**:
   - `Draft`: Freely editable, does not alter stock, cash, or balances.
   - `Posted`: Applies stock/balance mutations atomically; locks editing.
   - `Cancelled / Reversed`: Never silently deleted. Requires a reversal entry with a mandatory reason code.

---

## 2. Technical Stack & Architectural Blueprint

Inheriting and upgrading the design language and technical foundations from `restaurantmanagement`:

* **Framework**: Next.js 16+ (App Router) with TypeScript
* **Runtime**: React 19 + Node.js
* **Styling**: Tailwind CSS v4 (`@theme inline`) with OKLCH Color Palette
  - **Primary**: Deep Forest Emerald (`#0B2F24` / `oklch(0.52 0.16 155)`)
  - **Accent**: Golden Harvest Amber (`#D99726` / `oklch(0.72 0.18 75)`)
  - **Surfaces**: Frosted glassmorphism (`backdrop-blur-xl`), ambient aurora gradients, subtle glowing borders
* **Icons**: `lucide-react`
* **UI Components**: Radix / Base UI primitives (Dialog, Tooltip, Dropdown, Tabs, Sidebar)
* **Print Engine**: Dedicated `@media print` CSS optimized for:
  - **A4 Gate Pass Document** (with driver details, item table, and dual signatures)
  - **Inward Receiving Slips**
  - **Batch Production Run Sheets**
  - **Customer Statement & Cash Daybook**
* **Database & ORM**: PostgreSQL via Supabase SSR (`@supabase/ssr`, `@supabase/supabase-js`)
* **State & Server Actions**: Server Actions (`app/actions/*`) for transactional integrity and automatic route revalidation (`revalidatePath`).

---

## 3. Database Schema Design (Single-Ledger Model)

### 3.1 Master Data Tables
* `godowns`: `id (uuid)`, `code (text)`, `name (text)`, `is_active (boolean)`, `created_at`
* `products`: `id (uuid)`, `code (text)`, `name (text)`, `category ('raw_seed' | 'intermediate' | 'finished_seed' | 'by_product' | 'packaging')`, `default_unit ('kg' | 'bag' | 'maund')`, `weight_per_bag (numeric)`, `min_stock (numeric)`, `is_active (boolean)`
* `parties`: `id (uuid)`, `code (text)`, `name (text)`, `contact_person (text)`, `phone (text)`, `address (text)`, `type ('customer' | 'supplier' | 'both' | 'source')`, `opening_balance (numeric)`, `balance_type ('receivable' | 'payable')`, `is_active (boolean)`
* `machines`: `id (uuid)`, `code (text)`, `name (text)`, `processing_type (text)`, `capacity_kg (numeric)`, `notes (text)`, `is_active (boolean)`
* `packaging_types`: `id (uuid)`, `name (text)`, `capacity_kg (numeric)`, `cost_per_bag (numeric)`, `reorder_level (numeric)`, `is_active (boolean)`
* `employees`: `id (uuid)`, `code (text)`, `full_name (text)`, `designation (text)`, `phone (text)`, `pay_type ('daily' | 'monthly' | 'piece_rate')`, `base_rate (numeric)`, `is_active (boolean)`
* `expense_categories`: `id (uuid)`, `name (text)`, `description (text)`

### 3.2 Inventory & Stock Ledgers
* `stock_ledger` (The Source of Truth):
  - `id (uuid)`
  - `date (timestamptz)`
  - `voucher_type ('inward' | 'batch_consume' | 'batch_produce' | 'gatepass' | 'transfer' | 'adjustment')`
  - `voucher_id (uuid)`
  - `voucher_no (text)`
  - `godown_id (uuid, FK godowns)`
  - `product_id (uuid, FK products)`
  - `party_id (uuid, FK parties, optional)` -- stock owner/source
  - `inward_qty (numeric)`
  - `outward_qty (numeric)`
  - `unit (text)`
  - `running_balance (numeric)`
  - `notes (text)`
  - `created_by (uuid)`

* `incoming_goods`: `id`, `voucher_no`, `date`, `party_id`, `godown_id`, `bilty_no`, `vehicle_no`, `driver_name`, `status ('draft' | 'posted' | 'reversed')`, `total_bags`, `total_weight`, `notes`
* `incoming_goods_items`: `id`, `incoming_id`, `product_id`, `bags`, `gross_weight`, `net_weight`, `unit`, `rate`, `total_amount`
* `godown_transfers`: `id`, `transfer_no`, `date`, `from_godown_id`, `to_godown_id`, `product_id`, `quantity`, `unit`, `reason`, `status`

### 3.3 Processing & Production
* `recipes`: `id`, `code`, `name`, `version (integer)`, `output_product_id`, `expected_yield_pct`, `packaging_type_id`, `status ('active' | 'retired')`, `notes`
* `recipe_items`: `id`, `recipe_id`, `product_id`, `required_ratio_pct`, `unit`
* `production_batches`: `id`, `batch_no`, `date`, `recipe_id`, `machine_id`, `godown_id`, `planned_size_kg`, `actual_input_kg`, `actual_output_kg`, `byproduct_kg`, `waste_kg`, `yield_pct`, `status ('draft' | 'posted' | 'reversed')`, `notes`
* `machinery_jobs`: `id`, `job_no`, `date`, `customer_id`, `machine_id`, `processing_type`, `input_product_id`, `input_weight`, `output_weight`, `waste_weight`, `rate_basis ('per_bag' | 'per_50kg' | 'per_kg' | 'fixed')`, `rate`, `service_charge`, `is_customer_owned (boolean)`, `status`
* `packing_records`: `id`, `date`, `job_or_batch_id`, `packaging_type_id`, `bags_count`, `capacity_kg`, `total_packed_kg`, `packing_rate`, `packing_charge`, `status`

### 3.4 Gate Pass & Dispatches
* `gate_passes`: `id`, `pass_no`, `date`, `customer_id`, `godown_id`, `vehicle_no`, `driver_name`, `driver_phone`, `transporter`, `order_ref`, `status ('draft' | 'posted' | 'reversed' | 'returned')`, `total_bags`, `total_weight`, `notes`
* `gate_pass_items`: `id`, `gate_pass_id`, `product_id`, `bags`, `net_weight`, `gross_weight`, `remarks`

### 3.5 Commercials, Cashbook & Daybook
* `purchases`: `id`, `purchase_no`, `date`, `vendor_id`, `invoice_ref`, `godown_id`, `total_amount`, `paid_amount`, `balance_amount`, `status`
* `purchase_items`: `id`, `purchase_id`, `product_id`, `item_type ('seed' | 'packaging')`, `quantity`, `unit_price`, `line_total`
* `customer_invoices`: `id`, `invoice_no`, `date`, `customer_id`, `source_type ('machinery_job' | 'packing' | 'sale')`, `source_id`, `total_amount`, `paid_amount`, `balance_amount`, `status`
* `customer_receipts`: `id`, `receipt_no`, `date`, `customer_id`, `payment_method ('cash' | 'bank' | 'online')`, `amount`, `reference_no`, `notes`
* `expenses`: `id`, `expense_no`, `date`, `category_id`, `payee`, `amount`, `payment_method ('cash' | 'bank')`, `description`
* `cash_ledger`: `id`, `date`, `voucher_type ('receipt' | 'expense' | 'purchase_pay' | 'payroll')`, `voucher_id`, `account ('cash' | 'bank')`, `debit (numeric)`, `credit (numeric)`, `balance (numeric)`

### 3.6 Attendance & Payroll
* `attendance`: `id`, `date`, `employee_id`, `status ('present' | 'absent' | 'half_day' | 'leave' | 'holiday')`, `overtime_hours`, `notes`
* `payroll_periods`: `id`, `month (integer)`, `year (integer)`, `employee_id`, `eligible_days`, `base_salary`, `overtime_pay`, `bonus`, `advances_recovered`, `deductions`, `net_payable`, `paid_amount`, `status ('draft' | 'approved' | 'paid')`

---

## 4. Navigation & Directory Structure

```
arco/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx              # Sidebar + Frosted Glass Header + Aurora Mesh
│   │   ├── dashboard/page.tsx      # Command Center KPIs & Quick Action Triggers
│   │   ├── inward/page.tsx         # Incoming Goods & Receiving Vouchers
│   │   ├── inventory/
│   │   │   ├── stock/page.tsx      # Live Stock Levels by Godown
│   │   │   ├── ledger/page.tsx     # Full Movement Stock Ledger
│   │   │   └── transfers/page.tsx  # Inter-Godown Transfers
│   │   ├── production/
│   │   │   ├── batches/page.tsx    # Batch Processing & Yield Tracker
│   │   │   └── recipes/page.tsx    # Formula / Recipe Manager
│   │   ├── machinery/page.tsx      # Machinery Jobs & Service Processing
│   │   ├── packing/page.tsx        # Final Unit, Bardana Usage & Packing
│   │   ├── gatepass/page.tsx       # Gate Pass Generator & Register
│   │   ├── purchases/page.tsx      # Vendor Invoices & Bardana Orders
│   │   ├── billing/page.tsx        # Customer Charges, Invoicing & Receipts
│   │   ├── daybook/page.tsx        # Expenses & Daily Cashbook
│   │   ├── payroll/page.tsx        # Daily Attendance & Monthly Payroll Runs
│   │   ├── reports/page.tsx        # Stock, P&L, Bardana & Party Ledgers
│   │   └── masters/page.tsx        # Products, Godowns, Parties, Machines
│   ├── actions/                    # Server Actions (Atomic DB Operations)
│   │   ├── masters.ts
│   │   ├── inward.ts
│   │   ├── inventory.ts
│   │   ├── production.ts
│   │   ├── gatepass.ts
│   │   ├── finance.ts
│   │   └── payroll.ts
│   ├── globals.css                 # OKLCH Emerald/Gold palette & Print styles
│   └── layout.tsx
├── components/
│   ├── app-sidebar.tsx             # Collapsible single-role navigation sidebar
│   ├── expensive-ambient-mesh.tsx  # Luxury background gradient aurora
│   ├── print/
│   │   ├── gatepass-print.tsx      # Print-ready A4 Gate Pass with Signatures
│   │   ├── inward-slip-print.tsx   # Inward Receiving Slip
│   │   └── voucher-print.tsx       # Receipt & Payment Vouchers
│   ├── ui/                         # shadcn/ui components (buttons, dialogs, tables)
│   └── shared/                     # StatsCard, DateRangeFilter, StatusBadge
└── lib/
    ├── supabase/                   # Supabase SSR client & server helpers
    ├── types/                      # TypeScript database interfaces
    └── utils.ts                    # Formatters (currency, kg/bags, dates)
```

---

## 5. Module Implementation Details

### Module 1: Dashboard & Live Operation Center
- **Key Metrics**:
  - `Today's Inward`: Received quantity in kg and total bags today.
  - `Today's Production`: Output volume, by-products generated, average yield %.
  - `Today's Dispatches`: Outgoing gate passes dispatched and metric tons moved.
  - `Cash & Bank Balance`: Real-time liquidity based on the cash ledger.
  - `Receivables vs Payables`: Customer balances due vs vendor bills pending.
  - `Stock Alerts`: Low-stock warnings and bardana (packaging bag) inventory alerts.
- **Quick Actions**: Direct modal triggers for *New Inward*, *New Gate Pass*, *Batch Execution*, *Machinery Job*, *Cash Receipt*, and *Expense Entry*.

### Module 2: Inward Godown Management
- Dynamic multi-row input for mixed product truckloads.
- Auto-calculation: $\text{Net Weight} = \text{Gross Weight} - (\text{Bags} \times \text{Tare Weight})$.
- Immediate stock ledger insertion on `Post` with reference to supplier/source and target godown.
- Instant A4/receipt printable receiving voucher.

### Module 3: Seeds Recipe & Production Batches
- **Formulas**: Set standard ratios (e.g. 70% Seed A + 30% Seed B) with expected yield targets.
- **Batch Processing**:
  - Automatically calculates required components from planned batch size.
  - Checks live stock availability; alerts if godown stock is insufficient.
  - On Posting:
    1. Deducts input component stock from `stock_ledger`.
    2. Adds finished output and by-product stock to `stock_ledger`.
    3. Calculates actual yield %: $\frac{\text{Usable Output}}{\text{Total Input}} \times 100$.

### Module 4: Machinery Jobs & Service Billing
- Service jobs for third-party or customer-owned raw seeds.
- Differentiates customer-owned seed from enterprise-owned stock.
- Rate basis options: *Per Bag*, *Per 50 kg*, *Per kg*, *Per Maund*, or *Fixed Job Fee*.
- Automatically links to customer receivable upon posting.

### Module 5: Bardana (Packaging) & Final Packing
- Packaging consumption tracking: Every packed bag deducts from the Bardana Inventory.
- Accounts for damaged bags and packing fees.
- Dedicated **Bardana Ledger** showing Opening, Purchased, Consumed, Damaged, and Closing bag counts.

### Module 6: Gate Pass & Outgoing Goods
- **Dedicated Dispatch Authorization**:
  - Captures Customer, Destination, Vehicle No, Driver Name & Contact, Transporter.
  - Item lines with bags, net weight, and remarks.
- **Stock Guard**: Disallow posting if available godown stock is below the requested quantity.
- **Print Layout**:
  - High-precision A4 printable layout.
  - Watermarked voucher with prominent Pass Number, vehicle badge, item table, driver signature, and authorized stamp area.

### Module 7: Daybook, Cashbook & Expenses
- Tracks all daily receipts, vendor settlements, and categorized operational expenses.
- Reconciles cash and bank accounts on a daily basis:
  $$\text{Closing Balance} = \text{Opening Balance} + \text{Receipts In} - \text{Payments Out}$$

### Module 8: Attendance & Monthly Payroll
- Unified attendance grid: Mark Present, Absent, Half-Day, or Leave with one click.
- Automatic salary proration for daily and monthly staff.
- Advances recovery and balance tracking.

### Module 9: Comprehensive Reporting & Financials
- **Stock Movement Ledger**: Full audit trail of every inward, batch output, transfer, and gate pass.
- **Customer & Vendor Ledgers**: Statement of account with debit, credit, and running balance.
- **Profit & Loss Statement**:
  $$\text{Net Result} = (\text{Service Revenue} + \text{Seed Sales}) - (\text{COGS} + \text{Packaging Cost} + \text{Operating Expenses} + \text{Payroll})$$

---

## 6. Phased Implementation Roadmap

```
Phase 1: Foundation & App Shell
├── Install UI & styling dependencies (@supabase/ssr, lucide-react, clsx, tw-merge)
├── Configure Tailwind v4 OKLCH Agricultural theme & Ambient Mesh
└── Implement AppSidebar and responsive navigation shell

Phase 2: Database Schema & Masters
├── Define database schema types in lib/types/database.ts
├── Build Supabase SSR client/server utilities
└── Develop Master Data CRUD: Products, Godowns, Parties, Machines, Bardana, Employees

Phase 3: Inventory Foundation & Inward Goods
├── Implement Incoming Goods voucher with multi-item lines
├── Implement single-transaction Stock Ledger posting logic
└── Build printable Inward Receiving Slip

Phase 4: Recipe, Batch Production & Machinery Jobs
├── Build Recipe / Formula Builder
├── Implement Production Batch Execution with automated yield and stock deductions
├── Implement Machinery Jobs with configurable rate basis (50kg / bag / maund)
└── Implement Bardana / Packaging tracking and bag deduction

Phase 5: Gate Pass & Outgoing Dispatch
├── Implement Gate Pass voucher generation and stock deduction
├── Implement Gate Pass cancellation & return workflow
└── Build the print-ready A4 Gate Pass layout with dual signature sections

Phase 6: Finance, Daybook & Payroll
├── Build Purchase vouchers (Raw stock & Bardana)
├── Build Customer Invoices & Receipts with automatic allocation
├── Implement Categorized Expenses & Daily Cashbook / Daybook
└── Implement Employee Attendance Grid and Payroll Calculator

Phase 7: Dashboard, Reports Center & Final Polish
├── Build Executive Command Center with live KPI widgets
├── Build Stock Summary, Bardana Ledger, Customer Statements, and P&L Reports
├── Implement PDF / Print exports
└── Comprehensive audit testing and verification
```

---

## 7. Developer Acceptance & Verification Checklist

- [ ] **No Draft Impact**: Unposted draft vouchers never modify stock or financial balances.
- [ ] **Exact-Once Posting**: Every posted voucher creates immutable ledger rows exactly once. Double-clicks or retries are blocked.
- [ ] **Unique Gate Pass Numbers**: Gate passes have strictly non-reusable sequential numbers.
- [ ] **Stock Guard**: Outward gate passes and production batches are prevented from driving stock into negative balances.
- [ ] **Traceability**: Every stock ledger and cash ledger row points back to its source voucher and timestamp.
- [ ] **Print Perfection**: Inward slips, Gate Passes, and Daybooks format cleanly on standard A4 paper without interface clutter.
- [ ] **Single-Role Simplicity**: All operations are accessible immediately from one unified command console without permission roadblocks.
