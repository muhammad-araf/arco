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
import { getDaybook, listExpenses, createExpense, postExpense, reverseExpense, updateExpense, listCashAccounts, postTransfer, listExpenseCategories } from "@/app/actions/finance"
import { listParties } from "@/app/actions/masters"
import { ExpenseVoucher } from "@/lib/types/database"
import { AttachmentFields, AttachmentLink } from "@/components/attachment-fields"
import { formatCurrency } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  ReversalDialog,
  SubmitSpinner,
  isPositive,
} from "@/components/erp-ui"
import { DaybookSkeleton } from "@/components/route-skeletons"

export default function DaybookPage() {
  const [expenses, setExpenses] = React.useState<ExpenseVoucher[]>([])
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
  const [fromDate, setFromDate] = React.useState("")
  const [toDate, setToDate] = React.useState("")
  const [expReverseTarget, setExpReverseTarget] = React.useState<any | null>(null)
  const [expReversing, setExpReversing] = React.useState(false)
  const [editExpense, setEditExpense] = React.useState<any | null>(null)
  const [editPending, setEditPending] = React.useState(false)
  const [editCategoryName, setEditCategoryName] = React.useState("")
  const [editPayee, setEditPayee] = React.useState("")
  const [editAmount, setEditAmount] = React.useState<number>(0)
  const [editPaymentMethod, setEditPaymentMethod] = React.useState<"cash" | "bank">("cash")
  const [editLocation, setEditLocation] = React.useState("")
  const [editDescription, setEditDescription] = React.useState("")
  const [editSettlement, setEditSettlement] = React.useState<"paid" | "credit">("paid")
  const [editVendorId, setEditVendorId] = React.useState("")
  const [editCashAccountId, setEditCashAccountId] = React.useState("")

  // Expense Modal
  const [isExpenseModalOpen, setIsExpenseModalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftExpense, setDraftExpense] = React.useState<ExpenseVoucher | null>(null)
  const expenseGuard = React.useRef(false)
  const expenseTokenRef = React.useRef<string | null>(null)
  const transferTokenRef = React.useRef<string | null>(null)
  const [categoryName, setCategoryName] = React.useState("Generator Fuel & Diesel")
  const [expCategoryId, setExpCategoryId] = React.useState("")
  const [expenseCategories, setExpenseCategories] = React.useState<any[]>([])
  const [payee, setPayee] = React.useState("")
  const [amount, setAmount] = React.useState<number>(15000)
  const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "bank">("cash")
  const [location, setLocation] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [attachmentUrl, setAttachmentUrl] = React.useState("")
  const [attachmentNote, setAttachmentNote] = React.useState("")
  const [expSettlement, setExpSettlement] = React.useState<"paid" | "credit">("paid")
  const [expVendorId, setExpVendorId] = React.useState("")
  const [expCashAccountId, setExpCashAccountId] = React.useState("")
  const [expensePage, setExpensePage] = React.useState(1)
  const [totalExpenses, setTotalExpenses] = React.useState(0)
  const expensePageSize = 50

  // Month defaults come from a client-side effect, never from render:
  // reading new Date() during render blocks prerendering under
  // cacheComponents (blocking-prerender-current-time).
  React.useEffect(() => {
    const now = new Date()
    setFromDate(now.toISOString().slice(0, 8) + "01")
    setToDate(now.toISOString().slice(0, 10))
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
      // getDaybook still feeds the balance cards below; the ledger table
      // itself lives on the Ledgers Cash tab, so entries are not merged
      // here any more.
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

  const handleConfirmExpense = async () => {
    if (!draftExpense || expenseGuard.current) return
    expenseGuard.current = true
    setIsPending(true)
    try {
      const created = await createExpense({
        categoryName, categoryId: expCategoryId || undefined, payee: payee.trim(), amount, paymentMethod,
        location: location.trim() || undefined,
        description: description.trim(), settlement: expSettlement,
        attachmentUrl: attachmentUrl || undefined, attachmentNote: attachmentNote || undefined,
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

  const openEditExpense = (row: any) => {
    setEditExpense(row)
    setEditCategoryName(row.category_name ?? "")
    setEditPayee(row.payee ?? "")
    setEditAmount(Number(row.amount || 0))
    setEditPaymentMethod(row.payment_method === "bank" ? "bank" : "cash")
    setEditLocation(row.location ?? "")
    setEditDescription(row.description ?? "")
    setEditSettlement(row.settlement === "credit" ? "credit" : "paid")
    setEditVendorId(row.vendor_id ?? "")
    setEditCashAccountId(row.cash_account_id ?? "")
  }

  const handleSaveExpenseEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editExpense || editPending) return
    if (!editPayee.trim()) return setFormError("Payee is required.")
    if (!editCategoryName.trim()) return setFormError("Select an expense category.")
    if (!isPositive(editAmount)) return setFormError("Expense amount must be greater than zero.")
    if (editSettlement === "credit" && !editVendorId) return setFormError("A credit expense needs a vendor.")
    if (editSettlement === "paid" && !editCashAccountId) return setFormError("Select the cash account this expense is paid from.")
    setEditPending(true)
    try {
      const cat = expenseCategories.find((c: any) => c.name === editCategoryName)
      const res = await updateExpense({
        id: editExpense.id, categoryName: editCategoryName.trim(),
        categoryId: cat ? cat.id : undefined, payee: editPayee.trim(), amount: editAmount,
        paymentMethod: editPaymentMethod, location: editLocation.trim() || null,
        description: editDescription.trim() || null, settlement: editSettlement,
        vendorId: editSettlement === "credit" ? editVendorId : null,
        cashAccountId: editSettlement === "paid" ? editCashAccountId : null,
      })
      if (!res.success) { setFormError(res.error ?? "Could not update the expense."); return }
      setFormNotice(`Expense ${editExpense.expense_no} updated.`)
      setEditExpense(null)
      await loadData()
    } finally { setEditPending(false) }
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

  if (isLoading) return <DaybookSkeleton />


  return (
    <div className="space-y-6">
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
                  <p className="mt-1 text-[11px] text-muted-foreground">No categories in the database yet — these are fallback names. Create real categories on the Masters page.</p>
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
                    {cashAccounts.filter((a) => a.account_kind === paymentMethod && a.is_active !== false).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                  </select>
                  {cashAccounts.filter((a) => a.account_kind === paymentMethod && a.is_active !== false).length === 0 && (<p className="mt-1 text-[11px] text-muted-foreground">No {paymentMethod} account yet — create one on the Masters page.</p>)}
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

              <AttachmentFields url={attachmentUrl} note={attachmentNote} onUrlChange={setAttachmentUrl} onNoteChange={setAttachmentNote} idPrefix="expense" />

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
        <span className="text-muted-foreground">Balances above are per account for this date range. The full cash ledger lives on the Ledgers Cash tab.</span>
      </div>
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Cash transfer</h2>
        <p className="text-xs text-muted-foreground mb-4">Move cash between two accounts. A transfer is never revenue or expense.</p>
        <form onSubmit={handleTransfer} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="from-account">From account *</label><select id="from-account" value={trFrom} onChange={(e) => setTrFrom(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select account</option>{cashAccounts.filter((a) => a.is_active !== false).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name} ({a.account_kind})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="to-account">To account *</label><select id="to-account" value={trTo} onChange={(e) => setTrTo(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select account</option>{cashAccounts.filter((a) => a.is_active !== false).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name} ({a.account_kind})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="amount">Amount *</label><input id="amount" type="number" value={trAmount} onChange={(e) => setTrAmount(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="reference">Reference</label><input id="reference" value={trRef} onChange={(e) => setTrRef(e.target.value)} placeholder="Optional" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={trPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{trPending ? "Posting…" : "Post transfer"}</button></div>
        </form>
      </div>
      <div className="expensive-card p-5">
        <div className="mb-3">
          <h2 className="text-sm font-bold text-foreground">Expenses in range</h2>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Expense</th><th className="pb-2">Category</th><th className="pb-2">Payee</th><th className="pb-2">Location</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {expenses.length === 0 && <tr><td colSpan={6} className="py-4 text-muted-foreground">No expenses recorded yet.</td></tr>}
            {expenses.map((e: any) => (<tr key={e.id}><td className="py-2 font-mono font-bold">{e.expense_no}</td><td className="py-2">{e.category_name}</td><td className="py-2">{e.payee}{(e as any).attachment_url ? (<div><AttachmentLink url={(e as any).attachment_url} note={(e as any).attachment_note} /></div>) : null}</td><td className="py-2 text-muted-foreground">{e.location || "—"}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(e.amount || 0))}</td><td className="py-2 text-center">{e.status}{e.settlement ? ` (${e.settlement})` : ""}{e.status === "draft" && (<button type="button" onClick={() => openEditExpense(e)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Edit</button>)}{e.status === "posted" && (<button type="button" onClick={() => setExpReverseTarget(e)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Reverse</button>)}</td></tr>))}
          </tbody></table>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Showing {expenses.length === 0 ? 0 : (expensePage - 1) * expensePageSize + 1}–{(expensePage - 1) * expensePageSize + expenses.length} of {totalExpenses} expenses</span>
            <span className="flex gap-2">
              <button type="button" disabled={expensePage <= 1} onClick={() => setExpensePage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Previous</button>
              <button type="button" disabled={expensePage * expensePageSize >= totalExpenses} onClick={() => setExpensePage((p) => p + 1)} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Next</button>
            </span>
          </div></div>
      </div>
      {editExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">Edit draft expense {editExpense.expense_no}</h3>
              <button type="button" onClick={() => setEditExpense(null)} className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer">✕</button>
            </div>
            <form onSubmit={handleSaveExpenseEdit} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-expense-category">Category</label><select id="edit-expense-category" value={editCategoryName} onChange={(e) => setEditCategoryName(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">{expenseCategories.filter((c: any) => c.is_active !== false).map((c: any) => (<option key={c.id} value={c.name}>{c.name}</option>))}</select></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-payee">Payee</label><input id="edit-payee" value={editPayee} onChange={(e) => setEditPayee(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-amount">Amount (PKR)</label><input id="edit-amount" type="number" min="1" value={editAmount} onChange={(e) => setEditAmount(Number(e.target.value))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-paid-from">Paid From</label><select id="edit-paid-from" value={editPaymentMethod} onChange={(e) => setEditPaymentMethod(e.target.value as "cash" | "bank")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="cash">Godown Cash Counter</option><option value="bank">Bank Account</option></select></div>
              </div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-settlement">Settlement</label><select id="edit-settlement" value={editSettlement} onChange={(e) => setEditSettlement(e.target.value as "paid" | "credit")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="paid">Paid now (cash out on posting)</option><option value="credit">Credit (unpaid — settle later as a vendor payment)</option></select></div>
              {editSettlement === "credit" && (<div><label className="block font-medium text-foreground mb-1" htmlFor="edit-vendor">Vendor owed *</label><select id="edit-vendor" value={editVendorId} onChange={(e) => setEditVendorId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required><option value="">Select vendor</option>{vendors.map((v: any) => (<option key={v.id} value={v.id}>{v.name}</option>))}</select></div>)}
              {editSettlement === "paid" && (<div><label className="block font-medium text-foreground mb-1" htmlFor="edit-cash-account">Cash account *</label><select id="edit-cash-account" value={editCashAccountId} onChange={(e) => setEditCashAccountId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required><option value="">Select account</option>{cashAccounts.filter((a) => a.account_kind === editPaymentMethod && a.is_active !== false).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}</select></div>)}
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-location">Location (optional)</label><input id="edit-location" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="edit-description">Particulars / Description</label><input id="edit-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
              <p className="text-[11px] text-muted-foreground">Only draft expenses can be edited. Posted expenses are corrected by reversal.</p>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditExpense(null)} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Cancel</button>
                <button type="submit" disabled={editPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60">{editPending ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
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
