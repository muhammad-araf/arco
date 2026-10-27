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
import { listPurchases, createPurchase, postPurchase, reversePurchase, listPurchaseReturns, createPurchaseReturn, postPurchaseReturn, allocatePayment, listCashAccounts } from "@/app/actions/finance"
import { listParties, listGodowns, listProducts } from "@/app/actions/masters"
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
  const [returns, setReturns] = React.useState<any[]>([])
  const [retPurchaseId, setRetPurchaseId] = React.useState("")
  const [retQty, setRetQty] = React.useState<number>(0)
  const [retPrice, setRetPrice] = React.useState<number>(0)
  const [retReason, setRetReason] = React.useState("")
  const [retPending, setRetPending] = React.useState(false)
  const [retPostPending, setRetPostPending] = React.useState<string | null>(null)
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  const [payCashAccountId, setPayCashAccountId] = React.useState("")
  const [payAccountKind, setPayAccountKind] = React.useState<"cash" | "bank" | "online">("cash")
  const [payPurchaseId, setPayPurchaseId] = React.useState("")
  const [payAmount, setPayAmount] = React.useState<number>(0)
  const [payPending, setPayPending] = React.useState(false)
  const purchaseGuard = React.useRef(false)
  const [vendorId, setVendorId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [invoiceRef, setInvoiceRef] = React.useState("")
  const [productId, setProductId] = React.useState("")
  const [quantity, setQuantity] = React.useState<number>(10000)
  const [unitPrice, setUnitPrice] = React.useState<number>(115)
  const [paidAmount, setPaidAmount] = React.useState<number>(500000)
  const [notes, setNotes] = React.useState("")

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [pu, pa, g, pr, re, ca] = await Promise.all([listPurchases(), listParties(), listGodowns(), listProducts(), listPurchaseReturns(), listCashAccounts()])
      const failed = [pu, pa, g, pr, re, ca].find((x) => !x.success)
      setCashAccounts(Array.isArray(ca.data) ? ca.data : [])
      if (failed) setFormError(failed.error ?? "Could not load purchase data.")
      const partyList = (Array.isArray(pa.data) ? pa.data : []) as Party[]
      const godownList = (Array.isArray(g.data) ? g.data : []) as Godown[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      setVendors(partyList.filter((x) => x.type === "supplier" || x.type === "both"))
      setGodowns(godownList); setProducts(productList)
      setReturns(Array.isArray(re.data) ? re.data : [])
      setPurchases((Array.isArray(pu.data) ? pu.data : []).map((row: any) => ({
        ...row,
        vendor_name: partyList.find((x) => x.id === row.vendor_id)?.name ?? row.vendor_id,
        godown_name: godownList.find((x) => x.id === row.godown_id)?.name ?? row.godown_id,
        items: (row.purchase_items ?? row.items ?? []).map((it: any) => ({
          ...it, product_name: productList.find((x) => x.id === it.product_id)?.name ?? it.product_id,
        })),
      })))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load purchase data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Mount load: without this the page never leaves its skeleton —
  // isLoading starts true and only post-action handlers reloaded before.
  React.useEffect(() => { loadData() }, [loadData])

  React.useEffect(() => {
    if (cashAccounts.length > 0 && !payCashAccountId) {
      const first = cashAccounts.find((a) => a.account_kind === payAccountKind) ?? cashAccounts[0]
      if (first) { setPayCashAccountId(first.id); setPayAccountKind(first.account_kind) }
    }
    if (vendors.length > 0 && !vendorId) setVendorId(vendors[0].id)
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
    if (products.length > 0 && !productId) setProductId(products[0].id)
  }, [vendors, godowns, products, vendorId, godownId, productId, cashAccounts, payCashAccountId, payAccountKind])

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
    if (paidAmount > 0 && !payCashAccountId) return setFormError("Select a cash account for the payment at purchase. Create one on the Daybook page first if none exists.")
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

  const handleConfirmPurchase = async () => {
    if (!draftPurchase || purchaseGuard.current) return
    purchaseGuard.current = true
    setIsPending(true)
    try {
      const created = await createPurchase({
        vendorId, invoiceRef: invoiceRef || undefined, godownId: godownId || undefined,
        notes: notes || undefined, clientToken: `purchase-${Date.now()}`,
        items: [{ itemType: "seed", productId, quantity, unit: "kg", unitPrice }],
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the purchase draft.")
        return
      }
      const posted = await postPurchase((created.data as any).id)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the purchase.")
        return
      }
      let payNote = ""
      let payOk = false
      if (paidAmount > 0) {
        const pay = await allocatePayment({
          vendorId, cashAccountId: payCashAccountId, account: payAccountKind, amount: paidAmount, settlementKind: "purchase",
          clientToken: `vendorpay-${Date.now()}`,
          allocations: [{ targetType: "purchase", targetId: (created.data as any).id, amount: paidAmount }],
        })
        payOk = pay.success
        payNote = pay.success ? ` Paid ${formatCurrency(paidAmount)} allocated to it.` : ` Payment of ${formatCurrency(paidAmount)} could not be allocated: ${pay.error ?? "unknown error"} — pay it later from the Pay section below.`
      }
      const row: any = posted.data ?? created.data
      // The notice reads the post-payment balance: the posted row still
      // shows the pre-payment balance, so use the draft's balance
      // (total − paid) once the payment has landed.
      const balanceAfter = payOk ? draftPurchase.balance_amount : (row.balance_amount ?? draftPurchase.balance_amount)
      setFormNotice(`${row.purchase_no ?? draftPurchase.purchase_no} posted — remaining balance ${formatCurrency(balanceAfter)} owed to ${draftPurchase.vendor_name || "the vendor"}.${payNote}`)
      setShowConfirm(false)
      setIsModalOpen(false)
      setDraftPurchase(null)
      await loadData()
    } finally {
      setIsPending(false)
      purchaseGuard.current = false
    }
  }

  const handlePurchaseReturn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (retPending) return
    const purchase = purchases.find((x) => x.id === retPurchaseId)
    const firstItem = (purchase as any)?.purchase_items?.[0] ?? (purchase as any)?.items?.[0]
    if (!purchase || !firstItem) return setFormError("Select a posted purchase with at least one line to return.")
    if (!retReason.trim()) return setFormError("A reason is required for a purchase return.")
    if (!(retQty > 0) || retPrice < 0) return setFormError("Return quantity must be > 0 and price cannot be negative.")
    setRetPending(true)
    try {
      const res = await createPurchaseReturn({
        purchaseId: retPurchaseId, reason: retReason.trim(), clientToken: `purchasereturn-${Date.now()}`,
        items: [{ purchaseItemId: firstItem.id, quantity: retQty, unitPrice: retPrice }],
      })
      if (!res.success) {
        setFormError(res.error ?? "Could not record the purchase return.")
        return
      }
      // B6: a return only takes effect when posted (stock out, vendor
      // credit, purchase balance). Post it now; if posting fails the
      // return stays a draft and the notice says so plainly.
      const createdReturn: any = res.data
      const postedReturn = await postPurchaseReturn(createdReturn.id)
      if (!postedReturn.success) {
        setFormNotice(`Purchase return ${createdReturn.return_no ?? ""} saved as a draft awaiting posting — posting failed: ${postedReturn.error ?? "unknown error"}. Post it from the draft returns list below.`)
      } else {
        setFormNotice(`Purchase return ${(postedReturn.data as any)?.return_no ?? createdReturn.return_no ?? ""} posted — stock out and vendor credit applied against ${purchase.purchase_no}.`)
      }
      await loadData()
    } finally {
      setRetPending(false)
    }
  }

  const handlePostDraftReturn = async (returnId: string) => {
    if (retPostPending) return
    setRetPostPending(returnId)
    try {
      const res = await postPurchaseReturn(returnId)
      if (!res.success) { setFormError(res.error ?? "Could not post the purchase return."); return }
      setFormNotice(`Purchase return ${(res.data as any)?.return_no ?? ""} posted — stock out and vendor credit applied.`)
      await loadData()
    } finally { setRetPostPending(null) }
  }

  const handlePayPurchase = async (e: React.FormEvent) => {
    e.preventDefault()
    if (payPending) return
    const purchase = purchases.find((x) => x.id === payPurchaseId)
    if (!purchase || purchase.status !== "posted") return setFormError("Select a posted purchase to pay.")
    if (!(payAmount > 0)) return setFormError("Payment amount must be greater than zero.")
    if (payAmount > Number(purchase.balance_amount)) return setFormError(`Payment (${formatCurrency(payAmount)}) exceeds the purchase balance (${formatCurrency(Number(purchase.balance_amount))}).`)
    if (!payCashAccountId) return setFormError("Select a cash account for this payment.")
    setPayPending(true)
    try {
      const res = await allocatePayment({
        vendorId: purchase.vendor_id, cashAccountId: payCashAccountId, account: payAccountKind,
        amount: payAmount, settlementKind: "purchase", clientToken: `vendorpay-${Date.now()}`,
        allocations: [{ targetType: "purchase", targetId: purchase.id, amount: payAmount }],
      })
      if (!res.success) { setFormError(res.error ?? "Could not record the payment."); return }
      setFormNotice(`Paid ${formatCurrency(payAmount)} against ${purchase.purchase_no}. Remaining balance: ${formatCurrency(Number(purchase.balance_amount) - payAmount)}.`)
      await loadData()
    } finally { setPayPending(false) }
  }

  // Spec §1.1: reversal never deletes. The invoice stays visible as
  // "reversed" and the payable added by it is unwound from the vendor.
  // Note: this prototype's purchases do not add stock, so no stock row
  // is unwound here — stock-linked purchase receipt lands in Phase 2.
  const handleConfirmReversal = async (reasonCode: string, reason: string) => {
    if (!reversalTarget || isReversing) return
    setIsReversing(true)
    try {
      const res = await reversePurchase(reversalTarget.id, `${reasonCode}: ${reason}`)
      if (!res.success) {
        setFormError(res.error ?? "Could not reverse the purchase.")
        return
      }
      setFormNotice(`${reversalTarget.purchase_no} reversed — vendor payable unwound. Reason recorded: ${reasonCode}.`)
      setReversalTarget(null)
      await loadData()
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
            Purchases
          </h1>
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
            Invoices ({visiblePurchases.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
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
            <tbody className="divide-y divide-border">
              {visiblePurchases.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4">
                    <EmptyState
                      title={drillFilter === "payable" ? "No outstanding vendor balances" : "No purchase vouchers recorded yet"}
                      hint={drillFilter === "payable" ? "Every posted purchase is fully paid." : "Record your first purchase."}
                      actionLabel="New Purchase Invoice"
                      onAction={() => setIsModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
              {visiblePurchases.map((p) => (
                <tr key={p.id} className="hover:bg-muted transition-colors">
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
                    <span className={p.status === "reversed" ? "px-2 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase" : "px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase"}>
                      {p.status === "reversed" ? "Reversed" : "Posted"}
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    {p.status === "posted" && Number(p.balance_amount) > 0 && (
                      <button
                        type="button"
                        onClick={() => { setPayPurchaseId(p.id); setPayAmount(Number(p.balance_amount)) }}
                        className="px-2 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer"
                        title="Pay this posted purchase now"
                      >
                        Pay
                      </button>
                    )}
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

      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Pay a posted purchase</h2>
        <p className="text-xs text-muted-foreground mb-4">Pay a posted purchase later, in full or in part. The payment leaves the selected cash account and settles only that vendor&apos;s purchase.</p>
        <form onSubmit={handlePayPurchase} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1">Posted purchase *</label><select value={payPurchaseId} onChange={(e) => { setPayPurchaseId(e.target.value); const pu = purchases.find((x) => x.id === e.target.value); if (pu) setPayAmount(Number(pu.balance_amount)) }} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select purchase</option>{purchases.filter((x) => x.status === "posted" && Number(x.balance_amount) > 0).map((x) => (<option key={x.id} value={x.id}>{x.purchase_no} — balance {formatCurrency(Number(x.balance_amount))}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Payment amount *</label><input type="number" value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1">Paid from *</label><select value={payAccountKind} onChange={(e) => { const k = e.target.value as "cash" | "bank" | "online"; setPayAccountKind(k); const first = cashAccounts.find((a) => a.account_kind === k); setPayCashAccountId(first ? first.id : "") }} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="cash">Cash</option><option value="bank">Bank</option><option value="online">Online</option></select></div>
          <div><label className="block font-medium text-foreground mb-1">Cash account *</label><select value={payCashAccountId} onChange={(e) => setPayCashAccountId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select account</option>{cashAccounts.filter((a) => a.account_kind === payAccountKind).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}</select>{cashAccounts.filter((a) => a.account_kind === payAccountKind).length === 0 && (<p className="mt-1 text-[11px] text-muted-foreground">No {payAccountKind} account yet — create one on the Daybook page.</p>)}</div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={payPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{payPending ? "Paying…" : "Pay purchase"}</button></div>
        </form>
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-lg p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-muted border border-border">
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
              {paidAmount > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-foreground mb-1">Payment account kind</label>
                    <select value={payAccountKind} onChange={(e) => { const k = e.target.value as "cash" | "bank" | "online"; setPayAccountKind(k); const first = cashAccounts.find((a) => a.account_kind === k); setPayCashAccountId(first ? first.id : "") }} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
                      <option value="cash">Cash</option>
                      <option value="bank">Bank</option>
                      <option value="online">Online</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-foreground mb-1">Cash account for this payment *</label>
                    <select value={payCashAccountId} onChange={(e) => setPayCashAccountId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
                      <option value="">Select account</option>
                      {cashAccounts.filter((a) => a.account_kind === payAccountKind).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                    </select>
                    {cashAccounts.filter((a) => a.account_kind === payAccountKind).length === 0 && (<p className="mt-1 text-[11px] text-muted-foreground">No {payAccountKind} account yet — create one on the Daybook page.</p>)}
                  </div>
                </div>
              )}

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
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Purchase Returns</h2>
        <p className="text-xs text-muted-foreground mb-4">Returns need a posted purchase and a reason, and return the first line of the purchase. A return takes effect only when posted: stock out, vendor credit and purchase balance all update on posting. {returns.length} return(s) on record.</p>
        {returns.filter((r: any) => r.status === "draft").length > 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-semibold text-foreground">Draft returns awaiting posting</p>
            {returns.filter((r: any) => r.status === "draft").map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs">
                <span className="font-mono font-bold">{r.return_no}</span>
                <span className="text-muted-foreground">{formatCurrency(Number(r.total_amount || 0))} — draft only, nothing has moved yet</span>
                <button type="button" disabled={retPostPending === r.id} onClick={() => handlePostDraftReturn(r.id)} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{retPostPending === r.id ? "Posting…" : "Post return"}</button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handlePurchaseReturn} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1">Posted purchase *</label><select value={retPurchaseId} onChange={(e) => setRetPurchaseId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select purchase</option>{purchases.filter((x) => x.status === "posted").map((x) => (<option key={x.id} value={x.id}>{x.purchase_no}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Return quantity *</label><input type="number" value={retQty} onChange={(e) => setRetQty(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1">Unit price *</label><input type="number" value={retPrice} onChange={(e) => setRetPrice(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1">Reason *</label><input value={retReason} onChange={(e) => setRetReason(e.target.value)} placeholder="Why is this being returned?" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={retPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{retPending ? "Recording…" : "Record purchase return"}</button></div>
        </form>
      </div>
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.purchase_no ?? ""}
        note="The vendor balance will be corrected."
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
    </div>
  )
}
