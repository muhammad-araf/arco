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
import { getDaybook, listExpenses, postExpense, reverseExpense, listCashAccounts, postTransfer, listExpenseCategories } from "@/app/actions/finance"
import { listParties } from "@/app/actions/masters"
import { ExpenseVoucher } from "@/lib/types/database"
import { AttachmentLink } from "@/components/attachment-fields"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  EmptyState,
  ReversalDialog,
} from "@/components/erp-ui"
import { DaybookExpenseDialog } from "@/components/daybook-expense-dialog"
import { DaybookExpenseEditDialog } from "@/components/daybook-expense-edit-dialog"
import { ExpenseVoucherPrint } from "@/components/print/expense-voucher-print"
import { PrintButton } from "@/components/print/print-button"
import { amountInWordsPKR } from "@/lib/calc/finance"
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
  const [editTarget, setEditTarget] = React.useState<any | null>(null)

  // Expense Modal
  const [isExpenseModalOpen, setIsExpenseModalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const transferTokenRef = React.useRef<string | null>(null)
  const [expenseCategories, setExpenseCategories] = React.useState<any[]>([])
  const [printExpense, setPrintExpense] = React.useState<any | null>(null)
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

  const currentCashBalance = cashClosing
  const currentBankBalance = bankClosing
  const currentOnlineBalance = onlineClosing

  const handlePostExpenseDraft = async (row: any) => {
    if (isPending) return
    setIsPending(true)
    try {
      const posted = await postExpense(row.id)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the expense.")
        return
      }
      const postedRow: any = posted.data ?? row
      setFormNotice(`${postedRow.expense_no ?? row.expense_no} posted — ${formatCurrency(Number(row.amount || 0))} for ${row.category_name ?? "expense"}.`)
      setPrintExpense({ ...row, ...postedRow, status: "posted" })
      await loadData()
    } finally {
      setIsPending(false)
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

      <DaybookExpenseDialog
        open={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        cashAccounts={cashAccounts}
        vendors={vendors}
        expenseCategories={expenseCategories}
        recordCount={totalExpenses}
        onPosted={(notice, printRow) => {
          setFormNotice(notice)
          setPrintExpense(printRow)
          void loadData()
        }}
        onDraftSaved={(notice) => {
          setFormNotice(notice)
          void loadData()
        }}
      />
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
          <div><label className="block font-medium text-foreground mb-1" htmlFor="from-account">From account *</label><select id="from-account" title={cashAccounts.find((a) => a.id === trFrom) ? `${cashAccounts.find((a) => a.id === trFrom)?.code} — ${cashAccounts.find((a) => a.id === trFrom)?.name}` : ""} required value={trFrom} onChange={(e) => setTrFrom(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select account</option>{cashAccounts.filter((a) => a.is_active !== false).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name} ({a.account_kind})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="to-account">To account *</label><select id="to-account" title={cashAccounts.find((a) => a.id === trTo) ? `${cashAccounts.find((a) => a.id === trTo)?.code} — ${cashAccounts.find((a) => a.id === trTo)?.name}` : ""} required value={trTo} onChange={(e) => setTrTo(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select account</option>{cashAccounts.filter((a) => a.is_active !== false).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name} ({a.account_kind})</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="amount">Amount *</label><input id="amount" type="number" value={trAmount} onChange={(e) => setTrAmount(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="reference">Reference</label><input id="reference" value={trRef} onChange={(e) => setTrRef(e.target.value)} placeholder="Optional" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={trPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{trPending ? "Posting…" : "Post transfer"}</button></div>
        </form>
      </div>
      <div className="expensive-card p-5">
        <div className="mb-3">
          <h2 className="text-sm font-bold text-foreground">Expenses in range</h2>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Expense</th><th className="pb-2">Date</th><th className="pb-2">Category</th><th className="pb-2">Payee</th><th className="pb-2">Location</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {expenses.length === 0 && <tr><td colSpan={7} className="py-4"><EmptyState title="No expenses in this range" hint="An expense records money spent running the godown — fuel, repairs, wages. Record one with New Expense; posted expenses appear here and reduce cash." actionLabel="Record Expense" onAction={() => setIsExpenseModalOpen(true)} /></td></tr>}
            {expenses.map((e: any) => (<tr key={e.id}><td className="py-2 font-mono font-bold">{e.expense_no}</td><td className="py-2 text-muted-foreground">{formatDate(e.date)}</td><td className="py-2">{e.category_name}</td><td className="py-2">{e.payee}{(e as any).attachment_url ? (<div><AttachmentLink url={(e as any).attachment_url} note={(e as any).attachment_note} /></div>) : null}</td><td className="py-2 text-muted-foreground">{e.location || "—"}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(e.amount || 0))}</td><td className="py-2 text-center">{e.status}{e.settlement ? ` (${e.settlement})` : ""}{e.status === "draft" && (<><button type="button" onClick={() => handlePostExpenseDraft(e)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Post</button><button type="button" onClick={() => setEditTarget(e)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Edit</button></>)} {e.status === "posted" && (<button type="button" onClick={() => setExpReverseTarget(e)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Reverse</button>)}</td></tr>))}
          </tbody></table>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Showing {expenses.length === 0 ? 0 : (expensePage - 1) * expensePageSize + 1}–{(expensePage - 1) * expensePageSize + expenses.length} of {totalExpenses} expenses</span>
            <span className="flex gap-2">
              <button type="button" disabled={expensePage <= 1} onClick={() => setExpensePage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Previous</button>
              <button type="button" disabled={expensePage * expensePageSize >= totalExpenses} onClick={() => setExpensePage((p) => p + 1)} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Next</button>
            </span>
          </div></div>
      </div>
      <DaybookExpenseEditDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        expense={editTarget}
        cashAccounts={cashAccounts}
        vendors={vendors}
        expenseCategories={expenseCategories}
        onSaved={(notice) => {
          setFormNotice(notice)
          void loadData()
        }}
      />
      {printExpense && printExpense.status === "posted" && (
        <div className="expensive-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Expense voucher print document for {printExpense.expense_no}.</p>
            <div className="flex gap-2">
              <PrintButton label="Print voucher" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
              <button type="button" onClick={() => setPrintExpense(null)} className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-semibold cursor-pointer">Close</button>
            </div>
          </div>
          <div className="hidden print:block mt-2">
            <ExpenseVoucherPrint
              expenseNo={printExpense.expense_no}
              date={formatDate(printExpense.date)}
              payee={printExpense.payee}
              category={printExpense.category_name}
              paymentMethod={printExpense.payment_method}
              account={cashAccounts.find((a) => a.id === printExpense.cash_account_id) ? `${cashAccounts.find((a) => a.id === printExpense.cash_account_id)?.code} — ${cashAccounts.find((a) => a.id === printExpense.cash_account_id)?.name}` : undefined}
              settlement={printExpense.settlement}
              amount={printExpense.amount}
              amountInWords={amountInWordsPKR(Number(printExpense.amount || 0))}
              description={printExpense.description}
              status={printExpense.status}
            />
          </div>
        </div>
      )}
      <ReversalDialog open={!!expReverseTarget} voucherLabel={expReverseTarget?.expense_no ?? ""} pending={expReversing} onConfirm={handleExpenseReverse} onCancel={() => setExpReverseTarget(null)} />
    </div>
  )
}
