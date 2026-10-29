"use client"

/**
 * Customer receipt dialog, POS-style: one modal form that owns its
 * own state, on the shared Modal kit — replacing the hand-rolled
 * `fixed inset-0 ... bg-black/60` receipt modal on the Billing page.
 * Same fields, same validation, same server actions, same
 * draft → post → print behaviour as the old modal.
 *
 * The Billing page's invoice form is an inline card, not a modal, so
 * it is untouched. The receipt print document still comes from the
 * page: this dialog hands the finished print row back via onPosted.
 */
import * as React from "react"
import { CheckCircle2 } from "lucide-react"
import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"
import { createReceipt, postReceipt } from "@/app/actions/finance"
import { listParties, createParty } from "@/app/actions/masters"
import { InlineAdd, PARTY_FIELDS } from "@/components/print/inline-add"
import type { CustomerReceipt, Party } from "@/lib/types/database"
import { formatCurrency } from "@/lib/utils"
import { ConfirmDialog, SubmitSpinner, isPositive } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function BillingReceiptDialog({
  open,
  onClose,
  customers: customersProp,
  cashAccounts,
  invoices,
  recordCount,
  initialCustomerId,
  customerBalance,
  onPosted,
  onDraftSaved,
}: {
  open: boolean
  onClose: () => void
  customers: Party[]
  cashAccounts: any[]
  invoices: any[]
  /** receipts.length — only used for the draft preview number. */
  recordCount: number
  /** Set by the Customers table "Collect Cash" button; null = New Receipt. */
  initialCustomerId: string | null
  /** The page's balance function (opening + posted invoices − unapplied receipts). */
  customerBalance: (c: Party) => number
  /** (notice, print row) — the page sets its notice, shows the print document and reloads. */
  onPosted: (notice: string, printReceipt: any) => void
  onDraftSaved: (notice: string) => void
}) {
  const [customers, setCustomers] = React.useState<Party[]>(customersProp)
  const [customerId, setCustomerId] = React.useState("")
  const [amount, setAmount] = React.useState<number>(100000)
  const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "bank" | "online">("bank")
  const [receiptCashAccountId, setReceiptCashAccountId] = React.useState("")
  const [allocInvoiceId, setAllocInvoiceId] = React.useState("")
  const [allocAmount, setAllocAmount] = React.useState<number>(0)
  const [referenceNo, setReferenceNo] = React.useState("")
  const [purpose, setPurpose] = React.useState("")
  const [receivedBy, setReceivedBy] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [error, setError] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftReceipt, setDraftReceipt] = React.useState<CustomerReceipt | null>(null)
  const receiptGuard = React.useRef(false)
  const receiptTokenRef = React.useRef<string | null>(null)

  // Fresh create on every open. A "Collect Cash" preset wins over the
  // first-customer default; otherwise the form starts on the first
  // customer, the first account of the default (bank) kind, and the
  // old defaults, exactly as the old page effect filled them.
  React.useEffect(() => {
    if (!open) return
    setCustomers(customersProp)
    const firstCustomer = customersProp.find((c) => c.id === initialCustomerId) ?? customersProp[0]
    setCustomerId(firstCustomer?.id ?? "")
    setAmount(100000)
    setPaymentMethod("bank")
    const firstAccount = cashAccounts.find((a) => a.account_kind === "bank") ?? cashAccounts[0]
    setReceiptCashAccountId(firstAccount?.id ?? "")
    setAllocInvoiceId("")
    setAllocAmount(0)
    setReferenceNo("")
    setPurpose("")
    setReceivedBy("")
    setNotes("")
    setError("")
    setIsPending(false)
    setShowConfirm(false)
    setDraftReceipt(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const customerInvoices = invoices.filter((i) => i.customer_id === customerId && i.status === "posted" && Number(i.balance_amount ?? Number(i.total_amount || 0) - Number(i.paid_amount || 0)) > 0)

  const receiptFormError = (): string | null => {
    if (!customerId) return "Select the customer paying this receipt."
    if (!isPositive(amount)) return "Receipt amount must be greater than zero."
    if (!receiptCashAccountId) return "Select a cash account for this receipt. Create one on the Daybook page first if none exists."
    const selectedCust = customers.find((c) => c.id === customerId)
    const bal = selectedCust ? customerBalance(selectedCust) : 0
    if (allocInvoiceId && allocAmount > amount) return `Allocation (${formatCurrency(allocAmount)}) cannot exceed the receipt amount (${formatCurrency(amount)}).`
    if (allocInvoiceId && allocAmount <= 0) return "An allocation amount must be greater than zero."
    if (allocInvoiceId) {
      const target = invoices.find((i) => i.id === allocInvoiceId)
      const targetBal = target ? Number(target.balance_amount ?? Number(target.total_amount || 0) - Number(target.paid_amount || 0)) : 0
      if (allocAmount > targetBal) return `Allocation (${formatCurrency(allocAmount)}) exceeds invoice ${target?.invoice_no ?? ""} balance (${formatCurrency(targetBal)}).`
    }
    if (!allocInvoiceId && amount > bal && bal > 0) return `Receipt (${formatCurrency(amount)}) exceeds ${selectedCust?.name || "this customer"}'s outstanding balance (${formatCurrency(bal)}). Allocate it to a specific invoice, or record the balance amount or less.`
    return null
  }

  const receiptPayload = () => ({
    customerId, cashAccountId: receiptCashAccountId, account: paymentMethod, amount,
    referenceNo: referenceNo || undefined, purpose: purpose || undefined,
    receivedBy: receivedBy || undefined, notes: notes || undefined,
    clientToken: submissionToken(receiptTokenRef, "receipt"),
    allocations: allocInvoiceId && allocAmount > 0 ? [{ invoiceId: allocInvoiceId, amount: allocAmount }] : [],
  })

  const handleRecordReceipt = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    const validationError = receiptFormError()
    if (validationError) return setError(validationError)
    setError("")
    const selectedCust = customers.find((c) => c.id === customerId)
    const receiptNo = `RCT-2026-${String(recordCount + 1).padStart(3, "0")}`
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
      const created = await createReceipt(receiptPayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not create the receipt.")
        setShowConfirm(false)
        return
      }
      const posted = await postReceipt((created.data as any).id)
      if (!posted.success) {
        setError(posted.error ?? "Could not post the receipt.")
        setShowConfirm(false)
        return
      }
      const row: any = posted.data ?? created.data
      const selectedCust = customers.find((c) => c.id === customerId)
      const notice = `${row.receipt_no ?? draftReceipt.receipt_no} posted — ${formatCurrency(amount)} received from ${selectedCust?.name} via ${paymentMethod}. Receivable reduced; cash/bank increased.`
      const printReceipt = { ...draftReceipt, receipt_no: row.receipt_no ?? draftReceipt.receipt_no, status: "posted", customer_name: selectedCust?.name, purpose: purpose || undefined, received_by: receivedBy || undefined, allocations: allocInvoiceId ? [{ invoice_no: invoices.find((i) => i.id === allocInvoiceId)?.invoice_no, amount: allocAmount }] : [] }
      onClose()
      onPosted(notice, printReceipt)
      resetSubmissionToken(receiptTokenRef)
      setDraftReceipt(null)
    } finally {
      setIsPending(false)
      receiptGuard.current = false
    }
  }

  const handleSaveReceiptDraft = async () => {
    if (isPending) return
    const validationError = receiptFormError()
    if (validationError) return setError(validationError)
    setIsPending(true)
    try {
      const created = await createReceipt(receiptPayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not save the receipt draft.")
        return
      }
      const row: any = created.data
      onDraftSaved(`${row.receipt_no ?? "Receipt"} saved as draft — post it from the receipts list.`)
      onClose()
      resetSubmissionToken(receiptTokenRef)
    } finally {
      setIsPending(false)
    }
  }

  if (!open) return null
  return (
    <>
      <Modal
        open={open}
        onClose={showConfirm ? () => {} : onClose}
        title="Record Customer Cash/Bank Receipt"
        description="A receipt collects an earlier invoice. It is not new revenue."
        wide
      >
        <form onSubmit={handleRecordReceipt} className="space-y-4 text-xs">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <Field id="customer-payer" label="Customer / Payer" required>
            <div className="flex flex-wrap items-start gap-2">
              <select
                id="customer-payer"
                title={customers.find((c) => c.id === customerId)?.name ?? ""}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className={`${inputClass} flex-1 min-w-0`}
                required
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (Due: {formatCurrency(customerBalance(c))})
                  </option>
                ))}
              </select>
              <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "customer" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) setCustomers((r.data as any[]).filter((x) => x.type === "customer" || x.type === "both")); setCustomerId(id); }} />
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="amount-received-pkr" label="Amount Received (PKR)" required>
              <input
                id="amount-received-pkr"
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                min="1"
                className={`${inputClass} font-mono`}
                required
              />
            </Field>
            <Field id="deposit-account" label="Deposit Account" required>
              <select
                id="deposit-account"
                required
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className={inputClass}
              >
                <option value="bank">Bank Account</option>
                <option value="cash">Godown Counter Cash</option>
                <option value="online">Online Transfer / Raast</option>
              </select>
            </Field>
          </div>

          <Field id="cash-account" label="Cash account" required>
            <select
              id="cash-account"
              title={cashAccounts.find((a) => a.id === receiptCashAccountId) ? `${cashAccounts.find((a) => a.id === receiptCashAccountId)?.code} — ${cashAccounts.find((a) => a.id === receiptCashAccountId)?.name}` : ""}
              value={receiptCashAccountId}
              onChange={(e) => setReceiptCashAccountId(e.target.value)}
              className={inputClass}
              required
            >
              <option value="">Select account</option>
              {cashAccounts.filter((a) => a.account_kind === paymentMethod).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
            </select>
            {cashAccounts.filter((a) => a.account_kind === paymentMethod).length === 0 && (<p className="mt-1 text-[11px] text-muted-foreground">No {paymentMethod} account yet — create one on the Daybook page.</p>)}
          </Field>

          <Field id="allocate-to-invoice-explicit-allocation" label="Allocate to invoice (explicit allocation)">
            <select
              id="allocate-to-invoice-explicit-allocation"
              title={invoices.find((i) => i.id === allocInvoiceId)?.invoice_no ?? ""}
              value={allocInvoiceId}
              onChange={(e) => { setAllocInvoiceId(e.target.value); const inv = invoices.find((i) => i.id === e.target.value); setAllocAmount(inv ? Number(inv.balance_amount ?? Number(inv.total_amount || 0) - Number(inv.paid_amount || 0)) : 0) }}
              className={inputClass}
            >
              <option value="">Unallocated (advance / on-account)</option>
              {customerInvoices.map((i) => (<option key={i.id} value={i.id}>{i.invoice_no} — outstanding {formatCurrency(Number(i.balance_amount ?? Number(i.total_amount || 0) - Number(i.paid_amount || 0)))}</option>))}
            </select>
            {allocInvoiceId && (<><input type="number" value={allocAmount} onChange={(e) => setAllocAmount(Number(e.target.value))} min="1" placeholder="Allocation amount" aria-label="Allocation amount" className="mt-2 w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /><p className="mt-1 text-[11px] text-muted-foreground">Allocated {formatCurrency(allocAmount)} of {formatCurrency(amount)} — unallocated remainder {formatCurrency(amount - allocAmount)}.</p></>)}
            <p className="mt-1 text-[11px] text-muted-foreground">Allocations are recorded on the receipt (invoice_allocations). An unallocated receipt is an on-account collection, not revenue.</p>
          </Field>

          <Field id="cheque-bank-reference-no" label="Cheque / Bank Reference No">
            <input
              id="cheque-bank-reference-no"
              type="text"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder="e.g. CHQ-991204 or Transaction ID"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="receipt-purpose" label="Purpose (optional)">
              <input
                id="receipt-purpose"
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Grading charges for Batch 001"
                className={inputClass}
              />
            </Field>
            <Field id="received-by" label="Received by (optional)">
              <input
                id="received-by"
                type="text"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                placeholder="Name of person who received the money"
                className={inputClass}
              />
            </Field>
          </div>

          <Field id="remarks-note" label="Remarks / Note">
            <input
              id="remarks-note"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Partial clearing of Batch 001 grading charges"
              className={inputClass}
            />
          </Field>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveReceiptDraft}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              Save as draft
            </button>
            <button type="submit" disabled={isPending} className={primaryButtonClass}>
              {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{isPending ? "Posting…" : "Post Receipt to Daybook"}</span>
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={showConfirm}
        title="Post this customer receipt?"
        description={draftReceipt ? `${draftReceipt.receipt_no}: ${formatCurrency(draftReceipt.amount)} from ${draftReceipt.customer_name || "the customer"} via ${draftReceipt.payment_method}. This is a collection, not new revenue.` : ""}
        confirmLabel="Post Receipt to Daybook"
        pending={isPending}
        onConfirm={handleConfirmReceipt}
        onCancel={() => { setShowConfirm(false); setDraftReceipt(null) }}
      />
    </>
  )
}
