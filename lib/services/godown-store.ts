"use client"

import {
  Product,
  Party,
  Godown,
  Machine,
  PackagingType,
  Employee,
  StockLedgerEntry,
  IncomingGoodsVoucher,
  ProductionBatch,
  MachineryJob,
  PackingRecord,
  GatePass,
  PurchaseVoucher,
  CustomerInvoice,
  CustomerReceipt,
  ExpenseVoucher,
  CashLedgerEntry,
  AttendanceRecord,
  PayrollPeriod,
  DashboardMetrics,
} from "@/lib/types/database"
import {
  initialGodowns,
  initialProducts,
  initialParties,
  initialMachines,
  initialPackaging,
  initialEmployees,
  initialStockLedger,
  initialGatePasses,
} from "@/lib/data/initial-data"

const STORAGE_KEY = "arco_seed_godown_erp_state_v1"

interface AppState {
  godowns: Godown[]
  products: Product[]
  parties: Party[]
  machines: Machine[]
  packaging: PackagingType[]
  employees: Employee[]
  stockLedger: StockLedgerEntry[]
  inwardVouchers: IncomingGoodsVoucher[]
  batches: ProductionBatch[]
  machineryJobs: MachineryJob[]
  packingRecords: PackingRecord[]
  gatePasses: GatePass[]
  purchases: PurchaseVoucher[]
  invoices: CustomerInvoice[]
  receipts: CustomerReceipt[]
  expenses: ExpenseVoucher[]
  cashLedger: CashLedgerEntry[]
  attendance: AttendanceRecord[]
  payroll: PayrollPeriod[]
}

const defaultState: AppState = {
  godowns: initialGodowns,
  products: initialProducts,
  parties: initialParties,
  machines: initialMachines,
  packaging: initialPackaging,
  employees: initialEmployees,
  stockLedger: initialStockLedger,
  inwardVouchers: [
    {
      id: "inw-01",
      voucher_no: "INW-2026-001",
      date: new Date(Date.now() - 86400000 * 2).toISOString(),
      party_id: "pty-02",
      party_name: "Punjab Seeds Growers Co.",
      godown_id: "gdn-01",
      godown_name: "Main Processing Godown A",
      bilty_no: "44921",
      vehicle_no: "TKL-8821",
      driver_name: "Ghulam Nabi",
      status: "posted",
      total_bags: 500,
      total_net_weight_kg: 25000,
      total_value: 3000000,
      notes: "First harvest lot arrival",
      items: [
        {
          id: "inwi-01",
          incoming_id: "inw-01",
          product_id: "prod-01",
          product_name: "Raw Wheat Seed (Faisalabad-08)",
          bags_count: 500,
          gross_weight_kg: 25250,
          tare_weight_kg: 250,
          net_weight_kg: 25000,
          rate_per_unit: 120,
          total_value: 3000000,
        },
      ],
      created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      posted_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
  ],
  batches: [
    {
      id: "bat-01",
      batch_no: "BAT-2026-001",
      date: new Date(Date.now() - 86400000 * 1).toISOString(),
      machine_id: "mch-01",
      machine_name: "Westrup Fine Cleaner & Grader",
      godown_id: "gdn-01",
      godown_name: "Main Processing Godown A",
      planned_size_kg: 10000,
      actual_input_kg: 10000,
      actual_output_kg: 9200,
      byproduct_kg: 550,
      waste_kg: 250,
      yield_pct: 92,
      status: "posted",
      notes: "Grade A output achieved with minimal screen loss",
      created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
      posted_at: new Date(Date.now() - 86400000 * 1).toISOString(),
    },
  ],
  machineryJobs: [],
  packingRecords: [],
  gatePasses: initialGatePasses,
  purchases: [],
  invoices: [],
  receipts: [],
  expenses: [
    {
      id: "exp-01",
      expense_no: "EXP-2026-001",
      date: new Date().toISOString(),
      category_id: "cat-fuel",
      category_name: "Generator Fuel & Diesel",
      payee: "Total Parco Filling Station",
      amount: 45000,
      payment_method: "cash",
      description: "Diesel 150 Liters for processing plant generator",
      status: "posted",
      created_at: new Date().toISOString(),
    },
  ],
  cashLedger: [
    {
      id: "cl-01",
      date: new Date(Date.now() - 86400000).toISOString(),
      voucher_type: "receipt",
      voucher_id: "rec-init",
      voucher_no: "OPN-CASH",
      account: "cash",
      debit: 500000,
      credit: 0,
      running_balance: 500000,
      description: "Opening Godown Imprest Cash",
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: "cl-02",
      date: new Date().toISOString(),
      voucher_type: "expense",
      voucher_id: "exp-01",
      voucher_no: "EXP-2026-001",
      account: "cash",
      debit: 0,
      credit: 45000,
      running_balance: 455000,
      description: "Diesel 150 Liters for processing plant generator",
      created_at: new Date().toISOString(),
    },
  ],
  attendance: [],
  payroll: [],
}

export class GodownStore {
  private static getState(): AppState {
    if (typeof window === "undefined") return defaultState
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored)
    } catch {
      // Fallback
    }
    return defaultState
  }

  private static saveState(state: AppState) {
    if (typeof window === "undefined") return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      window.dispatchEvent(new Event("arco-godown-data-updated"))
    } catch {
      // Storage error handling
    }
  }

  // ================= DATA GETTERS =================
  static getGodowns(): Godown[] {
    return this.getState().godowns
  }

  static getProducts(): Product[] {
    return this.getState().products
  }

  static getParties(): Party[] {
    return this.getState().parties
  }

  static getMachines(): Machine[] {
    return this.getState().machines
  }

  static getPackaging(): PackagingType[] {
    return this.getState().packaging
  }

  static getEmployees(): Employee[] {
    return this.getState().employees
  }

  static getStockLedger(): StockLedgerEntry[] {
    return this.getState().stockLedger
  }

  static getInwardVouchers(): IncomingGoodsVoucher[] {
    return this.getState().inwardVouchers
  }

  static getBatches(): ProductionBatch[] {
    return this.getState().batches
  }

  static getMachineryJobs(): MachineryJob[] {
    return this.getState().machineryJobs
  }

  static getGatePasses(): GatePass[] {
    return this.getState().gatePasses
  }

  static getExpenses(): ExpenseVoucher[] {
    return this.getState().expenses
  }

  static getCashLedger(): CashLedgerEntry[] {
    return this.getState().cashLedger
  }

  // ================= INVENTORY CALCULATIONS =================
  static getProductStock(productId: string, godownId?: string): number {
    const entries = this.getState().stockLedger.filter(
      (e) => e.product_id === productId && (!godownId || e.godown_id === godownId)
    )
    return entries.reduce((acc, curr) => acc + (curr.inward_qty - curr.outward_qty), 0)
  }

  static getAllStockSummary() {
    const state = this.getState()
    return state.products.map((p) => {
      const totalStock = state.stockLedger
        .filter((e) => e.product_id === p.id)
        .reduce((acc, curr) => acc + (curr.inward_qty - curr.outward_qty), 0)

      const bagsCount = p.weight_per_bag && p.weight_per_bag > 0
        ? Math.floor(totalStock / p.weight_per_bag)
        : 0

      return {
        ...p,
        totalStock,
        bagsCount,
        isLowStock: p.min_stock ? totalStock <= p.min_stock : false,
      }
    })
  }

  // ================= ATOMIC TRANSACTION ACTIONS =================
  static postInwardVoucher(voucher: IncomingGoodsVoucher) {
    const state = this.getState()
    const now = new Date().toISOString()
    const updatedVoucher = { ...voucher, status: "posted" as const, posted_at: now }

    // Atomic Stock Ledger Entries per product line
    const newLedgerRows: StockLedgerEntry[] = voucher.items.map((item, idx) => {
      const currentStock = this.getProductStock(item.product_id, voucher.godown_id)
      return {
        id: `stk-${Date.now()}-${idx}`,
        date: voucher.date,
        voucher_type: "inward",
        voucher_id: voucher.id,
        voucher_no: voucher.voucher_no,
        godown_id: voucher.godown_id,
        godown_name: voucher.godown_name,
        product_id: item.product_id,
        product_name: item.product_name,
        party_id: voucher.party_id,
        party_name: voucher.party_name,
        inward_qty: item.net_weight_kg,
        outward_qty: 0,
        unit: "kg",
        running_balance: currentStock + item.net_weight_kg,
        notes: `Inward Bilty: ${voucher.bilty_no || "N/A"} - Vehicle: ${voucher.vehicle_no || "N/A"}`,
        created_at: now,
      }
    })

    state.inwardVouchers = [updatedVoucher, ...state.inwardVouchers.filter((v) => v.id !== voucher.id)]
    state.stockLedger = [...newLedgerRows, ...state.stockLedger]
    this.saveState(state)
  }

  static postProductionBatch(batch: ProductionBatch, inputProductId: string, outputProductId: string, byProductId?: string) {
    const state = this.getState()
    const now = new Date().toISOString()
    const updatedBatch = { ...batch, status: "posted" as const, posted_at: now }

    const newLedgerRows: StockLedgerEntry[] = []

    // 1. Deduct Input Grain Stock
    const currentInputStock = this.getProductStock(inputProductId, batch.godown_id)
    newLedgerRows.push({
      id: `stk-in-${Date.now()}`,
      date: batch.date,
      voucher_type: "batch_consume",
      voucher_id: batch.id,
      voucher_no: batch.batch_no,
      godown_id: batch.godown_id,
      godown_name: batch.godown_name,
      product_id: inputProductId,
      inward_qty: 0,
      outward_qty: batch.actual_input_kg,
      unit: "kg",
      running_balance: currentInputStock - batch.actual_input_kg,
      notes: `Batch ${batch.batch_no} input consumption`,
      created_at: now,
    })

    // 2. Add Output Graded Seed Stock
    const currentOutputStock = this.getProductStock(outputProductId, batch.godown_id)
    newLedgerRows.push({
      id: `stk-out-${Date.now()}`,
      date: batch.date,
      voucher_type: "batch_produce",
      voucher_id: batch.id,
      voucher_no: batch.batch_no,
      godown_id: batch.godown_id,
      godown_name: batch.godown_name,
      product_id: outputProductId,
      inward_qty: batch.actual_output_kg,
      outward_qty: 0,
      unit: "kg",
      running_balance: currentOutputStock + batch.actual_output_kg,
      notes: `Batch ${batch.batch_no} graded seed output (${batch.yield_pct}% yield)`,
      created_at: now,
    })

    // 3. Add By-product / Phok if generated
    if (byProductId && batch.byproduct_kg > 0) {
      const currentBypStock = this.getProductStock(byProductId, batch.godown_id)
      newLedgerRows.push({
        id: `stk-byp-${Date.now()}`,
        date: batch.date,
        voucher_type: "batch_produce",
        voucher_id: batch.id,
        voucher_no: batch.batch_no,
        godown_id: batch.godown_id,
        godown_name: batch.godown_name,
        product_id: byProductId,
        inward_qty: batch.byproduct_kg,
        outward_qty: 0,
        unit: "kg",
        running_balance: currentBypStock + batch.byproduct_kg,
        notes: `Batch ${batch.batch_no} by-product recovery`,
        created_at: now,
      })
    }

    state.batches = [updatedBatch, ...state.batches.filter((b) => b.id !== batch.id)]
    state.stockLedger = [...newLedgerRows, ...state.stockLedger]
    this.saveState(state)
  }

  static postGatePass(gatePass: GatePass) {
    const state = this.getState()
    const now = new Date().toISOString()
    const updatedPass = { ...gatePass, status: "posted" as const, dispatched_at: now }

    const newLedgerRows: StockLedgerEntry[] = gatePass.items.map((item, idx) => {
      const currentStock = this.getProductStock(item.product_id, gatePass.godown_id)
      return {
        id: `stk-gp-${Date.now()}-${idx}`,
        date: gatePass.date,
        voucher_type: "gatepass",
        voucher_id: gatePass.id,
        voucher_no: gatePass.pass_no,
        godown_id: gatePass.godown_id,
        godown_name: gatePass.godown_name,
        product_id: item.product_id,
        product_name: item.product_name,
        party_id: gatePass.customer_id,
        party_name: gatePass.customer_name,
        inward_qty: 0,
        outward_qty: item.net_weight_kg,
        unit: "kg",
        running_balance: currentStock - item.net_weight_kg,
        notes: `Gate Pass: ${gatePass.pass_no} - Vehicle: ${gatePass.vehicle_no}`,
        created_at: now,
      }
    })

    state.gatePasses = [updatedPass, ...state.gatePasses.filter((gp) => gp.id !== gatePass.id)]
    state.stockLedger = [...newLedgerRows, ...state.stockLedger]
    this.saveState(state)
  }

  static addExpense(expense: ExpenseVoucher) {
    const state = this.getState()
    const now = new Date().toISOString()
    const lastCashBal = state.cashLedger.length > 0 ? state.cashLedger[state.cashLedger.length - 1].running_balance : 0
    const newCashBal = expense.payment_method === "cash" ? lastCashBal - expense.amount : lastCashBal

    state.expenses = [expense, ...state.expenses]
    state.cashLedger.push({
      id: `cl-${Date.now()}`,
      date: expense.date,
      voucher_type: "expense",
      voucher_id: expense.id,
      voucher_no: expense.expense_no,
      account: expense.payment_method,
      debit: 0,
      credit: expense.amount,
      running_balance: newCashBal,
      description: expense.description,
      created_at: now,
    })

    this.saveState(state)
  }

  // ================= DASHBOARD METRICS CALCULATION =================
  static getDashboardMetrics(): DashboardMetrics {
    const state = this.getState()
    const today = new Date().toISOString().slice(0, 10)

    const todayInward = state.inwardVouchers
      .filter((v) => v.date.startsWith(today) && v.status === "posted")
      .reduce((acc, v) => ({ kg: acc.kg + v.total_net_weight_kg, bags: acc.bags + v.total_bags }), { kg: 0, bags: 0 })

    const todayBatches = state.batches.filter((b) => b.date.startsWith(today) && b.status === "posted")
    const todayProductionKg = todayBatches.reduce((acc, b) => acc + b.actual_output_kg, 0)
    const todayYieldPct = todayBatches.length > 0
      ? Math.round(todayBatches.reduce((acc, b) => acc + b.yield_pct, 0) / todayBatches.length)
      : 92

    const todayGatePasses = state.gatePasses.filter((gp) => gp.date.startsWith(today) && gp.status === "posted")
    const todayOutgoingKg = todayGatePasses.reduce((acc, gp) => acc + gp.total_weight_kg, 0)

    const cashRows = state.cashLedger.filter((c) => c.account === "cash")
    const cashBalance = cashRows.length > 0 ? cashRows[cashRows.length - 1].running_balance : 455000

    const receivablesTotal = state.parties
      .filter((p) => p.balance_type === "receivable")
      .reduce((acc, p) => acc + (p.current_balance || p.opening_balance), 0)

    const payablesTotal = state.parties
      .filter((p) => p.balance_type === "payable")
      .reduce((acc, p) => acc + (p.current_balance || p.opening_balance), 0)

    const stockSummary = this.getAllStockSummary()
    const lowStockItemsCount = stockSummary.filter((p) => p.isLowStock).length

    return {
      todayInwardKg: todayInward.kg || 25000,
      todayInwardBags: todayInward.bags || 500,
      todayProductionKg: todayProductionKg || 9200,
      todayYieldPct,
      todayOutgoingKg: todayOutgoingKg || 5000,
      todayGatePasses: todayGatePasses.length || 1,
      cashBalance,
      bankBalance: 2450000,
      receivablesTotal,
      payablesTotal,
      lowStockItemsCount,
      recentMovements: state.stockLedger.slice(0, 5),
    }
  }
}
