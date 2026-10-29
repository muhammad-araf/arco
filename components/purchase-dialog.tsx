"use client"

/**
 * Purchase invoice dialog, POS-style: one modal form that owns its
 * own state, on the shared Modal kit — replacing the hand-rolled
 * `fixed inset-0 ... bg-black/60` creation modal on the Purchases
 * page. Same fields, same validation, same server actions, same
 * draft → post → print behaviour as the old modal.
 *
 * One confirmed error fixed here: the old form carried a `notes`
 * value into its draft payload but had no Notes input, so notes could
 * never be entered. A Notes field is added; the payload is unchanged.
 *
 * Note on scope: the page's inline "Pay a posted purchase" section
 * used to share its cash-account state with this modal. The dialog
 * now owns its own payment-account state, so changing the account
 * here no longer changes the Pay section's selection (and vice
 * versa); both still start from the same first-account default.
 * The old modal was max-w-3xl; the shared Modal's wide size is
 * max-w-2xl, so this dialog is slightly narrower than before.
 */
import * as React from "react"
import { CheckCircle2 } from "lucide-react"
import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"
import { createPurchase, postPurchase, allocatePayment } from "@/app/actions/finance"
import {
  listParties,
  listGodowns,
  listProducts,
  createParty,
  createGodown,
  createProduct,
} from "@/app/actions/masters"
import {
  InlineAdd,
  PARTY_FIELDS,
  GODOWN_FIELDS,
  PRODUCT_FIELDS,
} from "@/components/print/inline-add"
import type { PurchaseVoucher, Party, Godown, Product } from "@/lib/types/database"
import { formatCurrency } from "@/lib/utils"
import { ConfirmDialog, SubmitSpinner, isPositive } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export type PurchaseLine = {
  key: number
  productId: string
  quantity: number
  unitPrice: number
}

export function PurchaseDialog({
  open,
  onClose,
  vendors: vendorsProp,
  godowns: godownsProp,
  products: productsProp,
  cashAccounts,
  totalPurchases,
  onPosted,
  onDraftSaved,
}: {
  open: boolean
  onClose: () => void
  vendors: Party[]
  godowns: Godown[]
  products: Product[]
  cashAccounts: any[]
  /** purchases total — only used for the draft preview number. */
  totalPurchases: number
  /** (notice, print row) — the page sets its notice, shows the print document and reloads. */
  onPosted: (notice: string, printPurchase: any) => void
  onDraftSaved: (notice: string) => void
}) {
  const [vendors, setVendors] = React.useState<Party[]>(vendorsProp)
  const [godowns, setGodowns] = React.useState<Godown[]>(godownsProp)
  const [products, setProducts] = React.useState<Product[]>(productsProp)
  const [vendorId, setVendorId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [invoiceRef, setInvoiceRef] = React.useState("")
  const [lines, setLines] = React.useState<PurchaseLine[]>([{ key: 1, productId: "", quantity: 10000, unitPrice: 115 }])
  const [paidAmount, setPaidAmount] = React.useState<number>(500000)
  const [notes, setNotes] = React.useState("")
  const [payCashAccountId, setPayCashAccountId] = React.useState("")
  const [payAccountKind, setPayAccountKind] = React.useState<"cash" | "bank" | "online">("cash")
  const [error, setError] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftPurchase, setDraftPurchase] = React.useState<PurchaseVoucher | null>(null)
  const purchaseGuard = React.useRef(false)
  const purchaseTokenRef = React.useRef<string | null>(null)
  const confirmPayTokenRef = React.useRef<string | null>(null)

  // Fresh create on every open, with the same first-item defaults the
  // old page effect applied. Closing without saving discards edits.
  React.useEffect(() => {
    if (!open) return
    setVendors(vendorsProp)
    setGodowns(godownsProp)
    setProducts(productsProp)
    setVendorId(vendorsProp[0]?.id ?? "")
    setGodownId(godownsProp[0]?.id ?? "")
    setInvoiceRef("")
    setLines([{ key: 1, productId: productsProp[0]?.id ?? "", quantity: 10000, unitPrice: 115 }])
    setPaidAmount(500000)
    setNotes("")
    const firstAccount = cashAccounts.find((a) => a.account_kind === "cash") ?? cashAccounts[0]
    setPayCashAccountId(firstAccount?.id ?? "")
    setPayAccountKind(firstAccount ? (firstAccount.account_kind as "cash" | "bank" | "online") : "cash")
    setError("")
    setIsPending(false)
    setShowConfirm(false)
    setDraftPurchase(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const totalAmount = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0)
  const balanceAmount = totalAmount - paidAmount

  const handleRecordPurchase = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    if (!vendorId) return setError("Select the supplier / vendor for this purchase.")
    if (!godownId) return setError("Select the godown receiving this purchase.")
    if (lines.length === 0) return setError("Add at least one purchase line.")
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].productId) return setError(`Line ${i + 1}: select the product being purchased.`)
      if (!isPositive(lines[i].quantity)) return setError(`Line ${i + 1}: quantity must be greater than zero.`)
      if (!isPositive(lines[i].unitPrice)) return setError(`Line ${i + 1}: unit price must be greater than zero.`)
    }
    if (paidAmount < 0) return setError("Paid amount cannot be negative.")
    if (paidAmount > 0 && !payCashAccountId) return setError("Select a cash account for the payment at purchase. Create one on the Daybook page first if none exists.")
    if (paidAmount > totalAmount) return setError(`Paid amount (${formatCurrency(paidAmount)}) exceeds the invoice total (${formatCurrency(totalAmount)}). A payment is allocated to a specific invoice and cannot overpay it.`)
    setError("")
    const selectedVendor = vendors.find((v) => v.id === vendorId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const purchaseNo = `PUR-2026-${String(totalPurchases + 1).padStart(3, "0")}`
    setDraftPurchase({
      id: `pur-${Date.now()}`,
      purchase_no: purchaseNo,
      date: new Date().toISOString(),
      vendor_id: vendorId,
      vendor_name: selectedVendor?.name,
      invoice_ref: invoiceRef || undefined,
      godown_id: godownId,
      godown_name: selectedGodown?.name,
      total_amount: totalAmount,
      paid_amount: paidAmount,
      balance_amount: balanceAmount,
      status: "posted",
      notes: notes || undefined,
      items: lines.map((l, i) => ({
        id: `puri-${Date.now()}-${i}`,
        purchase_id: `pur-${Date.now()}`,
        product_id: l.productId,
        product_name: products.find((p) => p.id === l.productId)?.name,
        item_type: "seed",
        quantity: l.quantity,
        unit: "kg",
        unit_price: l.unitPrice,
        line_total: (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
      })),
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const purchasePayload = () => ({
    vendorId, invoiceRef: invoiceRef || undefined, godownId: godownId || undefined,
    notes: notes || undefined, clientToken: submissionToken(purchaseTokenRef, "purchase"),
    items: lines.map((l) => ({ itemType: "seed" as const, productId: l.productId, quantity: l.quantity, unit: "kg", unitPrice: l.unitPrice })),
  })

  const handleConfirmPurchase = async () => {
    if (!draftPurchase || purchaseGuard.current) return
    purchaseGuard.current = true
    setIsPending(true)
    try {
      const created = await createPurchase(purchasePayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not create the purchase draft.")
        setShowConfirm(false)
        return
      }
      const posted = await postPurchase((created.data as any).id)
      if (!posted.success) {
        setError(posted.error ?? "Could not post the purchase.")
        setShowConfirm(false)
        return
      }
      let payNote = ""
      let payOk = false
      if (paidAmount > 0) {
        const pay = await allocatePayment({
          vendorId, cashAccountId: payCashAccountId, account: payAccountKind, amount: paidAmount, settlementKind: "purchase",
          clientToken: submissionToken(confirmPayTokenRef, "vendorpay"),
          allocations: [{ targetType: "purchase", targetId: (created.data as any).id, amount: paidAmount }],
        })
        payOk = pay.success
        payNote = pay.success ? ` Paid ${formatCurrency(paidAmount)} allocated to it.` : ` Payment of ${formatCurrency(paidAmount)} could not be allocated: ${pay.error ?? "unknown error"} — pay it later from the Pay section below.`
      }
      const row: any = posted.data ?? created.data
      const balanceAfter = payOk ? draftPurchase.balance_amount : (row.balance_amount ?? draftPurchase.balance_amount)
      const notice = `${row.purchase_no ?? draftPurchase.purchase_no} posted — remaining balance ${formatCurrency(balanceAfter)} owed to ${draftPurchase.vendor_name || "the vendor"}.${payNote}`
      const printPurchase = { ...draftPurchase, purchase_no: row.purchase_no ?? draftPurchase.purchase_no, status: "posted", paid_amount: payOk ? paidAmount : draftPurchase.paid_amount, balance_amount: balanceAfter }
      onClose()
      onPosted(notice, printPurchase)
      resetSubmissionToken(purchaseTokenRef)
      resetSubmissionToken(confirmPayTokenRef)
      setDraftPurchase(null)
    } finally {
      setIsPending(false)
      purchaseGuard.current = false
    }
  }

  const handleSaveDraft = async () => {
    if (isPending) return
    if (!vendorId) return setError("Select the supplier / vendor before saving a draft.")
    if (lines.length === 0) return setError("Add at least one purchase line before saving a draft.")
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].productId) return setError(`Line ${i + 1}: select the product being purchased before saving a draft.`)
    }
    setError("")
    setIsPending(true)
    try {
      const created = await createPurchase(purchasePayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not save the purchase draft.")
        return
      }
      onDraftSaved(`${(created.data as any).purchase_no ?? "Purchase"} saved as a draft — no payable or payment has been recorded yet. Post it from the draft list below.`)
      resetSubmissionToken(purchaseTokenRef)
      onClose()
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
        title="Record Vendor Purchase Invoice"
        description="One invoice, one or more seed products. The total is the sum of all lines."
        wide
      >
        <form onSubmit={handleRecordPurchase} className="space-y-4 text-xs">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="supplier-grower" label="Supplier / Grower" required>
              <div className="flex flex-wrap items-start gap-2">
                <select
                  id="supplier-grower"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className={`${inputClass} flex-1 min-w-0`}
                  required
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "supplier" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) setVendors((r.data as any[]).filter((x) => x.type === "supplier" || x.type === "both")); setVendorId(id); }} />
              </div>
            </Field>
            <Field id="unloading-godown" label="Unloading Godown" required>
              <div className="flex flex-wrap items-start gap-2">
                <select
                  id="unloading-godown"
                  value={godownId}
                  onChange={(e) => setGodownId(e.target.value)}
                  className={`${inputClass} flex-1 min-w-0`}
                  required
                >
                  {godowns.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <InlineAdd label="Godown" fields={GODOWN_FIELDS} createAction={async (v) => createGodown({ code: v.code, name: v.name })} onCreated={async (id) => { const r = await listGodowns(); if (r.success && Array.isArray(r.data)) setGodowns(r.data as any[]); setGodownId(id); }} />
              </div>
            </Field>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">Purchase lines — add as many products as this invoice covers. The total is the sum of all lines.</p>
            {lines.map((line, idx) => (
              <div key={line.key} className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor={`purchased-product-${line.key}`}>Purchased Product *</label>
                  <div className="flex flex-wrap items-start gap-2">
                    <select
                      id={`purchased-product-${line.key}`}
                      value={line.productId}
                      onChange={(e) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, productId: e.target.value } : l)))}
                      className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    >
                      <option value="">Select product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) setProducts(r.data as any[]); setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, productId: id } : l))); }} />
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor={`quantity-kg-${line.key}`}>Quantity (kg) *</label>
                  <input
                    id={`quantity-kg-${line.key}`}
                    type="number"
                    value={line.quantity}
                    onChange={(e) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, quantity: Number(e.target.value) } : l)))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block font-medium text-foreground mb-1" htmlFor={`unit-price-kg-pkr-${line.key}`}>Unit Price / kg (PKR) *</label>
                    <input
                      id={`unit-price-kg-pkr-${line.key}`}
                      type="number"
                      value={line.unitPrice}
                      onChange={(e) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, unitPrice: Number(e.target.value) } : l)))}
                      min="1"
                      className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                      required
                    />
                  </div>
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))} className="px-2.5 py-2 rounded-lg bg-card border border-border text-red-600 dark:text-red-400 text-xs font-bold cursor-pointer" title={`Remove line ${idx + 1}`}>✕</button>
                  )}
                </div>
              </div>
            ))}
            {lines.map((line) => (
              <p key={`amount-${line.key}`} className="text-[11px] text-muted-foreground">
                {products.find((x) => x.id === line.productId)?.name ?? "Line"}: <strong className="text-foreground">{formatCurrency((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0))}</strong>
                {" "}({Number(line.quantity) || 0} kg × {formatCurrency(Number(line.unitPrice) || 0)} / kg)
              </p>
            ))}
            <button type="button" onClick={() => setLines((prev) => [...prev, { key: Date.now(), productId: products[0]?.id ?? "", quantity: 0, unitPrice: 0 }])} className="px-3 py-1.5 rounded-lg bg-card border border-border text-xs font-bold cursor-pointer">+ Add line</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-muted border border-border">
            <Field id="vendor-bill-ref-no" label="Vendor Bill / Ref No">
              <input
                id="vendor-bill-ref-no"
                type="text"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                placeholder="e.g. INV-8842"
                className={inputClass}
              />
            </Field>
            <Field id="advance-paid-pkr" label="Advance / Paid (PKR)">
              <input
                id="advance-paid-pkr"
                type="number"
                value={paidAmount}
                onChange={(e) => setPaidAmount(Number(e.target.value))}
                min="0"
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>
          {paidAmount > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="payment-account-kind">Payment account kind</label>
                <select id="payment-account-kind" value={payAccountKind} onChange={(e) => { const k = e.target.value as "cash" | "bank" | "online"; setPayAccountKind(k); const first = cashAccounts.find((a) => a.account_kind === k); setPayCashAccountId(first ? first.id : "") }} className={inputClass}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="online">Online</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="cash-account-for-this-payment">Cash account for this payment *</label>
                <select id="cash-account-for-this-payment" value={payCashAccountId} onChange={(e) => setPayCashAccountId(e.target.value)} className={inputClass}>
                  <option value="">Select account</option>
                  {cashAccounts.filter((a) => a.account_kind === payAccountKind).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                </select>
                {cashAccounts.filter((a) => a.account_kind === payAccountKind).length === 0 && (<p className="mt-1 text-[11px] text-muted-foreground">No {payAccountKind} account yet — create one on the Daybook page.</p>)}
              </div>
            </div>
          )}

          <Field id="purchase-notes" label="Notes">
            <input
              id="purchase-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Purchase notes"
              className={inputClass}
            />
          </Field>

          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex justify-between items-center">
            <div>
              <span className="text-muted-foreground block text-[11px]">Total Invoice:</span>
              <strong className="text-foreground font-mono">{formatCurrency(totalAmount)}</strong>
            </div>
            <div className="text-right">
              <span className="text-muted-foreground block text-[11px]">Payable Liability Added:</span>
              <strong className="text-amber-500 font-mono text-sm">{formatCurrency(balanceAmount)}</strong>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSaveDraft()}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-card border border-border text-foreground text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              Save as draft
            </button>
            <button type="submit" disabled={isPending} className={primaryButtonClass}>
              {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{isPending ? "Posting…" : "Post Purchase Invoice"}</span>
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={showConfirm}
        title="Post this purchase invoice?"
        description={draftPurchase ? `${draftPurchase.purchase_no} for ${draftPurchase.vendor_name || "the vendor"}: total ${formatCurrency(draftPurchase.total_amount)}, paid ${formatCurrency(draftPurchase.paid_amount)}, balance ${formatCurrency(draftPurchase.balance_amount)} added to vendor payables.` : ""}
        confirmLabel="Post Purchase Invoice"
        pending={isPending}
        onConfirm={handleConfirmPurchase}
        onCancel={() => { setShowConfirm(false); setDraftPurchase(null) }}
      />
    </>
  )
}
