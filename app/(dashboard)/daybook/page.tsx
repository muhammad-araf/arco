"use client"

import * as React from "react"
import {
  Wallet,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Building2,
  DollarSign,
  Receipt,
  CheckCircle2,
  CreditCard,
} from "lucide-react"
import { GodownStore } from "@/lib/services/godown-store"
import { ExpenseVoucher, CashLedgerEntry } from "@/lib/types/database"
import { formatCurrency, formatDateTime, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  PageSkeleton,
  SubmitSpinner,
  getUrlFilter,
  isPositive,
  isTodayISO,
} from "@/components/erp-ui"

export default function DaybookPage() {
  const [cashLedger, setCashLedger] = React.useState<CashLedgerEntry[]>([])
  const [expenses, setExpenses] = React.useState<ExpenseVoucher[]>([])

  // Expense Modal
  const [isExpenseModalOpen, setIsExpenseModalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftExpense, setDraftExpense] = React.useState<ExpenseVoucher | null>(null)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const expenseGuard = React.useRef(false)
  const [categoryName, setCategoryName] = React.useState("Generator Fuel & Diesel")
  const [payee, setPayee] = React.useState("")
  const [amount, setAmount] = React.useState<number>(15000)
  const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "bank">("cash")
  const [description, setDescription] = React.useState("")

  const loadData = React.useCallback(() => {
    setCashLedger(GodownStore.getCashLedger())
    setExpenses(GodownStore.getExpenses())
  }, [])

  React.useEffect(() => {
    loadData()
    setDrillFilter(getUrlFilter())
    setIsLoading(false)
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

  const cashRows = cashLedger.filter((c) => c.account === "cash")
  const bankRows = cashLedger.filter((c) => c.account === "bank")
  const currentCashBalance = cashRows.length > 0 ? cashRows[cashRows.length - 1].running_balance : 455000
  const currentBankBalance = bankRows.length > 0 ? bankRows[bankRows.length - 1].running_balance : 2450000

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §12: an expense needs a payee, a category, a description and a
    // positive amount — each failure says what is missing.
    if (!payee.trim()) return setFormError("Payee is required — who was this expense paid to?")
    if (!categoryName.trim()) return setFormError("Select or enter an expense category.")
    if (!description.trim()) return setFormError("A short description is required so the daybook stays auditable.")
    if (!isPositive(amount)) return setFormError("Expense amount must be greater than zero.")
    setFormError("")
    setDraftExpense({
      id: `exp-${Date.now()}`,
      expense_no: `EXP-2026-${String(expenses.length + 1).padStart(3, "0")}`,
      date: new Date().toISOString(),
      category_id: "cat-general",
      category_name: categoryName,
      payee,
      amount,
      payment_method: paymentMethod,
      description,
      status: "posted",
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const handleConfirmExpense = () => {
    if (!draftExpense || expenseGuard.current) return
    expenseGuard.current = true
    setIsPending(true)
    try {
      GodownStore.addExpense(draftExpense)
      setFormNotice(`${draftExpense.expense_no} posted — ${formatCurrency(draftExpense.amount)} for ${draftExpense.category_name} (${draftExpense.payment_method}).`)
    } finally {
      setIsPending(false)
      expenseGuard.current = false
      setShowConfirm(false)
      setIsExpenseModalOpen(false)
      setDraftExpense(null)
    }
  }

  const visibleLedger = drillFilter === "today"
    ? cashLedger.filter((row) => isTodayISO(row.date))
    : cashLedger
  // Spec §12.3 daybook check: closing = opening + receipts in - payments out.
  // Computed from the ledger itself so a drift is visible, not hidden.
  const ledgerTotals = visibleLedger.reduce(
    (acc, row) => ({ debit: acc.debit + row.debit, credit: acc.credit + row.credit }),
    { debit: 0, credit: 0 }
  )

  if (isLoading) return <PageSkeleton />

  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Wallet className="h-6 w-6 text-emerald-500" />
            Daybook, Cashbook & Operational Expenses
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Single-ledger cash position, bank balances, payment vouchers, and categorized daily overheads.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsExpenseModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Record Daily Expense</span>
        </button>
      </div>

      {/* Liquidity Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="expensive-card p-4">
          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            Godown Cash in Hand
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
            {formatCurrency(currentCashBalance)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Imprest & Daily Godown Counter Cash
          </div>
        </div>

        <div className="expensive-card p-4">
          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            Commercial Bank Account
          </div>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-2">
            {formatCurrency(currentBankBalance)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Habib Bank Ltd (HBL) - Operational
          </div>
        </div>

        <div className="expensive-card p-4">
          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            Total Liquid Capital
          </div>
          <div className="text-2xl font-black text-foreground mt-2">
            {formatCurrency(currentCashBalance + currentBankBalance)}
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
            Reconciled with Daily Vouchers
          </div>
        </div>
      </div>

      {/* Cash Movement Ledger Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Receipt className="h-4 w-4 text-emerald-500" />
            Daily Cashbook Movement Ledger ({visibleLedger.length})
          </h2>
          <span className="text-xs text-muted-foreground">Immutable Cash / Bank Transactions</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Date & Time</th>
                <th className="pb-3 font-bold">Voucher No</th>
                <th className="pb-3 font-bold">Type</th>
                <th className="pb-3 font-bold">Account</th>
                <th className="pb-3 font-bold">Description</th>
                <th className="pb-3 font-bold text-right">Cash In (Debit)</th>
                <th className="pb-3 font-bold text-right">Cash Out (Credit)</th>
                <th className="pb-3 font-bold text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {visibleLedger.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 font-sans">
                    <EmptyState
                      title={drillFilter === "today" ? "No cash movements today yet" : "No cash movements recorded"}
                      hint={drillFilter === "today" ? "Clear the dashboard filter above to see the full cashbook, or record an expense." : "Record an expense or a customer receipt to start the cashbook trail."}
                      actionLabel="Record Expense"
                      onAction={() => setIsExpenseModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
              {visibleLedger.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 text-muted-foreground font-sans">{formatDateTime(row.date)}</td>
                  <td className="py-3 font-bold text-foreground font-sans">{row.voucher_no}</td>
                  <td className="py-3">
                    <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase text-[9px] font-bold">
                      {row.voucher_type}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground uppercase text-[10px] font-bold">
                    {row.account}
                  </td>
                  <td className="py-3 text-foreground font-sans max-w-xs truncate">
                    {row.description}
                  </td>
                  <td className="py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                    {row.debit > 0 ? `+${formatCurrency(row.debit)}` : "-"}
                  </td>
                  <td className="py-3 text-right font-bold text-destructive">
                    {row.credit > 0 ? `-${formatCurrency(row.credit)}` : "-"}
                  </td>
                  <td className="py-3 text-right font-black text-foreground">
                    {formatCurrency(row.running_balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 pt-3 border-t border-border/60 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>Shown in: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(ledgerTotals.debit)}</strong></span>
          <span>Shown out: <strong className="text-red-600 dark:text-red-400 font-mono">{formatCurrency(ledgerTotals.credit)}</strong></span>
          <span>Net shown: <strong className="text-foreground font-mono">{formatCurrency(ledgerTotals.debit - ledgerTotals.credit)}</strong></span>
          <span className="text-[11px]">Daybook rule: closing = opening + receipts in − payments out.</span>
        </div>
      </div>

      {/* Expense Modal */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Receipt className="h-4 w-4 text-emerald-500" />
                Record Operational Expense
              </h3>
              <button
                type="button"
                onClick={() => setIsExpenseModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddExpense} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              <div>
                <label className="block font-medium text-foreground mb-1">Expense Category</label>
                <select
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                >
                  <option value="Generator Fuel & Diesel">Generator Fuel & Diesel</option>
                  <option value="Electricity & Utility Bills">Electricity & Utility Bills</option>
                  <option value="Machine Repair & Maintenance">Machine Repair & Maintenance</option>
                  <option value="Loading & Unloading Wages">Loading & Unloading Wages</option>
                  <option value="Transport & Local Cartage">Transport & Local Cartage</option>
                  <option value="Staff Refreshment & Food">Staff Refreshment & Food</option>
                  <option value="General Store Supplies">General Store Supplies</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Payee / Vendor Name</label>
                <input
                  type="text"
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  placeholder="e.g. Total Parco / Local Electrician"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Amount (PKR)</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Paid From</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as "cash" | "bank")}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="cash">Godown Cash Counter</option>
                    <option value="bank">HBL Bank Account</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Particulars / Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. 50 Liters Diesel for cleaner plant"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsExpenseModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
                  <span>{isPending ? "Posting…" : "Post Expense to Cashbook"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showConfirm}
        title="Post this expense?"
        description={draftExpense ? `${draftExpense.expense_no}: ${formatCurrency(draftExpense.amount)} to ${draftExpense.payee} for ${draftExpense.category_name} via ${draftExpense.payment_method}. This records a cash/bank outflow in the daybook.` : ""}
        confirmLabel="Post Expense to Cashbook"
        pending={isPending}
        onConfirm={handleConfirmExpense}
        onCancel={() => { setShowConfirm(false); setDraftExpense(null) }}
      />
    </div>
  )
}
