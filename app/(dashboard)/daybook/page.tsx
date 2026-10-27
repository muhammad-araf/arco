"use client"

import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"

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
import { getDaybook, listExpenses, createExpense, postExpense, reverseExpense, listCashAccounts, createCashAccount, postTransfer, listExpenseCategories, createExpenseCategory, deactivateExpenseCategory } from "@/app/actions/finance"
import { listParties } from "@/app/actions/masters"
import { DaybookPrint } from "@/components/print/daybook-print"
import { PrintButton } from "@/components/print/print-button"
import { ExpenseVoucher, CashLedgerEntry } from "@/lib/types/database"
import { formatCurrency, formatDateTime, formatDate } from "@/lib/utils"
import { exportReportToCsv, exportToExcel, exportToPdf } from "@/lib/export-utils"
import { logExport } from "@/app/actions/audit-log"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  ReversalDialog,
  SubmitSpinner,
  getUrlFilter,
  isPositive,
  isTodayISO,
} from "@/components/erp-ui"
import { DaybookSkeleton } from "@/components/route-skeletons"

export default function DaybookPage() {
  const [cashLedger, setCashLedger] = React.useState<CashLedgerEntry[]>([])
  const [expenses, setExpenses] = React.useState<ExpenseVoucher[]>([])
  const [daybook, setDaybook] = React.useState<any | null>(null)
  const [cashClosing, setCashClosing] = React.useState(0)
  const [bankClosing, setBankClosing] = React.useState(0)
  const [onlineClosing, setOnlineClosing] = React.useState(0)
  const [totalClosing, setTotalClosing] = React.useState(0)
  const [unattributedOpening, setUnattributedOpening] = React.useState(0)
  const [accountBalances, setAccountBalances] = React.useState<any[]>([])
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  const [vendors, setVendors] = React.useState<any[]>([])
  const [trFrom, setTrFrom] = React.useState("")
  const [trTo, setTrTo] = React.useState("")
  const [trAmount, setTrAmount] = React.useState<number>(0)
  const [trRef, setTrRef] = React.useState("")
  const [trPending, setTrPending] = React.useState(false)
  const [acctCode, setAcctCode] = React.useState("")
  const [acctName, setAcctName] = React.useState("")
  const [acctKind, setAcctKind] = React.useState<"cash" | "bank" | "online">("cash")
  const [acctOpening, setAcctOpening] = React.useState<number>(0)
  const [acctPending, setAcctPending] = React.useState(false)
  const [fromDate, setFromDate] = React.useState("")
  const [toDate, setToDate] = React.useState("")
  // "Today" for the today-only filter, from client-side effect state (see
  // isTodayISO): never read new Date() during render.
  const [todayStr, setTodayStr] = React.useState<string | null>(null)
  const [expReverseTarget, setExpReverseTarget] = React.useState<any | null>(null)
  const [expReversing, setExpReversing] = React.useState(false)

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
  const expenseTokenRef = React.useRef<string | null>(null)
  const transferTokenRef = React.useRef<string | null>(null)
  const [categoryName, setCategoryName] = React.useState("Generator Fuel & Diesel")
  const [expCategoryId, setExpCategoryId] = React.useState("")
  const [expenseCategories, setExpenseCategories] = React.useState<any[]>([])
  const [newCatName, setNewCatName] = React.useState("")
  const [newCatDesc, setNewCatDesc] = React.useState("")
  const [catPending, setCatPending] = React.useState(false)
  const [payee, setPayee] = React.useState("")
  const [amount, setAmount] = React.useState<number>(15000)
  const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "bank">("cash")
  const [location, setLocation] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [expSettlement, setExpSettlement] = React.useState<"paid" | "credit">("paid")
  const [expVendorId, setExpVendorId] = React.useState("")
  const [expCashAccountId, setExpCashAccountId] = React.useState("")
  const [expensePage, setExpensePage] = React.useState(1)
  const [totalExpenses, setTotalExpenses] = React.useState(0)
  const expensePageSize = 50

  // Month defaults and "today" come from a client-side effect, never from
  // render: reading new Date() during render blocks prerendering under
  // cacheComponents (blocking-prerender-current-time). The skeleton covers
  // first paint, so real defaults are set before content renders.
  React.useEffect(() => {
    const now = new Date()
    setFromDate(now.toISOString().slice(0, 8) + "01")
    setToDate(now.toISOString().slice(0, 10))
    setTodayStr(now.toISOString().slice(0, 10))
  }, [])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [cash, bank, online, all, ex, ca, pa, ec] = await Promise.all([
        getDaybook({ accountKind: "cash", from: fromDate, to: toDate }),
        getDaybook({ accountKind: "bank", from: fromDate, to: toDate }),
        getDaybook({ accountKind: "online", from: fromDate, to: toDate }),
        getDaybook({ from: fromDate, to: toDate }),
        listExpenses({ page: expensePage, pageSize: expensePageSize }),
        listCashAccounts(),
        listParties(),
        listExpenseCategories(),
      ])
      const failed = [cash, bank, online, all, ex, ca, pa, ec].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load daybook data.")
      setCashClosing(Number((cash.data as any)?.closing || 0))
      setBankClosing(Number((bank.data as any)?.closing || 0))
      setOnlineClosing(Number((online.data as any)?.closing || 0))
      // Total cash comes from the all-accounts daybook, not the sum of
      // the kind cards: only the all-accounts view can honour a cash
      // opening recorded without an account.
      setTotalClosing(Number((all.data as any)?.closing || 0))
      setUnattributedOpening(Number((all.data as any)?.unattributedOpening || 0))
      const byId = new Map<string, any>()
      for (const d of [cash.data, bank.data, online.data] as any[]) {
        for (const b of (d?.balances ?? [])) byId.set(b.cashAccountId ?? `kind:${b.accountKind}`, b)
      }
      setAccountBalances([...byId.values()])
      setCashAccounts(Array.isArray(ca.data) ? ca.data : [])
      setVendors((Array.isArray(pa.data) ? pa.data : []).filter((x: any) => x.type === "supplier" || x.type === "both"))
      const entries = [
        ...((cash.data as any)?.entries ?? []).map((e: any) => ({ ...e, description: e.description ?? e.voucher_no })),
        ...((bank.data as any)?.entries ?? []).map((e: any) => ({ ...e, description: e.description ?? e.voucher_no })),
        ...((online.data as any)?.entries ?? []).map((e: any) => ({ ...e, description: e.description ?? e.voucher_no })),
      ].sort((a, b) => String(b.date).localeCompare(String(a.date)))
      setCashLedger(entries as any)
      setDaybook({ cash: cash.data, bank: bank.data, online: online.data, all: all.data, opening: Number((all.data as any)?.opening || 0), closing: Number((all.data as any)?.closing || 0) })
      // Paged shape { rows, total } or the legacy plain array.
      setExpenses(Array.isArray(ex.data) ? ex.data : ((ex.data as any)?.rows ?? []))
      setTotalExpenses(Array.isArray(ex.data) ? ex.data.length : Number((ex.data as any)?.total ?? 0))
      setExpenseCategories(Array.isArray(ec.data) ? ec.data : [])
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load daybook data.")
    } finally {
      setIsLoading(false)
    }
  }, [fromDate, toDate, expensePage])

  React.useEffect(() => {
    if (!fromDate || !toDate) return
    loadData()
    setDrillFilter(getUrlFilter())
  }, [loadData])
  React.useEffect(() => {
    if (cashAccounts.length > 0 && !expCashAccountId) {
      const first = cashAccounts.find((a) => a.account_kind === paymentMethod)
      if (first) setExpCashAccountId(first.id)
    }
  }, [cashAccounts, expCashAccountId, paymentMethod])
  React.useEffect(() => {
    const cat = expenseCategories.find((c: any) => c.name === categoryName)
    if (cat && cat.id !== expCategoryId) setExpCategoryId(cat.id)
  }, [expenseCategories, categoryName, expCategoryId])

  const currentCashBalance = cashClosing
  const currentBankBalance = bankClosing
  const currentOnlineBalance = onlineClosing

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §12: an expense needs a payee, a category, a description and a
    // positive amount — each failure says what is missing.
    if (!payee.trim()) return setFormError("Payee is required — who was this expense paid to?")
    if (!categoryName.trim()) return setFormError("Select or enter an expense category.")
    if (!description.trim()) return setFormError("A short description is required so the daybook stays auditable.")
    if (!isPositive(amount)) return setFormError("Expense amount must be greater than zero.")
    if (expSettlement === "credit" && !expVendorId) return setFormError("A credit expense needs a vendor — the unpaid amount has to be owed to someone.")
    if (expSettlement === "paid" && !expCashAccountId) return setFormError("Select the cash account this expense is paid from.")
    setFormError("")
    setDraftExpense({
      id: `exp-${Date.now()}`,
      expense_no: `EXP-2026-${String(totalExpenses + 1).padStart(3, "0")}`,
      date: new Date().toISOString(),
      category_id: expCategoryId || "",
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

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (catPending) return
    if (!newCatName.trim()) return setFormError("Expense category name is required.")
    setCatPending(true)
    try {
      const res = await createExpenseCategory({ name: newCatName.trim(), description: newCatDesc.trim() || undefined })
      if (!res.success) { setFormError(res.error ?? "Could not create the expense category."); return }
      setFormNotice(`Expense category ${newCatName.trim()} created.`)
      setNewCatName(""); setNewCatDesc("")
      await loadData()
    } finally { setCatPending(false) }
  }

  const handleDeactivateCategory = async (id: string, name: string) => {
    const res = await deactivateExpenseCategory(id)
    if (!res.success) { setFormError(res.error ?? "Could not deactivate the category."); return }
    setFormNotice(`Expense category ${name} deactivated.`)
    await loadData()
  }

  const handleConfirmExpense = async () => {
    if (!draftExpense || expenseGuard.current) return
    expenseGuard.current = true
    setIsPending(true)
    try {
      const created = await createExpense({
        categoryName, categoryId: expCategoryId || undefined, payee: payee.trim(), amount, paymentMethod,
        location: location.trim() || undefined,
        description: description.trim(), settlement: expSettlement,
        vendorId: expSettlement === "credit" ? expVendorId : undefined,
        cashAccountId: expSettlement === "paid" ? expCashAccountId : undefined,
        clientToken: submissionToken(expenseTokenRef, "expense"),
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the expense.")
        return
      }
      const posted = await postExpense((created.data as any).id)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the expense.")
        return
      }
      const row: any = posted.data ?? created.data
      setFormNotice(`${row.expense_no ?? draftExpense.expense_no} posted — ${formatCurrency(amount)} for ${categoryName} (${expSettlement === "credit" ? "credit, unpaid" : paymentMethod}).`)
      setShowConfirm(false)
      setIsExpenseModalOpen(false)
      resetSubmissionToken(expenseTokenRef)
      setDraftExpense(null)
      await loadData()
    } finally {
      setIsPending(false)
      expenseGuard.current = false
    }
  }

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (trPending) return
    if (!trFrom || !trTo) return setFormError("Select both transfer accounts.")
    if (trFrom === trTo) return setFormError("Transfer accounts must differ.")
    if (!(trAmount > 0)) return setFormError("Transfer amount must be greater than zero.")
    setTrPending(true)
    try {
      const res = await postTransfer({ fromAccountId: trFrom, toAccountId: trTo, amount: trAmount, referenceNo: trRef || undefined, clientToken: submissionToken(transferTokenRef, "transfer") })
      if (!res.success) { setFormError(res.error ?? "Could not post the transfer."); return }
      setFormNotice(`Transfer ${(res.data as any)?.transfer_no ?? ""} posted — ${formatCurrency(trAmount)} moved between accounts.`)
      resetSubmissionToken(transferTokenRef)
      await loadData()
    } finally { setTrPending(false) }
  }

  const handleCreateCashAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (acctPending) return
    if (!acctCode.trim() || !acctName.trim()) return setFormError("Cash account code and name are required.")
    if (acctOpening < 0) return setFormError("Opening balance cannot be negative.")
    setAcctPending(true)
    try {
      const res = await createCashAccount({ code: acctCode.trim(), name: acctName.trim(), accountKind: acctKind, openingBalance: acctOpening })
      if (!res.success) { setFormError(res.error ?? "Could not create the cash account."); return }
      setFormNotice(`Cash account ${acctCode.trim()} — ${acctName.trim()} created.`)
      setAcctCode(""); setAcctName(""); setAcctOpening(0)
      await loadData()
    } finally { setAcctPending(false) }
  }

  const handleExpenseReverse = async (reasonCode: string, reason: string) => {
    if (!expReverseTarget || expReversing) return
    setExpReversing(true)
    try {
      const res = await reverseExpense(expReverseTarget.id, `${reasonCode}: ${reason}`)
      if (!res.success) { setFormError(res.error ?? "Could not reverse the expense."); return }
      setFormNotice(`Expense ${expReverseTarget.expense_no} reversed.`)
      setExpReverseTarget(null)
      await loadData()
    } finally { setExpReversing(false) }
  }

  const visibleLedger = drillFilter === "today"
    ? cashLedger.filter((row) => isTodayISO(row.date, todayStr))
    : cashLedger
  // Spec §12.3 daybook check: closing = opening + receipts in - payments out.
  // Computed from the ledger itself so a drift is visible, not hidden.
  const ledgerTotals = visibleLedger.reduce(
    (acc, row) => ({ debit: acc.debit + row.debit, credit: acc.credit + row.credit }),
    { debit: 0, credit: 0 }
  )

  // Daybook export (spec §16): the shown cashbook rows with title, date
  // range, totals — CSV, Excel and PDF share this one definition.
  const getDaybookExport = () => ({
    rows: visibleLedger.map((r: any) => ({ date: r.date, voucher_no: r.voucher_no, type: r.voucher_type, account: (r as any).account_label ?? r.account, description: r.description, debit: r.debit, credit: r.credit, balance: r.running_balance })),
    filename: "daybook",
    columns: [{ key: "date", label: "Date" }, { key: "voucher_no", label: "Voucher" }, { key: "type", label: "Type" }, { key: "account", label: "Account" }, { key: "description", label: "Description" }, { key: "debit", label: "Cash in (Debit)" }, { key: "credit", label: "Cash out (Credit)" }, { key: "balance", label: "Balance" }],
    options: { title: "Daybook", dateRange: `${fromDate} to ${toDate}`, filters: drillFilter ? [`Filter: ${drillFilter}`] : [], totals: { debit: ledgerTotals.debit, credit: ledgerTotals.credit } },
    report: "daybook",
  })
  const handleDaybookExport = async (format: "csv" | "xlsx" | "pdf") => {
    const e = getDaybookExport()
    const ok = format === "csv"
      ? exportReportToCsv(e.rows, e.filename, e.columns as any, e.options as any)
      : format === "xlsx"
        ? await exportToExcel(e.rows, e.filename, e.columns as any, e.options as any)
        : await exportToPdf(e.rows, e.filename, e.columns as any, e.options as any)
    if (ok) void logExport({ report: e.report, format, filters: { dateRange: `${fromDate} to ${toDate}` } })
  }

  if (isLoading) return <DaybookSkeleton />


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
            Daybook
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleDaybookExport("csv")}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void handleDaybookExport("xlsx")}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => void handleDaybookExport("pdf")}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export PDF
          </button>
          <button
            type="button"
            onClick={() => setIsExpenseModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
          <Plus className="h-4 w-4" />
          <span>New Expense</span>
        </button>
        </div>
      </div>

      {/* Liquidity Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="expensive-card p-4">
          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            Cash in Hand
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
            {formatCurrency(currentCashBalance)}
          </div>
        </div>

        <div className="expensive-card p-4">
          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            Bank
          </div>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-2">
            {formatCurrency(currentBankBalance)}
          </div>
        </div>

        <div className="expensive-card p-4">
          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            Online
          </div>
          <div className="text-2xl font-black text-violet-600 dark:text-violet-400 mt-2">
            {formatCurrency(currentOnlineBalance)}
          </div>
        </div>

        <div className="expensive-card p-4">
          <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
            Total Cash
          </div>
          <div className="text-2xl font-black text-foreground mt-2">
            {formatCurrency(totalClosing)}
          </div>
          {unattributedOpening !== 0 && (<p className="text-[11px] text-muted-foreground mt-1">Includes {formatCurrency(unattributedOpening)} opening recorded without an account.</p>)}
        </div>
      </div>

      {/* Balances by account: each account has its own balance chain. */}
      {accountBalances.length > 0 && (
        <div className="expensive-card p-5">
          <h2 className="text-sm font-bold text-foreground mb-3">Balances by account</h2>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Account</th><th className="pb-2">Kind</th><th className="pb-2 text-right">Opening</th><th className="pb-2 text-right">Closing</th></tr></thead>
            <tbody className="divide-y divide-border">
              {accountBalances.map((b: any, i: number) => (<tr key={b.cashAccountId ?? `kind-${b.accountKind}-${i}`}><td className="py-2 font-semibold">{b.cashAccountId ? `${b.code} — ${b.name}` : b.name}</td><td className="py-2 uppercase text-muted-foreground">{b.accountKind}</td><td className="py-2 text-right font-mono">{formatCurrency(Number(b.opening || 0))}</td><td className="py-2 text-right font-bold font-mono">{formatCurrency(Number(b.closing || 0))}</td></tr>))}
            </tbody></table></div>
        </div>
      )}

      {/* Cash Movement Ledger Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Receipt className="h-4 w-4 text-emerald-500" />
            Cashbook ({visibleLedger.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Date & Time</th>
                <th className="pb-3 font-bold">Voucher No</th>
                <th className="pb-3 font-bold">Type</th>
                <th className="pb-3 font-bold">Account</th>
                <th className="pb-3 font-bold">Description</th>
                <th className="pb-3 font-bold text-right">Cash In (Debit)</th>
                <th className="pb-3 font-bold text-right">Cash Out (Credit)</th>
                <th className="pb-3 font-bold text-right">Balance (this account)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {visibleLedger.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 font-sans">
                    <EmptyState
                      title={drillFilter === "today" ? "No cash movements today yet" : "No cash movements recorded"}
                      hint={drillFilter === "today" ? "Clear the filter, or record an expense." : "Record an expense or a receipt."}
                      actionLabel="Record Expense"
                      onAction={() => setIsExpenseModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
              {visibleLedger.map((row) => (
                <tr key={row.id} className="hover:bg-muted transition-colors">
                  <td className="py-3 text-muted-foreground font-sans">{formatDateTime(row.date)}</td>
                  <td className="py-3 font-bold text-foreground font-sans">{row.voucher_no}</td>
                  <td className="py-3">
                    <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase text-[9px] font-bold">
                      {row.voucher_type}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground text-[11px] font-semibold">
                    {(row as any).account_label ?? row.account}
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
        <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>Shown in: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(ledgerTotals.debit)}</strong></span>
          <span>Shown out: <strong className="text-red-600 dark:text-red-400 font-mono">{formatCurrency(ledgerTotals.credit)}</strong></span>
          <span>Net shown: <strong className="text-foreground font-mono">{formatCurrency(ledgerTotals.debit - ledgerTotals.credit)}</strong></span>
          <span className="text-[11px]">Daybook rule: closing = opening + receipts in − payments out.</span>
        </div>
      </div>

      {/* Expense Modal */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
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
                <label className="block font-medium text-foreground mb-1" htmlFor="expense-category">Expense Category</label>
                <select id="expense-category"
                  value={categoryName}
                  onChange={(e) => {
                    setCategoryName(e.target.value)
                    const cat = expenseCategories.find((c: any) => c.name === e.target.value)
                    setExpCategoryId(cat ? cat.id : "")
                  }}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                >
                  {expenseCategories.filter((c: any) => c.is_active !== false).length > 0 ? (
                    expenseCategories.filter((c: any) => c.is_active !== false).map((c: any) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))
                  ) : (
                    <>
                      <option value="Generator Fuel & Diesel">Generator Fuel & Diesel</option>
                      <option value="Electricity & Utility Bills">Electricity & Utility Bills</option>
                      <option value="Machine Repair & Maintenance">Machine Repair & Maintenance</option>
                      <option value="Loading & Unloading Wages">Loading & Unloading Wages</option>
                      <option value="Transport & Local Cartage">Transport & Local Cartage</option>
                      <option value="Staff Refreshment & Food">Staff Refreshment & Food</option>
                      <option value="General Store Supplies">General Store Supplies</option>
                    </>
                  )}
                </select>
                {expenseCategories.filter((c: any) => c.is_active !== false).length === 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">No categories in the database yet — these are fallback names. Create real categories in the Expense categories section below.</p>
                )}
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="expense-location">Location (optional)</label>
                <input id="expense-location"
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Main godown, site, market"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="payee-vendor-name">Payee / Vendor Name</label>
                <input id="payee-vendor-name"
                  type="text"
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  placeholder="e.g. Parco / Electrician"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="amount-pkr">Amount (PKR)</label>
                  <input id="amount-pkr"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="paid-from">Paid From</label>
                  <select id="paid-from"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as "cash" | "bank")}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="cash">Godown Cash Counter</option>
                    <option value="bank">Bank Account</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="settlement">Settlement</label>
                <select id="settlement" value={expSettlement} onChange={(e) => setExpSettlement(e.target.value as "paid" | "credit")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
                  <option value="paid">Paid now (cash out on posting)</option>
                  <option value="credit">Credit (unpaid — settle later as a vendor payment)</option>
                </select>
              </div>
              {expSettlement === "credit" && (
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="vendor-owed">Vendor owed *</label>
                  <select id="vendor-owed" value={expVendorId} onChange={(e) => setExpVendorId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required>
                    <option value="">Select vendor</option>
                    {vendors.map((v: any) => (<option key={v.id} value={v.id}>{v.name}</option>))}
                  </select>
                </div>
              )}
              {expSettlement === "paid" && (
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="cash-account">Cash account *</label>
                  <select id="cash-account" value={expCashAccountId} onChange={(e) => setExpCashAccountId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required>
                    <option value="">Select account</option>
                    {cashAccounts.filter((a) => a.account_kind === paymentMethod).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                  </select>
                  {cashAccounts.filter((a) => a.account_kind === paymentMethod).length === 0 && (<p className="mt-1 text-[11px] text-muted-foreground">No {paymentMethod} account yet — create one below.</p>)}
                </div>
              )}

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="particulars-description">Particulars / Description</label>
                <input id="particulars-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. 50L diesel for cleaner"
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
      <div className="expensive-card p-4 flex flex-wrap items-end gap-3 text-xs">
        <div><label className="block font-medium text-foreground mb-1" htmlFor="from">From</label><input id="from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
        <div><label className="block font-medium text-foreground mb-1" htmlFor="to">To</label><input id="to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
        <button type="button" onClick={loadData} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer">Load daybook</button>
        <span className="text-muted-foreground">Daybook is per account and date range (getDaybook). Cash, bank and online closings above come from those three calls; the balance column is per account, not one merged chain. Transfers are included in the entries.</span>
      </div>
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Cash transfer</h2>
        <p className="text-xs text-muted-foreground mb-4">Move cash between two accounts. A transfer is never revenue or expense.</p>
        <form onSubmit={handleTransfer} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="from-account">From account *</label><select id="from-account" value={trFrom} onChange={(e) => setTrFrom(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select account</option>{cashAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name} ({a.account_kind})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="to-account">To account *</label><select id="to-account" value={trTo} onChange={(e) => setTrTo(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select account</option>{cashAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name} ({a.account_kind})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="amount">Amount *</label><input id="amount" type="number" value={trAmount} onChange={(e) => setTrAmount(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="reference">Reference</label><input id="reference" value={trRef} onChange={(e) => setTrRef(e.target.value)} placeholder="Optional" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={trPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{trPending ? "Posting…" : "Post transfer"}</button></div>
        </form>
      </div>
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Cash accounts</h2>
        <p className="text-xs text-muted-foreground mb-4">Receipts, payments and paid expenses must land in one of these accounts, so per-account daybook views stay complete.</p>
        <form onSubmit={handleCreateCashAccount} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs mb-4">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="code">Code *</label><input id="code" value={acctCode} onChange={(e) => setAcctCode(e.target.value)} placeholder="e.g. CASH-01" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="name">Name *</label><input id="name" value={acctName} onChange={(e) => setAcctName(e.target.value)} placeholder="e.g. Godown Counter Cash" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="kind">Kind *</label><select id="kind" value={acctKind} onChange={(e) => setAcctKind(e.target.value as "cash" | "bank" | "online")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="cash">Cash</option><option value="bank">Bank</option><option value="online">Online</option></select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="opening-balance">Opening balance</label><input id="opening-balance" type="number" value={acctOpening} onChange={(e) => setAcctOpening(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={acctPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{acctPending ? "Creating…" : "Create cash account"}</button></div>
        </form>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Code</th><th className="pb-2">Name</th><th className="pb-2">Kind</th><th className="pb-2 text-right">Opening</th></tr></thead>
          <tbody className="divide-y divide-border">
            {cashAccounts.length === 0 && <tr><td colSpan={4} className="py-4 text-muted-foreground">No cash accounts yet — create the first one above.</td></tr>}
            {cashAccounts.map((a: any) => (<tr key={a.id}><td className="py-2 font-mono font-bold">{a.code}</td><td className="py-2">{a.name}</td><td className="py-2 uppercase text-muted-foreground">{a.account_kind}</td><td className="py-2 text-right font-mono">{formatCurrency(Number(a.opening_balance || 0))}</td></tr>))}
          </tbody></table></div>
      </div>
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-foreground">Expenses in range</h2>
          <PrintButton label="Print daybook" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
        </div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Expense</th><th className="pb-2">Category</th><th className="pb-2">Payee</th><th className="pb-2">Location</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {expenses.length === 0 && <tr><td colSpan={6} className="py-4 text-muted-foreground">No expenses recorded yet.</td></tr>}
            {expenses.map((e: any) => (<tr key={e.id}><td className="py-2 font-mono font-bold">{e.expense_no}</td><td className="py-2">{e.category_name}</td><td className="py-2">{e.payee}</td><td className="py-2 text-muted-foreground">{e.location || "—"}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(e.amount || 0))}</td><td className="py-2 text-center">{e.status}{e.settlement ? ` (${e.settlement})` : ""}{e.status === "posted" && (<button type="button" onClick={() => setExpReverseTarget(e)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Reverse</button>)}</td></tr>))}
          </tbody></table>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Showing {expenses.length === 0 ? 0 : (expensePage - 1) * expensePageSize + 1}–{(expensePage - 1) * expensePageSize + expenses.length} of {totalExpenses} expenses</span>
            <span className="flex gap-2">
              <button type="button" disabled={expensePage <= 1} onClick={() => setExpensePage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Previous</button>
              <button type="button" disabled={expensePage * expensePageSize >= totalExpenses} onClick={() => setExpensePage((p) => p + 1)} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Next</button>
            </span>
          </div></div>
        {daybook && (
          <div className="hidden print:block mt-2">
            <DaybookPrint
              accountName="Cash + Bank + Online"
              dateFrom={fromDate}
              dateTo={toDate}
              openingBalance={daybook.opening}
              closingBalance={daybook.closing}
              rows={visibleLedger.map((r: any) => ({ date: r.date, voucherNo: r.voucher_no, voucherType: r.voucher_type, description: r.description, receipt: r.debit, payment: r.credit, balance: r.running_balance }))}
            />
          </div>
        )}
      </div>
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Expense categories</h2>
        <p className="text-xs text-muted-foreground mb-4">The expense form draws its categories from this table — no hardcoded category is written to an expense. Deactivated categories stay on old expenses but disappear from the form.</p>
        <form onSubmit={handleCreateCategory} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs mb-4">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="new-category-name">Category name *</label><input id="new-category-name" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="e.g. Vehicle Fuel" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="new-category-desc">Description</label><input id="new-category-desc" value={newCatDesc} onChange={(e) => setNewCatDesc(e.target.value)} placeholder="Optional" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="flex items-end"><button type="submit" disabled={catPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{catPending ? "Creating…" : "Create category"}</button></div>
        </form>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[480px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Name</th><th className="pb-2">Description</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {expenseCategories.length === 0 && <tr><td colSpan={3} className="py-4 text-muted-foreground">No categories yet — create the first one above.</td></tr>}
            {expenseCategories.map((c: any) => (<tr key={c.id}><td className="py-2 font-semibold">{c.name}</td><td className="py-2 text-muted-foreground">{c.description || "—"}</td><td className="py-2 text-center">{c.is_active === false ? "Inactive" : (<>Active<button type="button" onClick={() => handleDeactivateCategory(c.id, c.name)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Deactivate</button></>)}</td></tr>))}
          </tbody></table></div>
      </div>
      <ReversalDialog open={!!expReverseTarget} voucherLabel={expReverseTarget?.expense_no ?? ""} pending={expReversing} onConfirm={handleExpenseReverse} onCancel={() => setExpReverseTarget(null)} />
      <ConfirmDialog
        open={showConfirm}
        title="Post this expense?"
        description={draftExpense ? `${draftExpense.expense_no}: ${formatCurrency(draftExpense.amount)} to ${draftExpense.payee} for ${draftExpense.category_name} (${expSettlement === "credit" ? "credit, unpaid" : `paid via ${draftExpense.payment_method}`}).` : ""}
        confirmLabel="Post Expense to Cashbook"
        pending={isPending}
        onConfirm={handleConfirmExpense}
        onCancel={() => { setShowConfirm(false); setDraftExpense(null) }}
      />
    </div>
  )
}
