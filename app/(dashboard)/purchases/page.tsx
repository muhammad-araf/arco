"use client"

import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"

import * as React from "react"
import {
  ShoppingCart,
  Plus,
  Building2,
  DollarSign,
  Package,
} from "lucide-react"
import { listPurchases, postPurchase, reversePurchase, listPurchaseReturns, createPurchaseReturn, postPurchaseReturn, allocatePayment, listCashAccounts, getPurchasesInitData } from "@/app/actions/finance"
import { listParties, listGodowns, listProducts } from "@/app/actions/masters"
import { PurchasePrint } from "@/components/print/purchase-print"
import { PurchaseVoucher, Party, Godown, Product } from "@/lib/types/database"
import { formatCurrency, formatWeight, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  EmptyState,
  FilterBanner,
  ReversalDialog,
  getUrlFilter,
} from "@/components/erp-ui"
import { PurchaseDialog } from "@/components/purchase-dialog"
import { PurchasesSkeleton } from "@/components/route-skeletons"
import { PrintButton } from "@/components/print/print-button"

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
  const [draftPostPending, setDraftPostPending] = React.useState<string | null>(null)
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  const [payCashAccountId, setPayCashAccountId] = React.useState("")
  const [payAccountKind, setPayAccountKind] = React.useState<"cash" | "bank" | "online">("cash")
  const [payPurchaseId, setPayPurchaseId] = React.useState("")
  const [payAmount, setPayAmount] = React.useState<number>(0)
  const [payPending, setPayPending] = React.useState(false)
  const returnTokenRef = React.useRef<string | null>(null)
  const payTokenRef = React.useRef<string | null>(null)
  // Purchase lines: the form submits N lines (server already accepted
  // items[]); each line is one seed product with its own qty/price.
  const [page, setPage] = React.useState(1)
  const [printPurchase, setPrintPurchase] = React.useState<PurchaseVoucher | null>(null)
  const [totalPurchases, setTotalPurchases] = React.useState(0)
  const pageSize = 50

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const initRes = await getPurchasesInitData({ page, pageSize })
      if (!initRes.success) {
        setFormError(initRes.error ?? "Could not load purchase data.")
        return
      }
      const data = initRes.data as any
      const partyList = (Array.isArray(data.parties) ? data.parties : []) as Party[]
      const godownList = (Array.isArray(data.godowns) ? data.godowns : []) as Godown[]
      const productList = (Array.isArray(data.products) ? data.products : []) as Product[]
      setCashAccounts(Array.isArray(data.cashAccounts) ? data.cashAccounts : [])
      setVendors(partyList.filter((x) => x.type === "supplier" || x.type === "both"))
      setGodowns(godownList); setProducts(productList)
      setReturns(Array.isArray(data.returns) ? data.returns : [])
      const pu = data.purchases
      const puRows = Array.isArray(pu) ? pu : ((pu as any)?.rows ?? [])
      setTotalPurchases(Array.isArray(pu) ? pu.length : Number((pu as any)?.total ?? 0))
      setPurchases((puRows as any[]).map((row: any) => ({
        ...row,
        vendor_name: partyList.find((x) => x.id === row.vendor_id)?.name ?? "Not set",
        godown_name: godownList.find((x) => x.id === row.godown_id)?.name ?? "Not set",
        items: (row.purchase_items ?? row.items ?? []).map((it: any) => ({
          ...it, product_name: productList.find((x) => x.id === it.product_id)?.name ?? "Not set",
        })),
      })))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load purchase data.")
    } finally {
      setIsLoading(false)
    }
  }, [page])

  // Mount load: without this the page never leaves its skeleton —
  // isLoading starts true and only post-action handlers reloaded before.
  // Dashboard drill-down links (?filter=payable) apply on mount too.
  React.useEffect(() => { loadData(); setDrillFilter(getUrlFilter()) }, [loadData])

  // Pay-section account default only. The purchase dialog owns its own
  // payment-account state now (see PurchaseDialog).
  React.useEffect(() => {
    if (cashAccounts.length > 0 && !payCashAccountId) {
      const first = cashAccounts.find((a) => a.account_kind === payAccountKind) ?? cashAccounts[0]
      if (first) { setPayCashAccountId(first.id); setPayAccountKind(first.account_kind) }
    }
  }, [cashAccounts, payCashAccountId, payAccountKind])


  const handlePostDraftPurchase = async (purchaseId: string) => {
    if (draftPostPending) return
    setDraftPostPending(purchaseId)
    try {
      const res = await postPurchase(purchaseId)
      if (!res.success) { setFormError(res.error ?? "Could not post the purchase."); return }
      setFormNotice(`Purchase ${(res.data as any)?.purchase_no ?? ""} posted — vendor payable recorded.`)
      await loadData()
    } finally { setDraftPostPending(null) }
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
        purchaseId: retPurchaseId, reason: retReason.trim(), clientToken: submissionToken(returnTokenRef, "purchasereturn"),
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
      resetSubmissionToken(returnTokenRef)
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
        amount: payAmount, settlementKind: "purchase", clientToken: submissionToken(payTokenRef, "vendorpay"),
        allocations: [{ targetType: "purchase", targetId: purchase.id, amount: payAmount }],
      })
      if (!res.success) { setFormError(res.error ?? "Could not record the payment."); return }
      setFormNotice(`Paid ${formatCurrency(payAmount)} against ${purchase.purchase_no}. Remaining balance: ${formatCurrency(Number(purchase.balance_amount) - payAmount)}.`)
      resetSubmissionToken(payTokenRef)
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

  if (isLoading) return <PurchasesSkeleton />

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
                    <span className={p.status === "reversed" ? "px-2 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase" : p.status === "draft" ? "px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase" : "px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase"}>
                      {p.status === "reversed" ? "Reversed" : p.status === "draft" ? "Draft" : "Posted"}
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <button type="button" disabled={p.status !== "posted"} onClick={() => setPrintPurchase(p)} title={p.status === "posted" ? "Print purchase invoice" : "Printing is available only for posted purchases"} className="px-2 py-1 rounded-md bg-card hover:bg-muted border border-border text-[11px] font-semibold cursor-pointer disabled:opacity-50">Print</button>
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
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Showing {visiblePurchases.length === 0 ? 0 : (page - 1) * pageSize + 1}–{(page - 1) * pageSize + visiblePurchases.length} of {totalPurchases} purchases</span>
          <span className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Previous</button>
            <button type="button" disabled={page * pageSize >= totalPurchases} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg bg-card border border-border font-bold cursor-pointer disabled:opacity-50">Next</button>
          </span>
        </div>
      </div>

      {purchases.filter((x) => x.status === "draft").length > 0 && (
        <div className="expensive-card p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Draft purchases awaiting posting</h2>
          <p className="text-xs text-muted-foreground mb-4">Drafts record nothing yet — no payable, no payment. Posting records the vendor payable; pay it from the Pay section below.</p>
          <div className="space-y-2">
            {purchases.filter((x) => x.status === "draft").map((x) => (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs">
                <span className="font-mono font-bold">{x.purchase_no}</span>
                <span className="text-muted-foreground">{x.vendor_name} — {formatCurrency(Number(x.total_amount || 0))} — draft only, nothing has moved yet</span>
                <button type="button" disabled={draftPostPending === x.id} onClick={() => void handlePostDraftPurchase(x.id)} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{draftPostPending === x.id ? "Posting…" : "Post purchase"}</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Pay a posted purchase</h2>
        <p className="text-xs text-muted-foreground mb-4">Pay a posted purchase later, in full or in part. The payment leaves the selected cash account and settles only that vendor&apos;s purchase.</p>
        <form onSubmit={handlePayPurchase} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="posted-purchase-2">Posted purchase *</label><select id="posted-purchase-2" value={payPurchaseId} onChange={(e) => { setPayPurchaseId(e.target.value); const pu = purchases.find((x) => x.id === e.target.value); if (pu) setPayAmount(Number(pu.balance_amount)) }} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select purchase</option>{purchases.filter((x) => x.status === "posted" && Number(x.balance_amount) > 0).map((x) => (<option key={x.id} value={x.id}>{x.purchase_no} — balance {formatCurrency(Number(x.balance_amount))}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="payment-amount">Payment amount *</label><input id="payment-amount" type="number" value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="paid-from">Paid from *</label><select id="paid-from" value={payAccountKind} onChange={(e) => { const k = e.target.value as "cash" | "bank" | "online"; setPayAccountKind(k); const first = cashAccounts.find((a) => a.account_kind === k); setPayCashAccountId(first ? first.id : "") }} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="cash">Cash</option><option value="bank">Bank</option><option value="online">Online</option></select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="cash-account">Cash account *</label><select id="cash-account" value={payCashAccountId} onChange={(e) => setPayCashAccountId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select account</option>{cashAccounts.filter((a) => a.account_kind === payAccountKind).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}</select>{cashAccounts.filter((a) => a.account_kind === payAccountKind).length === 0 && (<p className="mt-1 text-[11px] text-muted-foreground">No {payAccountKind} account yet — create one on the Daybook page.</p>)}</div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={payPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{payPending ? "Paying…" : "Pay purchase"}</button></div>
        </form>
      </div>

      <PurchaseDialog
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        vendors={vendors}
        godowns={godowns}
        products={products}
        cashAccounts={cashAccounts}
        totalPurchases={totalPurchases}
        onPosted={(notice, printPurchase) => {
          setFormNotice(notice)
          setPrintPurchase(printPurchase)
          void loadData()
        }}
        onDraftSaved={(notice) => {
          setFormNotice(notice)
          void loadData()
        }}
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
          <div><label className="block font-medium text-foreground mb-1" htmlFor="posted-purchase">Posted purchase *</label><select id="posted-purchase" value={retPurchaseId} onChange={(e) => setRetPurchaseId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select purchase</option>{purchases.filter((x) => x.status === "posted").map((x) => (<option key={x.id} value={x.id}>{x.purchase_no}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="return-quantity">Return quantity *</label><input id="return-quantity" type="number" value={retQty} onChange={(e) => setRetQty(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="unit-price">Unit price *</label><input id="unit-price" type="number" value={retPrice} onChange={(e) => setRetPrice(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="reason">Reason *</label><input id="reason" value={retReason} onChange={(e) => setRetReason(e.target.value)} placeholder="Why is this being returned?" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <p className="sm:col-span-2 lg:col-span-4 text-[11px] text-muted-foreground">Return amount: <strong className="text-foreground">{formatCurrency((Number(retQty) || 0) * (Number(retPrice) || 0))}</strong> ({Number(retQty) || 0} kg × {formatCurrency(Number(retPrice) || 0)} / kg)</p>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={retPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{retPending ? "Recording…" : "Record purchase return"}</button></div>
        </form>
      </div>
      {printPurchase && (
        <div className="expensive-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Purchase print document for {printPurchase.purchase_no}.</p>
            <div className="flex gap-2">
              <PrintButton label="Print purchase" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
              <button type="button" onClick={() => setPrintPurchase(null)} className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-semibold cursor-pointer">Close</button>
            </div>
          </div>
          <div className="hidden print:block mt-2">
            <PurchasePrint
              purchaseNo={printPurchase.purchase_no}
              date={formatDate(printPurchase.date)}
              vendorName={printPurchase.vendor_name}
              godown={printPurchase.godown_name}
              invoiceRef={printPurchase.invoice_ref}
              status={printPurchase.status}
              lines={(printPurchase.items ?? []).map((it: any) => ({ product: it.product_name ?? products.find((x) => x.id === it.product_id)?.name, quantity: it.quantity, unitPrice: it.unit_price ?? it.unitPrice, amount: it.line_total ?? it.amount }))}
              total={printPurchase.total_amount}
              paid={printPurchase.paid_amount}
              balance={printPurchase.balance_amount}
              notes={printPurchase.notes}
            />
          </div>
        </div>
      )}
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
