"use client"

import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"

import * as React from "react"
import {
  Receipt,
  Plus,
  Building2,
  DollarSign,
  FileText,
  Printer,
  CreditCard,
  TrendingUp,
} from "lucide-react"
import { listReceipts, listInvoices, postReceipt, reverseReceipt, createInvoice, postInvoice, reverseInvoice, listCashAccounts } from "@/app/actions/finance"
import { amountInWordsPKR, customerBalanceNetOfAdvances } from "@/lib/calc/finance"
import { listParties, createParty } from "@/app/actions/masters"
import { InvoicePrint } from "@/components/print/invoice-print"
import { InlineAdd, PARTY_FIELDS } from "@/components/print/inline-add"
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
  getUrlFilter,
} from "@/components/erp-ui"
import { BillingReceiptDialog } from "@/components/billing-receipt-dialog"
import { BillingSkeleton } from "@/components/route-skeletons"

export default function BillingPage() {
  const [receipts, setReceipts] = React.useState<CustomerReceipt[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])

  // Modal
  const [isReceiptModalOpen, setIsReceiptModalOpen] = React.useState(false)
  const [receiptCustomerPreset, setReceiptCustomerPreset] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const invoiceTokenRef = React.useRef<string | null>(null)
  const [receiptPage, setReceiptPage] = React.useState(1)
  const [invoicePage, setInvoicePage] = React.useState(1)
  const [totalReceipts, setTotalReceipts] = React.useState(0)
  const [totalInvoices, setTotalInvoices] = React.useState(0)
  const pageSize = 50
  const [invoices, setInvoices] = React.useState<any[]>([])
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  const [printReceipt, setPrintReceipt] = React.useState<any | null>(null)
  const [printInvoice, setPrintInvoice] = React.useState<any | null>(null)
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
      const [re, inv, pa, ca] = await Promise.all([listReceipts({ page: receiptPage, pageSize }), listInvoices({ page: invoicePage, pageSize }), listParties(), listCashAccounts()])
      const failed = [re, inv, pa, ca].find((x) => !x.success)
      setCashAccounts(Array.isArray(ca.data) ? ca.data : [])
      if (failed) setFormError(failed.error ?? "Could not load billing data.")
      const partyList = (Array.isArray(pa.data) ? pa.data : []) as Party[]
      setCustomers(partyList.filter((x) => x.type === "customer" || x.type === "both"))
      // Paged shape { rows, total } or the legacy plain array.
      const invRows = Array.isArray(inv.data) ? inv.data : ((inv.data as any)?.rows ?? [])
      const reRows = Array.isArray(re.data) ? re.data : ((re.data as any)?.rows ?? [])
      setTotalInvoices(Array.isArray(inv.data) ? inv.data.length : Number((inv.data as any)?.total ?? 0))
      setTotalReceipts(Array.isArray(re.data) ? re.data.length : Number((re.data as any)?.total ?? 0))
      setInvoices(invRows)
      setReceipts((reRows as any[]).map((row: any) => ({
        ...row,
        customer_name: partyList.find((x) => x.id === row.customer_id)?.name ?? "Not set",
        payment_method: row.account ?? row.payment_method,
      })))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load billing data.")
    } finally {
      setIsLoading(false)
    }
  }, [receiptPage, invoicePage])

  // Mount load: without this the page never leaves its skeleton —
  // isLoading starts true and only post-action handlers reloaded before.
  // Dashboard drill-down links (?filter=receivable) apply on mount too.
  React.useEffect(() => { loadData(); setDrillFilter(getUrlFilter()) }, [loadData])

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

  const handlePostReceiptDraft = async (row: any) => {
    if (isPending) return
    setIsPending(true)
    try {
      const posted = await postReceipt(row.id)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the receipt.")
        return
      }
      const postedRow: any = posted.data ?? row
      const selectedCust = customers.find((c) => c.id === row.customer_id)
      setFormNotice(`${postedRow.receipt_no ?? row.receipt_no} posted — ${formatCurrency(Number(row.amount || 0))} received from ${selectedCust?.name ?? row.customer_name ?? "the customer"}.`)
      setPrintReceipt({ ...row, ...postedRow, status: "posted", customer_name: selectedCust?.name ?? row.customer_name })
      await loadData()
    } finally {
      setIsPending(false)
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
    if (invQty * invPrice <= 0) {
      setFormError("Invoice total must be greater than zero — set a unit price above zero.")
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
      setPrintInvoice({
        ...row,
        customer_id: invCustomerId,
        invoice_lines: (row.invoice_lines ?? row.lines ?? []).length > 0
          ? (row.invoice_lines ?? row.lines)
          : [{ description: invDesc.trim(), quantity: invQty, unit_price: invPrice, line_total: invQty * invPrice }],
        total_amount: row.total_amount ?? invQty * invPrice,
        paid_amount: row.paid_amount ?? 0,
        balance_amount: row.balance_amount ?? invQty * invPrice,
        status: "posted",
      })
      resetSubmissionToken(invoiceTokenRef)
      await loadData()
    } finally { setInvPending(false) }
  }

  const handleSaveInvoiceDraft = async () => {
    if (invPending) return
    if (!invCustomerId || !invDesc.trim() || !(invQty > 0) || invPrice < 0) {
      setFormError("Invoice needs a customer, a description, a positive quantity and a non-negative price.")
      return
    }
    if (invQty * invPrice <= 0) {
      setFormError("Invoice total must be greater than zero — set a unit price above zero.")
      return
    }
    setInvPending(true)
    try {
      const created = await createInvoice({
        customerId: invCustomerId, sourceType: "manual", clientToken: submissionToken(invoiceTokenRef, "invoice"),
        lines: [{ description: invDesc.trim(), quantity: invQty, unitPrice: invPrice }],
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not save the invoice draft.")
        return
      }
      const row: any = created.data
      setFormNotice(`Invoice ${row.invoice_no ?? ""} saved as draft — post it from the invoices table below.`)
      resetSubmissionToken(invoiceTokenRef)
      await loadData()
    } finally { setInvPending(false) }
  }

  const handlePostInvoiceDraft = async (row: any) => {
    if (invPending) return
    setInvPending(true)
    try {
      const posted = await postInvoice(row.id)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the invoice.")
        return
      }
      const postedRow: any = posted.data ?? row
      setPrintInvoice({
        ...row,
        ...postedRow,
        invoice_lines: (postedRow.invoice_lines ?? postedRow.lines ?? row.invoice_lines ?? row.lines ?? []).length > 0
          ? (postedRow.invoice_lines ?? postedRow.lines ?? row.invoice_lines ?? row.lines)
          : [{ description: postedRow.notes ?? "Invoice", quantity: 1, unit_price: Number(postedRow.total_amount || row.total_amount || 0), line_total: Number(postedRow.total_amount || row.total_amount || 0) }],
        status: "posted",
      })
      setFormNotice(`Invoice ${postedRow.invoice_no ?? row.invoice_no} posted for ${formatCurrency(Number(postedRow.total_amount ?? row.total_amount ?? 0))}.`)
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
                            setReceiptCustomerPreset(c.id)
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
                  {(r as any).status === "draft" && (<button type="button" onClick={() => handlePostReceiptDraft(r)} className="px-2 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Post</button>)}
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Showing {receipts.length === 0 ? 0 : (receiptPage - 1) * pageSize + 1}–{(receiptPage - 1) * pageSize + receipts.length} of {totalReceipts} receipts</span>
              <span className="flex gap-2">
                <button type="button" disabled={receiptPage <= 1} onClick={() => setReceiptPage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Previous</button>
                <button type="button" disabled={receiptPage * pageSize >= totalReceipts} onClick={() => setReceiptPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Next</button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <BillingReceiptDialog
        open={isReceiptModalOpen}
        onClose={() => {
          setIsReceiptModalOpen(false)
          setReceiptCustomerPreset(null)
        }}
        customers={customers}
        cashAccounts={cashAccounts}
        invoices={invoices}
        recordCount={receipts.length}
        initialCustomerId={receiptCustomerPreset}
        customerBalance={custBalance}
        onPosted={(notice, printReceipt) => {
          setFormNotice(notice)
          setPrintReceipt(printReceipt)
          void loadData()
        }}
        onDraftSaved={(notice) => {
          setFormNotice(notice)
          void loadData()
        }}
      />
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Customer Invoices</h2>
        <p className="text-xs text-muted-foreground mb-4">Invoices count as revenue when posted. Receipts only collect them.</p>
        <div className="overflow-x-auto mb-4"><table className="w-full text-left text-xs min-w-[720px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Invoice</th><th className="pb-2">Date</th><th className="pb-2">Customer</th><th className="pb-2 text-right">Total</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Balance</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {invoices.length === 0 && <tr><td colSpan={7} className="py-4"><EmptyState title="No invoices yet" hint="An invoice bills a customer for work done. Create one in the form below — it posts as revenue, and receipts collect it." actionLabel="Create invoice" onAction={() => document.getElementById("customer")?.focus()} /></td></tr>}
            {invoices.map((i) => (<tr key={i.id}><td className="py-2 font-mono font-bold">{i.invoice_no}</td><td className="py-2 text-muted-foreground">{formatDate(i.date)}</td><td className="py-2">{customers.find((c) => c.id === i.customer_id)?.name ?? "Not set"}</td><td className="py-2 text-right">{formatCurrency(Number(i.total_amount || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(i.paid_amount || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(i.balance_amount ?? Number(i.total_amount || 0) - Number(i.paid_amount || 0)))}</td><td className="py-2 text-center">{i.status}{i.status === "draft" && (<button type="button" onClick={() => handlePostInvoiceDraft(i)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Post</button>)}<button type="button" onClick={() => setPrintInvoice(i)} className="ml-2 px-2 py-0.5 rounded-md bg-card hover:bg-muted border border-border text-[11px] font-semibold cursor-pointer">Print</button>{i.status === "posted" && (<button type="button" onClick={() => setInvReverseTarget(i)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Reverse</button>)}</td></tr>))}
          </tbody></table>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Showing {invoices.length === 0 ? 0 : (invoicePage - 1) * pageSize + 1}–{(invoicePage - 1) * pageSize + invoices.length} of {totalInvoices} invoices</span>
            <span className="flex gap-2">
              <button type="button" disabled={invoicePage <= 1} onClick={() => setInvoicePage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Previous</button>
              <button type="button" disabled={invoicePage * pageSize >= totalInvoices} onClick={() => setInvoicePage((p) => p + 1)} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Next</button>
            </span>
          </div></div>
        <form onSubmit={handleCreateInvoice} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="customer">Customer *</label><div className="flex flex-wrap items-start gap-2"><select id="customer" title={customers.find((c) => c.id === invCustomerId)?.name ?? ""} value={invCustomerId} onChange={(e) => setInvCustomerId(e.target.value)} className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select customer</option>{customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select> <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "customer" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) setCustomers((r.data as any[]).filter((x) => x.type === "customer" || x.type === "both")); setInvCustomerId(id); }} /></div></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="description">Description *</label><input id="description" value={invDesc} onChange={(e) => setInvDesc(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="quantity">Quantity *</label><input id="quantity" type="number" value={invQty} onChange={(e) => setInvQty(Number(e.target.value))} min="1" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="unit-price">Unit price *</label><input id="unit-price" type="number" value={invPrice} onChange={(e) => setInvPrice(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-3"><span className="font-semibold text-foreground">Line amount: {formatCurrency(invQty * invPrice)}</span><span className="flex gap-2"><button type="button" onClick={handleSaveInvoiceDraft} disabled={invPending} className="px-4 py-2 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-60">Save as draft</button><button type="submit" disabled={invPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{invPending ? "Posting…" : "Create & post invoice"}</button></span></div>
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
              date={formatDate(printReceipt.date)}
              customerName={printReceipt.customer_name}
              paymentMethod={printReceipt.payment_method}
              account={receiptAccountLabel(printReceipt)}
              referenceNo={printReceipt.reference_no}
              purpose={printReceipt.purpose}
              receivedBy={printReceipt.received_by ?? printReceipt.receivedBy}
              amount={printReceipt.amount}
              amountInWords={amountInWordsPKR(Number(printReceipt.amount || 0))}
              allocations={(printReceipt.invoice_allocations ?? printReceipt.allocations ?? []).map((a: any) => ({ invoiceNo: a.invoice_no, amount: a.amount }))}
              notes={printReceipt.notes}
            />
          </div>
        </div>
      )}
      {printInvoice && (
        <div className="expensive-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Invoice print document for {printInvoice.invoice_no}.</p>
            <div className="flex gap-2">
              <PrintButton label="Print invoice" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
              <button type="button" onClick={() => setPrintInvoice(null)} className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-semibold cursor-pointer">Close</button>
            </div>
          </div>
          <div className="hidden print:block mt-2">
            <InvoicePrint
              invoiceNo={printInvoice.invoice_no}
              date={formatDate(printInvoice.date)}
              customerName={customers.find((c) => c.id === printInvoice.customer_id)?.name ?? printInvoice.customer_name}
              status={printInvoice.status}
              lines={(printInvoice.invoice_lines ?? printInvoice.lines ?? []).length > 0 ? (printInvoice.invoice_lines ?? printInvoice.lines).map((l: any) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unit_price ?? l.unitPrice, amount: l.line_total ?? l.amount })) : [{ description: printInvoice.notes ?? "Invoice", quantity: 1, unitPrice: Number(printInvoice.total_amount || 0), amount: Number(printInvoice.total_amount || 0) }]}
              total={printInvoice.total_amount}
              paid={printInvoice.paid_amount}
              balance={printInvoice.balance_amount}
              notes={printInvoice.notes}
            />
          </div>
        </div>
      )}
      <ReversalDialog open={!!receiptReverseTarget} voucherLabel={receiptReverseTarget?.receipt_no ?? ""} pending={receiptReversing} onConfirm={handleReceiptReverse} onCancel={() => setReceiptReverseTarget(null)} />
      <ReversalDialog open={!!invReverseTarget} voucherLabel={invReverseTarget?.invoice_no ?? ""} pending={invReversing} onConfirm={handleInvoiceReverse} onCancel={() => setInvReverseTarget(null)} />
    </div>
  )
}
