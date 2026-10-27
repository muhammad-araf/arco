export type ProductCategory =
  | "raw_seed"
  | "intermediate"
  | "finished_seed"
  | "by_product"
  | "packaging"

export type ProductUnit = "kg" | "bag" | "maund"

export type PartyType = "customer" | "supplier" | "both" | "source"

export type VoucherStatus = "draft" | "posted" | "reversed" | "returned" | "partially_returned"

export type RateBasis = "per_bag" | "per_50kg" | "per_kg" | "per_maund" | "fixed"

export type PayType = "daily" | "monthly" | "piece_rate"

export type AttendanceStatus = "present" | "absent" | "half_day" | "leave" | "holiday"

// ================= MASTER DATA =================
export interface Godown {
  id: string
  code: string
  name: string
  capacity_metric_tons?: number
  address?: string
  is_active: boolean
  created_at: string
}

export interface Product {
  id: string
  code: string
  name: string
  category: ProductCategory
  default_unit: ProductUnit
  weight_per_bag?: number
  min_stock?: number
  is_active: boolean
  notes?: string
  created_at: string
}

export interface Party {
  id: string
  code: string
  name: string
  contact_person?: string
  phone?: string
  address?: string
  type: PartyType
  opening_balance: number
  balance_type: "receivable" | "payable"
  current_balance?: number
  is_active: boolean
  notes?: string
  created_at: string
}

export interface Machine {
  id: string
  code: string
  name: string
  processing_type: string // e.g., 'Grading', 'Gravity Separator', 'Chemical Treatment', 'Drying'
  capacity_kg_per_hour?: number
  operator_name?: string
  is_active: boolean
  notes?: string
  created_at: string
}

export interface PackagingType {
  id: string
  code: string
  name: string // e.g. '50kg PP Bag', '100kg Jute Bag', '25kg Seed Bag'
  capacity_kg: number
  cost_per_bag: number
  reorder_level: number
  current_stock: number
  is_active: boolean
  created_at: string
}

export interface Employee {
  id: string
  code: string
  full_name: string
  designation: string
  phone?: string
  pay_type: PayType
  base_rate: number // daily rate or monthly salary
  is_active: boolean
  joining_date?: string
  created_at: string
}

export interface ExpenseCategory {
  id: string
  name: string
  description?: string
  is_active: boolean
}

// ================= STOCK LEDGER (CORE INTEGRITY) =================
export interface StockLedgerEntry {
  id: string
  date: string
  voucher_type: "inward" | "batch_consume" | "batch_produce" | "gatepass" | "transfer" | "adjustment"
  voucher_id: string
  voucher_no: string
  godown_id: string
  godown_name?: string
  product_id: string
  product_name?: string
  party_id?: string
  party_name?: string
  lot_number?: string
  inward_qty: number
  outward_qty: number
  unit: ProductUnit
  running_balance: number
  notes?: string
  created_by?: string
  created_at: string
}

// ================= INWARD GOODS =================
export interface IncomingGoodsItem {
  id: string
  incoming_id: string
  product_id: string
  product_name?: string
  bags_count: number
  gross_weight_kg: number
  tare_weight_kg: number
  net_weight_kg: number
  rate_per_unit?: number
  total_value?: number
  notes?: string
}

export interface IncomingGoodsVoucher {
  id: string
  voucher_no: string
  date: string
  party_id: string
  party_name?: string
  godown_id: string
  godown_name?: string
  bilty_no?: string
  vehicle_no?: string
  driver_name?: string
  driver_phone?: string
  transport_company?: string
  status: VoucherStatus
  total_bags: number
  total_net_weight_kg: number
  total_value?: number
  notes?: string
  items: IncomingGoodsItem[]
  created_at: string
  posted_at?: string
}

// ================= RECIPES & PRODUCTION BATCHES =================
export interface RecipeItem {
  id: string
  recipe_id: string
  product_id: string
  product_name?: string
  required_ratio_pct: number // e.g. 70%
  unit: ProductUnit
}

export interface Recipe {
  id: string
  code: string
  name: string
  version: number
  output_product_id: string
  output_product_name?: string
  expected_yield_pct: number
  packaging_type_id?: string
  packaging_name?: string
  status: "active" | "retired"
  notes?: string
  items: RecipeItem[]
  created_at: string
}

export interface ProductionBatch {
  id: string
  batch_no: string
  date: string
  recipe_id?: string
  recipe_name?: string
  machine_id: string
  machine_name?: string
  godown_id: string
  godown_name?: string
  planned_size_kg: number
  actual_input_kg: number
  actual_output_kg: number
  byproduct_kg: number
  waste_kg: number
  yield_pct: number
  status: VoucherStatus
  notes?: string
  created_at: string
  posted_at?: string
}

// ================= MACHINERY / PROCESSING JOBS =================
export interface MachineryJob {
  id: string
  job_no: string
  date: string
  customer_id: string
  customer_name?: string
  machine_id: string
  machine_name?: string
  processing_type: string
  input_product_id: string
  input_product_name?: string
  input_weight_kg: number
  output_product_id?: string
  output_product_name?: string
  output_weight_kg: number
  waste_weight_kg: number
  /** Actual bag count the charge was computed from (per_bag basis). */
  bags?: number | null
  /** Client-approved kg per maund the charge was computed from. */
  maund_kg?: number | null
  rate_basis: RateBasis
  rate: number
  service_charge: number
  is_customer_owned: boolean
  status: VoucherStatus
  payment_status: "unbilled" | "invoiced" | "paid"
  notes?: string
  created_at: string
}

// ================= PACKING & BARDANA =================
export interface PackingRecord {
  id: string
  packing_no: string
  date: string
  reference_type: "batch" | "machinery_job" | "general"
  reference_id?: string
  output_product_id: string
  output_product_name?: string
  packaging_type_id: string
  packaging_name?: string
  bags_packed: number
  bag_capacity_kg: number
  total_packed_kg: number
  packing_rate: number
  packing_charge: number
  damaged_bags: number
  status: VoucherStatus
  notes?: string
  created_at: string
}

// ================= GATE PASS & OUTGOING =================
export interface GatePassItem {
  id: string
  gate_pass_id: string
  product_id: string
  product_name?: string
  bags_count: number
  net_weight_kg: number
  gross_weight_kg?: number
  remarks?: string
}

export interface GatePass {
  id: string
  pass_no: string
  date: string
  customer_id: string
  customer_name?: string
  destination?: string
  godown_id: string
  godown_name?: string
  vehicle_no: string
  driver_name: string
  driver_phone?: string
  transporter?: string
  order_ref?: string
  status: VoucherStatus
  total_bags: number
  total_weight_kg: number
  notes?: string
  items: GatePassItem[]
  created_at: string
  dispatched_at?: string
}

// ================= PURCHASES & VENDOR PAYABLES =================
export interface PurchaseItem {
  id: string
  purchase_id: string
  product_id?: string
  product_name?: string
  item_type: "seed" | "packaging"
  packaging_type_id?: string
  quantity: number
  unit: string
  unit_price: number
  line_total: number
}

export interface PurchaseVoucher {
  id: string
  purchase_no: string
  date: string
  vendor_id: string
  vendor_name?: string
  invoice_ref?: string
  godown_id: string
  godown_name?: string
  total_amount: number
  paid_amount: number
  balance_amount: number
  status: VoucherStatus
  notes?: string
  items: PurchaseItem[]
  created_at: string
}

// ================= BILLING, RECEIPTS & CASHBOOK =================
export interface CustomerInvoice {
  id: string
  invoice_no: string
  date: string
  customer_id: string
  customer_name?: string
  source_type: "machinery_job" | "packing" | "product_sale"
  source_id?: string
  total_amount: number
  paid_amount: number
  balance_amount: number
  status: "unpaid" | "partially_paid" | "paid" | "cancelled"
  notes?: string
  created_at: string
}

export interface CustomerReceipt {
  id: string
  receipt_no: string
  date: string
  customer_id: string
  customer_name?: string
  amount: number
  payment_method: "cash" | "bank" | "online"
  reference_no?: string
  allocated_invoice_id?: string
  is_advance: boolean
  notes?: string
  created_at: string
}

export interface ExpenseVoucher {
  id: string
  expense_no: string
  date: string
  category_id: string
  category_name?: string
  payee: string
  amount: number
  payment_method: "cash" | "bank"
  description: string
  status: VoucherStatus
  created_at: string
}

export interface CashLedgerEntry {
  id: string
  date: string
  voucher_type: "receipt" | "expense" | "purchase_pay" | "payroll" | "transfer"
  voucher_id: string
  voucher_no: string
  account: "cash" | "bank"
  debit: number // cash in
  credit: number // cash out
  running_balance: number
  description: string
  created_at: string
}

// ================= ATTENDANCE & PAYROLL =================
export interface AttendanceRecord {
  id: string
  date: string
  employee_id: string
  employee_name?: string
  status: AttendanceStatus
  overtime_hours: number
  notes?: string
  created_at: string
}

export interface PayrollPeriod {
  id: string
  month: number
  year: number
  employee_id: string
  employee_name?: string
  eligible_days: number
  base_salary: number
  overtime_amount: number
  bonus: number
  advances_deducted: number
  other_deductions: number
  net_payable: number
  paid_amount: number
  balance: number
  status: "draft" | "approved" | "paid"
  created_at: string
}

// ================= DASHBOARD METRICS =================
export interface DashboardMetrics {
  todayInwardKg: number
  todayInwardBags: number
  todayProductionKg: number
  todayYieldPct: number
  todayOutgoingKg: number
  todayGatePasses: number
  cashBalance: number
  bankBalance: number
  receivablesTotal: number
  payablesTotal: number
  lowStockItemsCount: number
  recentMovements: StockLedgerEntry[]
}

// ================= BACKEND-CORE ADDITIONS (appended 2026-10-24) =================
// Additive only: no existing interface above was edited. These types cover
// the backend action layer (app/actions/*) and the schema appendix tables.
// Server-action inputs are typed here so the UI team can import them
// instead of re-declaring shapes (the action files themselves only export
// async functions, per Next.js "use server" rules).

/** Standard server-action return shape: every action returns this. */
export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Sequential document numbering (supabase/schema.sql appendix). */
export interface DocNumbering {
  series: string;
  prefix: string;
  last_no: number;
  updated_at?: string;
}

/** Exact-once posting record (supabase/schema.sql appendix). */
export interface IdempotencyKey {
  client_token: string;
  scope: string;
  voucher_type: string;
  voucher_id: string;
  voucher_no: string;
  result: unknown;
  created_at: string;
}

export interface GodownTransfer {
  id: string;
  transfer_no: string;
  date: string;
  from_godown_id: string;
  to_godown_id: string;
  product_id: string;
  party_id?: string | null;
  quantity: number;
  unit: ProductUnit;
  reason: string;
  notes?: string;
  status: VoucherStatus;
  created_at: string;
  posted_at?: string;
  reversal_reason?: string;
  reversed_at?: string;
}

export interface StockAdjustment {
  id: string;
  adjustment_no: string;
  date: string;
  godown_id: string;
  product_id: string;
  party_id?: string | null;
  quantity_before: number;
  quantity_after: number;
  delta_qty: number;
  reason: string;
  approver: string;
  notes?: string;
  status: VoucherStatus;
  created_at: string;
  posted_at?: string;
  reversal_reason?: string;
  reversed_at?: string;
}

export interface GatePassReturn {
  id: string;
  gate_pass_id: string;
  product_id: string;
  party_id?: string | null;
  qty_kg: number;
  reason?: string;
  date: string;
}

/** Gate pass line with its stock-owner pool (NULL = company-owned). */
export interface GatePassItemWithOwner extends GatePassItem {
  party_id?: string | null;
}

export interface ProductionBatchInput {
  id: string;
  batch_id: string;
  product_id: string;
  planned_qty_kg: number;
  actual_qty_kg: number;
  party_id?: string | null;
}

export interface ProductionBatchOutput {
  id: string;
  batch_id: string;
  product_id: string;
  output_type: "finished" | "byproduct";
  qty_kg: number;
}

/** Batch header fields added by the schema appendix (beyond the base ProductionBatch). */
export interface ProductionBatchAppendix {
  recipe_id?: string | null;
  recipe_version_used?: number | null;
  output_product_id?: string;
  byproduct_product_id?: string | null;
  packaging_type_id?: string | null;
  bags_consumed?: number;
  packing_rate_per_bag?: number;
  damaged_bags?: number;
  /** Per-input variances stored at post time (see production.ts). */
  variances?: { product_id: string; planned_qty_kg: number; actual_qty_kg: number; qty: number; pct: number }[] | null;
  is_customer_owned?: boolean;
  owner_party_id?: string | null;
  reversal_reason?: string;
  reversed_at?: string;
}

/** One aggregated stock-summary row from inventory.getStockSummary. */
export interface StockSummaryRow {
  godown_id: string;
  godown_name: string;
  product_id: string;
  product_name: string;
  party_id: string | null;
  party_name: string | null;
  balance_kg: number;
  unit: "kg";
  min_stock_kg: number;
  below_min_stock: boolean;
}

// ---- Server-action input shapes (see the matching action file for docs) ----
export interface InwardItemInput {
  productId: string;
  bags: number;
  grossWeightKg: number;
  tareWeightKg?: number;
  tarePerBagKg?: number;
  ratePerUnit?: number;
}

export interface BatchInputInput {
  productId: string;
  actualQtyKg: number;
  plannedQtyKg?: number;
  partyId?: string;
}

export interface GatePassItemInput {
  productId: string;
  bags: number;
  netWeightKg: number;
  grossWeightKg?: number;
  remarks?: string;
  partyId?: string;
}
