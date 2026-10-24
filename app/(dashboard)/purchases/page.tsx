"use client"

import * as React from "react"
import {
  ShoppingCart,
  Plus,
  Building2,
  DollarSign,
  CheckCircle2,
  Package,
} from "lucide-react"
import { GodownStore } from "@/lib/services/godown-store"
import { PurchaseVoucher, Party, Godown, Product } from "@/lib/types/database"
import { formatCurrency, formatWeight, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  PageSkeleton,
  ReversalDialog,
  SubmitSpinner,
  getUrlFilter,
  isPositive,
} from "@/components/erp-ui"

export default function PurchasesPage() {
  const [purchases, setPurchases] = React.useState<PurchaseVoucher[]>([])
  const [vendors, setVendors] = React.useState<Party[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])

  // Modal
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftPurchase, setDraftPurchase] = React.useState<PurchaseVoucher | null>(null)
  const [reversalTarget, setReversalTarget] = React.useState<PurchaseVoucher | null>(null)
  const [isReversing, setIsReversing] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const purchaseGuard = React.useRef(false)
  const [vendorId, setVendorId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [invoiceRef, setInvoiceRef] = React.useState("")
  const [productId, setProductId] = React.useState("")
  const [quantity, setQuantity] = React.useState<number>(10000)
  const [unitPrice, setUnitPrice] = React.useState<number>(115)
  const [paidAmount, setPaidAmount] = React.useState<number>(500000)
  const [notes, setNotes] = React.useState("")

  const loadData = React.useCallback(() => {
    const state = (GodownStore as any).getState()
    setPurchases(state.purchases || [])
    setVendors(GodownStore.getParties().filter((p) => p.type === "supplier" || p.type === "both"))
    setGodowns(GodownStore.getGodowns())
    setProducts(GodownStore.getProducts())
  }, [])

  React.useEffect(() => {
    loadData()
    setDrillFilter(getUrlFilter())
    setIsLoading(false)
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

  React.useEffect(() => {
    if (vendors.length > 0 && !vendorId) setVendorId(vendors[0].id)
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
    if (products.length > 0 && !productId) setProductId(products[0].id)
  }, [vendors, godowns, products, vendorId, godownId, productId])

  const totalAmount = quantity * unitPrice
  const balanceAmount = totalAmount - paidAmount

  const handleRecordPurchase = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §10: required fields, positive quantity and price, and payment
    // may not exceed the invoice total — each failure says what to fix.
    if (!vendorId) return setFormError("Select the supplier / vendor for this purchase.")
    if (!godownId) return setFormError("Select the godown receiving this purchase.")
    if (!productId) return setFormError("Select the product being purchased.")
    if (!isPositive(quantity)) return setFormError("Quantity must be greater than zero.")
    if (!isPositive(unitPrice)) return setFormError("Unit price must be greater than zero.")
    if (paidAmount < 0) return setFormError("Paid amount cannot be negative.")
    if (paidAmount > totalAmount) return setFormError(`Paid amount (${formatCurrency(paidAmount)}) exceeds the invoice total (${formatCurrency(totalAmount)}). A payment is allocated to a specific invoice and cannot overpay it.`)
    setFormError("")
    const selectedVendor = vendors.find((v) => v.id === vendorId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const selectedProd = products.find((p) => p.id === productId)
    const purchaseNo = `PUR-2026-${String(purchases.length + 1).padStart(3, "0")}`
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
      items: [
        {
          id: `puri-${Date.now()}`,
          purchase_id: `pur-${Date.now()}`,
          product_id: productId,
          product_name: selectedProd?.name,
          item_type: "seed",
          quantity,
          unit: "kg",
          unit_price: unitPrice,
          line_total: totalAmount,
        },
      ],
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const handleConfirmPurchase = () => {
    if (!draftPurchase || purchaseGuard.current) return
    purchaseGuard.current = true
    setIsPending(true)
    try {
      const state = (GodownStore as any).getState()
      state.purchases = [draftPurchase, ...(state.purchases || [])]
      state.parties = state.parties.map((p: Party) =>
        p.id === vendorId ? { ...p, current_balance: (p.current_balance || p.opening_balance) + draftPurchase.balance_amount } : p
      )
      ;(GodownStore as any).saveState(state)
      setFormNotice(`${draftPurchase.purchase_no} posted — payable of ${formatCurrency(draftPurchase.balance_amount)} added to ${draftPurchase.vendor_name || "the vendor"}.`)
    } finally {
      setIsPending(false)
      purchaseGuard.current = false
      setShowConfirm(false)
      setIsModalOpen(false)
      setDraftPurchase(null)
    }
  }

  // Spec §1.1: reversal never deletes. The invoice stays visible as
  // "reversed" and the payable added by it is unwound from the vendor.
  // Note: this prototype's purchases do not add stock, so no stock row
  // is unwound here — stock-linked purchase receipt lands in Phase 2.
  const handleConfirmReversal = (reasonCode: string, reason: string) => {
    if (!reversalTarget || isReversing) return
    setIsReversing(true)
    try {
      const state = (GodownStore as any).getState()
      state.parties = state.parties.map((p: Party) =>
        p.id === reversalTarget.vendor_id ? { ...p, current_balance: (p.current_balance || p.opening_balance) - reversalTarget.balance_amount } : p
      )
      state.purchases = state.purchases.map((p: PurchaseVoucher) =>
        p.id === reversalTarget.id
          ? { ...p, status: "reversed" as const, notes: `${p.notes ? p.notes + " | " : ""}Reversed [${reasonCode}]: ${reason}` }
          : p
      )
      ;(GodownStore as any).saveState(state)
      setFormNotice(`${reversalTarget.purchase_no} reversed — vendor payable unwound. Reason recorded: ${reasonCode}.`)
      setReversalTarget(null)
    } finally {
      setIsReversing(false)
    }
  }

  const visiblePurchases = drillFilter === "payable"
    ? purchases.filter((p) => p.status === "posted" && p.balance_amount > 0)
    : purchases

  if (isLoading) return <PageSkeleton />

  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-emerald-500" />
            Purchases & Vendor Payables
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Record raw seed and bardana purchases, track supplier invoice balances, payments, and credit liabilities.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>New Purchase Invoice</span>
        </button>
      </div>

      {/* Purchases Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-4 w-4 text-emerald-500" />
            Vendor Purchase Invoices ({visiblePurchases.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Purchase No</th>
                <th className="pb-3 font-bold">Date</th>
                <th className="pb-3 font-bold">Supplier / Grower</th>
                <th className="pb-3 font-bold">Invoice Ref</th>
                <th className="pb-3 font-bold text-right">Total Payable</th>
                <th className="pb-3 font-bold text-right">Paid Amount</th>
                <th className="pb-3 font-bold text-right">Remaining Balance</th>
                <th className="pb-3 font-bold text-center">Status</th>
                <th className="pb-3 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {visiblePurchases.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4">
                    <EmptyState
                      title={drillFilter === "payable" ? "No outstanding vendor balances" : "No purchase vouchers recorded yet"}
                      hint={drillFilter === "payable" ? "Every posted purchase is fully paid." : "Record raw seed or bardana orders — unpaid balances become vendor payables."}
                      actionLabel="New Purchase Invoice"
                      onAction={() => setIsModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
              {visiblePurchases.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 font-mono font-bold text-foreground">{p.purchase_no}</td>
                  <td className="py-3 text-muted-foreground">{formatDate(p.date)}</td>
                  <td className="py-3 font-semibold text-foreground">{p.vendor_name}</td>
                  <td className="py-3 font-mono text-muted-foreground">{p.invoice_ref || "-"}</td>
                  <td className="py-3 text-right font-black text-foreground">{formatCurrency(p.total_amount)}</td>
                  <td className="py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(p.paid_amount)}
                  </td>
                  <td className="py-3 text-right font-bold text-amber-500 font-mono">
                    {formatCurrency(p.balance_amount)}
                  </td>
                  <td className="py-3 text-center">
                    <span className={p.status === "reversed" ? "px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase" : "px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase"}>
                      {p.status === "reversed" ? "Reversed" : "Posted"}
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    {p.status === "posted" && (
                      <button
                        type="button"
                        onClick={() => setReversalTarget(p)}
                        className="px-2 py-1 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer"
                        title="Reverse this purchase (requires a reason)"
                      >
                        Reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))}

            </tbody>
          </table>
        </div>
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="expensive-card w-full max-w-lg p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-emerald-500" />
                Record Vendor Purchase Invoice
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordPurchase} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Supplier / Grower</label>
                  <select
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Unloading Godown</label>
                  <select
                    value={godownId}
                    onChange={(e) => setGodownId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {godowns.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Purchased Product</label>
                  <select
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Quantity (kg)</label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Unit Price / kg (PKR)</label>
                  <input
                    type="number"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-muted/40 border border-border">
                <div>
                  <label className="block font-medium text-foreground mb-1">Vendor Bill / Ref No</label>
                  <input
                    type="text"
                    value={invoiceRef}
                    onChange={(e) => setInvoiceRef(e.target.value)}
                    placeholder="e.g. INV-8842"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Advance / Paid (PKR)</label>
                  <input
                    type="number"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(Number(e.target.value))}
                    min="0"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  />
                </div>
              </div>

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
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
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
                  <span>{isPending ? "Posting…" : "Post Purchase Invoice"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showConfirm}
        title="Post this purchase invoice?"
        description={draftPurchase ? `${draftPurchase.purchase_no} for ${draftPurchase.vendor_name || "the vendor"}: total ${formatCurrency(draftPurchase.total_amount)}, paid ${formatCurrency(draftPurchase.paid_amount)}, balance ${formatCurrency(draftPurchase.balance_amount)} added to vendor payables.` : ""}
        confirmLabel="Post Purchase Invoice"
        pending={isPending}
        onConfirm={handleConfirmPurchase}
        onCancel={() => { setShowConfirm(false); setDraftPurchase(null) }}
      />
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.purchase_no ?? ""}
        note="The payable added by this invoice will be unwound from the vendor balance."
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
    </div>
  )
}
