"use client"

import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"

import * as React from "react"
import {
  Receipt,
  Plus,
  Building2,
  DollarSign,
  CheckCircle2,
  FileText,
  Printer,
  CreditCard,
  TrendingUp,
} from "lucide-react"
import { listReceipts, listInvoices, createReceipt, postReceipt, reverseReceipt, createInvoice, postInvoice, reverseInvoice, listCashAccounts } from "@/app/actions/finance"
import { amountInWordsPKR, customerBalanceNetOfAdvances } from "@/lib/calc/finance"
import { listParties } from "@/app/actions/masters"
import { ReceiptVoucherPrint } from "@/components/print/receipt-voucher-print"
import { PrintButton } from "@/components/print/print-button"
import { CustomerReceipt, Party } from "@/lib/types/database"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  ReversalDialog,
  SubmitSpinner,
  getUrlFilter,
  isPositive,
} from "@/components/erp-ui"
import { BillingSkeleton } from "@/components/route-skeletons"

export default function BillingPage() {
  const [receipts, setReceipts] = React.useState<CustomerReceipt[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])

  // Modal
  const [isReceiptModalOpen, setIsReceiptModalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftReceipt, setDraftReceipt] = React.useState<CustomerReceipt | null>(null)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const receiptGuard = React.useRef(false)
  const receiptTokenRef = React.useRef<string | null>(null)
  const invoiceTokenRef = React.useRef<string | null>(null)
  const [customerId, setCustomerId] = React.useState("")
  const [amount, setAmount] = React.useState<number>(100000)
  const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "bank" | "online">("bank")
  const [referenceNo, setReferenceNo] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [invoices, setInvoices] = React.useState<any[]>([])
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  const [receiptCashAccountId, setReceiptCashAccountId] = React.useState("")
  const [allocInvoiceId, setAllocInvoiceId] = React.useState("")
  const [allocAmount, setAllocAmount] = React.useState<number>(0)
  const [printReceipt, setPrintReceipt] = React.useState<any | null>(null)
  const [receiptReverseTarget, setReceiptReverseTarget] = React.useState<any | null>(null)
  const [receiptReversing, setReceiptReversing] = React.useState(false)
  const [invCustomerId, setInvCustomerId] = React.useState("")
  const [invDesc, setInvDesc] = React.useState("Service charges")
  const [invQty, setInvQty] = React.useState<number>(1)
  const [invPrice, setInvPrice] = React.useState<number>(0)
  const [invPending, setInvPending] = React.useState(false)
  const [invReverseTarget, setInvReverseTarget] = React.useState<any | null>(null)
  const [invReversing, setInvReversing] = React.useState(false)

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [re, inv, pa, ca] = await Promise.all([listReceipts(), listInvoices(), listParties(), listCashAccounts()])
      const failed = [re, inv, pa, ca].find((x) => !x.success)
      setCashAccounts(Array.isArray(ca.data) ? ca.data : [])
      if (failed) setFormError(failed.error ?? "Could not load billing data.")
      const partyList = (Array.isArray(pa.data) ? pa.data : []) as Party[]
      setCustomers(partyList.filter((x) => x.type === "customer" || x.type === "both"))
      setInvoices(Array.isArray(inv.data) ? inv.data : [])
      setReceipts((Array.isArray(re.data) ? re.data : []).map((row: any) => ({
        ...row,
        customer_name: partyList.find((x) => x.id === row.customer_id)?.name ?? "Not set",
        payment_method: row.account ?? row.payment_method,
      })))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load billing data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Mount load: without this the page never leaves its skeleton —
  // isLoading starts true and only post-action handlers reloaded before.
  React.useEffect(() => { loadData() }, [loadData])

  React.useEffect(() => {
    if (customers.length > 0 && !customerId) setCustomerId(customers[0].id)
  }, [customers, customerId])
  React.useEffect(() => {
    if (cashAccounts.length > 0 && !receiptCashAccountId) {
      const first = cashAccounts.find((a) => a.account_kind === paymentMethod) ?? cashAccounts[0]
      if (first) setReceiptCashAccountId(first.id)
    }
  }, [cashAccounts, receiptCashAccountId, paymentMethod])

  // Balance net of unapplied advances: invoice balances already
  // subtract allocated receipts, so only the unapplied remainder of
  // posted receipts is subtracted again. Ignoring it overstated
  // receivables and misfired the over-collection guard below.
  const custBalance = (c: Party) => {
    const opening = c.balance_type === "payable" ? -Number(c.opening_balance || 0) : Number(c.opening_balance || 0)
    const invBal = invoices.filter((i) => i.customer_id === c.id && i.status === "posted").map((i) => Number(i.balance_amount ?? Number(i.total_amount || 0) - Number(i.paid_amount || 0)) || 0)
    const unapplied = receipts.filter((r: any) => r.customer_id === c.id && r.status === "posted").map((r: any) => Number(r.unapplied_amount || 0))
    return customerBalanceNetOfAdvances(opening, invBal, unapplied)
  }
  const receiptAccountLabel = (r: any) => {
    const acct = cashAccounts.find((a) => a.id === r.cash_account_id)
    return acct ? `${acct.code} — ${acct.name}` : (r.cash_account_id ?? r.account ?? r.payment_method)
  }
  const totalReceivables = customers.reduce((sum, c) => sum + Math.max(0, custBalance(c)), 0)
  const customerInvoices = invoices.filter((i) => i.customer_id === customerId && i.status === "posted" && Number(i.balance_amount ?? Number(i.total_amount || 0) - Number(i.paid_amount || 0)) > 0)

  const handleRecordReceipt = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §11.2: a receipt collects an earlier receivable — it must name a
    // customer, be positive, and may not over-collect that customer's balance.
    if (!customerId) return setFormError("Select the customer paying this receipt.")
    if (!isPositive(amount)) return setFormError("Receipt amount must be greater than zero.")
    if (!receiptCashAccountId) return setFormError("Select a cash account for this receipt. Create one on the Daybook page first if none exists.")
    const selectedCust = customers.find((c) => c.id === customerId)
    const bal = selectedCust ? custBalance(selectedCust) : 0
    if (allocInvoiceId && allocAmount > amount) return setFormError(`Allocation (${formatCurrency(allocAmount)}) cannot exceed the receipt amount (${formatCurrency(amount)}).`)
    if (allocInvoiceId && allocAmount <= 0) return setFormError("An allocation amount must be greater than zero.")
    if (allocInvoiceId) {
      const target = invoices.find((i) => i.id === allocInvoiceId)
      const targetBal = target ? Number(target.balance_amount ?? Number(target.total_amount || 0) - Number(target.paid_amount || 0)) : 0
      if (allocAmount > targetBal) return setFormError(`Allocation (${formatCurrency(allocAmount)}) exceeds invoice ${target?.invoice_no ?? ""} balance (${formatCurrency(targetBal)}).`)
    }
    if (!allocInvoiceId && amount > bal && bal > 0) return setFormError(`Receipt (${formatCurrency(amount)}) exceeds ${selectedCust?.name || "this customer"}'s outstanding balance (${formatCurrency(bal)}). Allocate it to a specific invoice, or record the balance amount or less.`)
    setFormError("")
    const receiptNo = `RCT-2026-${String(receipts.length + 1).padStart(3, "0")}`
    setDraftReceipt({
      id: `rct-${Date.now()}`,
      receipt_no: receiptNo,
      date: new Date().toISOString(),
      customer_id: customerId,
      customer_name: selectedCust?.name,
      amount,
      payment_method: paymentMethod,
      reference_no: referenceNo || undefined,
      is_advance: false,
      notes: notes || undefined,
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const handleConfirmReceipt = async () => {
    if (!draftReceipt || receiptGuard.current) return
    receiptGuard.current = true
    setIsPending(true)
    try {
      const created = await createReceipt({
        customerId, cashAccountId: receiptCashAccountId, account: paymentMethod, amount,
        referenceNo: referenceNo || undefined, notes: notes || undefined,
        clientToken: submissionToken(receiptTokenRef, "receipt"),
        allocations: allocInvoiceId && allocAmount > 0 ? [{ invoiceId: allocInvoiceId, amount: allocAmount }] : [],
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the receipt.")
        return
      }
      const posted = await postReceipt((created.data as any).id)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the receipt.")
        return
      }
      const row: any = posted.data ?? created.data
      const selectedCust = customers.find((c) => c.id === customerId)
      setFormNotice(`${row.receipt_no ?? draftReceipt.receipt_no} posted — ${formatCurrency(amount)} received from ${selectedCust?.name} via ${paymentMethod}. Receivable reduced; cash/bank increased.`)
      setPrintReceipt({ ...draftReceipt, receipt_no: row.receipt_no ?? draftReceipt.receipt_no, status: "posted", customer_name: selectedCust?.name, allocations: allocInvoiceId ? [{ invoice_no: invoices.find((i) => i.id === allocInvoiceId)?.invoice_no, amount: allocAmount }] : [] })
      setShowConfirm(false)
      setIsReceiptModalOpen(false)
      resetSubmissionToken(receiptTokenRef)
      setDraftReceipt(null)
      await loadData()
    } finally {
      setIsPending(false)
      receiptGuard.current = false
    }
  }

  const handleReceiptReverse = async (reasonCode: string, reason: string) => {
    if (!receiptReverseTarget || receiptReversing) return
    setReceiptReversing(true)
    try {
      const res = await reverseReceipt(receiptReverseTarget.id, `${reasonCode}: ${reason}`)
      if (!res.success) { setFormError(res.error ?? "Could not reverse the receipt."); return }
      setFormNotice(`${receiptReverseTarget.receipt_no} reversed.`)
      setReceiptReverseTarget(null)
      await loadData()
    } finally { setReceiptReversing(false) }
  }

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault()
    if (invPending) return
    if (!invCustomerId || !invDesc.trim() || !(invQty > 0) || invPrice < 0) {
      setFormError("Invoice needs a customer, a description, a positive quantity and a non-negative price.")
      return
    }
    setInvPending(true)
    try {
      const created = await createInvoice({
        customerId: invCustomerId, sourceType: "manual", clientToken: submissionToken(invoiceTokenRef, "invoice"),
        lines: [{ description: invDesc.trim(), quantity: invQty, unitPrice: invPrice }],
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the invoice.")
        return
      }
      const posted = await postInvoice((created.data as any).id)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the invoice.")
        return
      }
      const row: any = posted.data ?? created.data
      setFormNotice(`Invoice ${row.invoice_no ?? ""} posted for ${formatCurrency(invQty * invPrice)}.`)
      resetSubmissionToken(invoiceTokenRef)
      await loadData()
    } finally { setInvPending(false) }
  }

  const handleInvoiceReverse = async (reasonCode: string, reason: string) => {
    if (!invReverseTarget || invReversing) return
    setInvReversing(true)
    try {
      const res = await reverseInvoice(invReverseTarget.id, `${reasonCode}: ${reason}`)
      if (!res.success) { setFormError(res.error ?? "Could not reverse the invoice."); return }
      setFormNotice(`Invoice ${invReverseTarget.invoice_no} reversed.`)
      setInvReverseTarget(null)
      await loadData()
    } finally { setInvReversing(false) }
  }

  const visibleCustomers = drillFilter === "receivable"
    ? customers.filter((c) => custBalance(c) > 0)
    : customers

  if (isLoading) return <BillingSkeleton />

  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-emerald-500" />
            Billing
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setIsReceiptModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>New Receipt</span>
        </button>
      </div>

      {/* Customer Balances & Statements Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 expensive-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-500" />
              Customers
            </h2>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              Total Due: {formatCurrency(totalReceivables)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Party Code</th>
                  <th className="pb-3 font-bold">Customer Name</th>
                  <th className="pb-3 font-bold">Contact / Phone</th>
                  <th className="pb-3 font-bold text-right">Opening Due</th>
                  <th className="pb-3 font-bold text-right">Current Balance</th>
                  <th className="pb-3 font-bold text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleCustomers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4">
                      <EmptyState
                        title={drillFilter === "receivable" ? "No outstanding receivables" : "No customers yet"}
                        hint={drillFilter === "receivable" ? "Every customer balance is settled." : "Add customers in Masters."}
                      />
                    </td>
                  </tr>
                )}
                {visibleCustomers.map((c) => {
                  const bal = custBalance(c)
                  return (
                    <tr key={c.id} className="hover:bg-muted transition-colors">
                      <td className="py-3 font-mono font-bold text-muted-foreground">{c.code}</td>
                      <td className="py-3 font-bold text-foreground">
                        <div>{c.name}</div>
                        <div className="text-[10px] text-muted-foreground">{c.address || "Local District"}</div>
                      </td>
                      <td className="py-3 font-mono text-muted-foreground">{c.phone || "-"}</td>
                      <td className="py-3 text-right text-muted-foreground font-mono">{formatCurrency(c.opening_balance)}</td>
                      <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm font-mono">
                        {formatCurrency(bal)}
                      </td>
                      <td className="py-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerId(c.id)
                            setIsReceiptModalOpen(true)
                          }}
                          className="px-2.5 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] cursor-pointer"
                        >
                          Collect Cash
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Collected Receipts Feed */}
        <div className="expensive-card p-5">
          <h2 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-emerald-500" />
            Receipts
          </h2>

          <div className="space-y-3">
            {receipts.map((r) => (
              <div key={r.id} className="p-3 rounded-lg bg-card border border-border text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-foreground">{r.receipt_no}</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(r.amount)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">{r.customer_name}</div>
                <div className="flex justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40 font-mono">
                  <span className="uppercase">{r.payment_method}</span>
                  <span>{formatDate(r.date)}</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setPrintReceipt(r)} className="px-2 py-1 rounded-md bg-card hover:bg-muted border border-border text-[11px] font-semibold cursor-pointer">Print voucher</button>
                  {(r as any).status === "posted" && (<button type="button" onClick={() => setReceiptReverseTarget(r)} className="px-2 py-1 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Reverse</button>)}
                </div>
              </div>
            ))}
            {receipts.length === 0 && (
              <EmptyState
                title="No receipts recorded yet"
                hint="A receipt collects an earlier invoice. It is not new revenue."
                actionLabel="Record Customer Receipt"
                onAction={() => setIsReceiptModalOpen(true)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Receipt Modal */}
      {isReceiptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Receipt className="h-4 w-4 text-emerald-500" />
                Record Customer Cash/Bank Receipt
              </h3>
              <button
                type="button"
                onClick={() => setIsReceiptModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordReceipt} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="customer-payer">Customer / Payer</label>
                <select id="customer-payer"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  required
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (Due: {formatCurrency(custBalance(c))})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="amount-received-pkr">Amount Received (PKR)</label>
                  <input id="amount-received-pkr"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="deposit-account">Deposit Account</label>
                  <select id="deposit-account"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="bank">Bank Account</option>
                    <option value="cash">Godown Counter Cash</option>
                    <option value="online">Online Transfer / Raast</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="cash-account">Cash account *</label>
                <select id="cash-account" value={receiptCashAccountId} onChange={(e) => setReceiptCashAccountId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required>
                  <option value="">Select account</option>
                  {cashAccounts.filter((a) => a.account_kind === paymentMethod).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                </select>
                {cashAccounts.filter((a) => a.account_kind === paymentMethod).length === 0 && (<p className="mt-1 text-[11px] text-muted-foreground">No {paymentMethod} account yet — create one on the Daybook page.</p>)}
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="allocate-to-invoice-explicit-allocation">Allocate to invoice (explicit allocation)</label>
                <select id="allocate-to-invoice-explicit-allocation" value={allocInvoiceId} onChange={(e) => { setAllocInvoiceId(e.target.value); const inv = invoices.find((i) => i.id === e.target.value); setAllocAmount(inv ? Number(inv.balance_amount ?? Number(inv.total_amount || 0) - Number(inv.paid_amount || 0)) : 0) }} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
                  <option value="">Unallocated (advance / on-account)</option>
                  {customerInvoices.map((i) => (<option key={i.id} value={i.id}>{i.invoice_no} — outstanding {formatCurrency(Number(i.balance_amount ?? Number(i.total_amount || 0) - Number(i.paid_amount || 0)))}</option>))}
                </select>
                {allocInvoiceId && (<input type="number" value={allocAmount} onChange={(e) => setAllocAmount(Number(e.target.value))} min="1" placeholder="Allocation amount" className="mt-2 w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" />)}
                <p className="mt-1 text-[11px] text-muted-foreground">Allocations are recorded on the receipt (invoice_allocations). An unallocated receipt is an on-account collection, not revenue.</p>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="cheque-bank-reference-no">Cheque / Bank Reference No</label>
                <input id="cheque-bank-reference-no"
                  type="text"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  placeholder="e.g. CHQ-991204 or Transaction ID"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="remarks-note">Remarks / Note</label>
                <input id="remarks-note"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Partial clearing of Batch 001 grading charges"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReceiptModalOpen(false)}
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
                  <span>{isPending ? "Posting…" : "Post Receipt to Daybook"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Customer Invoices</h2>
        <p className="text-xs text-muted-foreground mb-4">Invoices count as revenue when posted. Receipts only collect them.</p>
        <div className="overflow-x-auto mb-4"><table className="w-full text-left text-xs min-w-[720px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Invoice</th><th className="pb-2">Customer</th><th className="pb-2 text-right">Total</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Balance</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {invoices.length === 0 && <tr><td colSpan={6} className="py-4 text-muted-foreground">No invoices yet.</td></tr>}
            {invoices.map((i) => (<tr key={i.id}><td className="py-2 font-mono font-bold">{i.invoice_no}</td><td className="py-2">{customers.find((c) => c.id === i.customer_id)?.name ?? "Not set"}</td><td className="py-2 text-right">{formatCurrency(Number(i.total_amount || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(i.paid_amount || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(i.balance_amount ?? Number(i.total_amount || 0) - Number(i.paid_amount || 0)))}</td><td className="py-2 text-center">{i.status}{i.status === "posted" && (<button type="button" onClick={() => setInvReverseTarget(i)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Reverse</button>)}</td></tr>))}
          </tbody></table></div>
        <form onSubmit={handleCreateInvoice} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="customer">Customer *</label><select id="customer" value={invCustomerId} onChange={(e) => setInvCustomerId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select customer</option>{customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="description">Description *</label><input id="description" value={invDesc} onChange={(e) => setInvDesc(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="quantity">Quantity *</label><input id="quantity" type="number" value={invQty} onChange={(e) => setInvQty(Number(e.target.value))} min="1" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="unit-price">Unit price *</label><input id="unit-price" type="number" value={invPrice} onChange={(e) => setInvPrice(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={invPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{invPending ? "Posting…" : "Create & post invoice"}</button></div>
        </form>
      </div>
      {printReceipt && printReceipt.status === "posted" && (
        <div className="expensive-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Receipt voucher print document for {printReceipt.receipt_no}.</p>
            <div className="flex gap-2">
              <PrintButton label="Print voucher" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
              <button type="button" onClick={() => setPrintReceipt(null)} className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-semibold cursor-pointer">Close</button>
            </div>
          </div>
          <div className="hidden print:block mt-2">
            <ReceiptVoucherPrint
              receiptNo={printReceipt.receipt_no}
              date={printReceipt.date}
              customerName={printReceipt.customer_name}
              paymentMethod={printReceipt.payment_method}
              account={receiptAccountLabel(printReceipt)}
              referenceNo={printReceipt.reference_no}
              amount={printReceipt.amount}
              amountInWords={amountInWordsPKR(Number(printReceipt.amount || 0))}
              allocations={(printReceipt.invoice_allocations ?? printReceipt.allocations ?? []).map((a: any) => ({ invoiceNo: a.invoice_no, amount: a.amount }))}
              notes={printReceipt.notes}
            />
          </div>
        </div>
      )}
      <ReversalDialog open={!!receiptReverseTarget} voucherLabel={receiptReverseTarget?.receipt_no ?? ""} pending={receiptReversing} onConfirm={handleReceiptReverse} onCancel={() => setReceiptReverseTarget(null)} />
      <ReversalDialog open={!!invReverseTarget} voucherLabel={invReverseTarget?.invoice_no ?? ""} pending={invReversing} onConfirm={handleInvoiceReverse} onCancel={() => setInvReverseTarget(null)} />
      <ConfirmDialog
        open={showConfirm}
        title="Post this customer receipt?"
        description={draftReceipt ? `${draftReceipt.receipt_no}: ${formatCurrency(draftReceipt.amount)} from ${draftReceipt.customer_name || "the customer"} via ${draftReceipt.payment_method}. This is a collection, not new revenue.` : ""}
        confirmLabel="Post Receipt to Daybook"
        pending={isPending}
        onConfirm={handleConfirmReceipt}
        onCancel={() => { setShowConfirm(false); setDraftReceipt(null) }}
      />
    </div>
  )
}
