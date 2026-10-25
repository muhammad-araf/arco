"use client"

import * as React from "react"
import {
  Boxes,
  ScrollText,
  ArrowRightLeft,
  Search,
  Filter,
  Warehouse,
  CheckCircle2,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Plus,
  Download,
} from "lucide-react"
import { getStockSummary, getStockLedger, createTransfer, postTransfer, createAdjustment, postAdjustment, reverseAdjustment } from "@/app/actions/inventory"
import { listGodowns, listProducts } from "@/app/actions/masters"
import { StockLedgerEntry, Godown, Product } from "@/lib/types/database"
import { formatWeight, formatBags, formatDateTime } from "@/lib/utils"
import { exportToCSV } from "@/lib/export-utils"
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

export default function InventoryPage() {
  const [activeTab, setActiveTab] = React.useState<"summary" | "ledger">("summary")
  const [stockSummary, setStockSummary] = React.useState<any[]>([])
  const [rawSummary, setRawSummary] = React.useState<any[]>([])
  const [adjGodown, setAdjGodown] = React.useState("")
  const [adjProduct, setAdjProduct] = React.useState("")
  const [adjAfter, setAdjAfter] = React.useState<number>(0)
  const [adjReason, setAdjReason] = React.useState("")
  const [adjApprover, setAdjApprover] = React.useState("")
  const [adjPending, setAdjPending] = React.useState(false)
  const [postedAdjId, setPostedAdjId] = React.useState<string | null>(null)
  const [adjReverseOpen, setAdjReverseOpen] = React.useState(false)
  const [adjReversing, setAdjReversing] = React.useState(false)
  const [ledgerEntries, setLedgerEntries] = React.useState<StockLedgerEntry[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])

  // Filters
  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedGodown, setSelectedGodown] = React.useState("all")
  const [selectedCategory, setSelectedCategory] = React.useState("all")

  // Transfer Modal
  const [isTransferModalOpen, setIsTransferModalOpen] = React.useState(false)
  const [transferFromGodown, setTransferFromGodown] = React.useState("")
  const [transferToGodown, setTransferToGodown] = React.useState("")
  const [transferProductId, setTransferProductId] = React.useState("")
  const [transferQty, setTransferQty] = React.useState<number>(1000)
  const [transferNotes, setTransferNotes] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(true)
  const [transferError, setTransferError] = React.useState("")
  const [transferNotice, setTransferNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showTransferConfirm, setShowTransferConfirm] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const transferGuard = React.useRef(false)

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    const [sm, le, g, pr] = await Promise.all([getStockSummary(), getStockLedger(), listGodowns(), listProducts()])
    const failed = [sm, le, g, pr].find((r) => !r.success)
    if (failed) setTransferError(failed.error ?? "Could not load inventory data.")
    const godownList = (Array.isArray(g.data) ? g.data : []) as Godown[]
    const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
    const rows = Array.isArray(sm.data) ? sm.data : []
    setRawSummary(rows)
    setGodowns(godownList)
    setProducts(productList)
    const grouped = new Map<string, any>()
    for (const r of rows) {
      const prod = productList.find((x) => x.id === r.product_id)
      const cur = grouped.get(r.product_id) ?? {
        id: r.product_id, code: prod?.code ?? "", name: r.product_name, category: prod?.category ?? "",
        totalStock: 0, bagsCount: 0, min_stock: prod?.min_stock ?? r.min_stock_kg ?? 0, isLowStock: false,
      }
      cur.totalStock += Number(r.balance_kg) || 0
      cur.isLowStock = cur.isLowStock || !!r.below_min_stock
      grouped.set(r.product_id, cur)
    }
    for (const cur of grouped.values()) {
      const prod = productList.find((x) => x.id === cur.id)
      cur.bagsCount = prod?.weight_per_bag ? Math.round(cur.totalStock / prod.weight_per_bag) : 0
    }
    setStockSummary([...grouped.values()])
    setLedgerEntries((Array.isArray(le.data) ? le.data : []).map((e: any) => ({
      ...e,
      godown_name: godownList.find((x) => x.id === e.godown_id)?.name ?? e.godown_id,
      product_name: productList.find((x) => x.id === e.product_id)?.name ?? e.product_id,
    })))
    setIsLoading(false)
  }, [])

  React.useEffect(() => {
    if (godowns.length >= 2) {
      if (!transferFromGodown) setTransferFromGodown(godowns[0].id)
      if (!transferToGodown) setTransferToGodown(godowns[1].id)
    }
    if (products.length > 0 && !transferProductId) {
      setTransferProductId(products[0].id)
    }
  }, [godowns, products, transferFromGodown, transferToGodown, transferProductId])

  const filteredSummary = stockSummary.filter((p) => {
    const matchesSearch = (p.name ?? "").toLowerCase().includes(searchQuery.toLowerCase()) || (p.code ?? "").toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === "all" || (p.category ?? "") === selectedCategory
    const matchesDrill = drillFilter === "low" ? p.isLowStock : true
    return matchesSearch && matchesCategory && matchesDrill
  })

  const filteredLedger = ledgerEntries.filter((entry) => {
    const matchesGodown = selectedGodown === "all" || entry.godown_id === selectedGodown
    const matchesSearch =
      (entry.product_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.voucher_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (entry.notes || "").toLowerCase().includes(searchQuery.toLowerCase())
    return matchesGodown && matchesSearch
  })

  const handleExecuteTransfer = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §5.3: a transfer needs distinct locations, a positive quantity,
    // enough source stock, and a reason — each failure says what to fix.
    if (!transferFromGodown || !transferToGodown || !transferProductId) return setTransferError("Select a product and both godowns for the transfer.")
    if (transferFromGodown === transferToGodown) return setTransferError("Source and destination godowns must be different — a transfer moves stock between two locations.")
    if (!isPositive(transferQty)) return setTransferError("Transfer quantity must be greater than zero.")
    if (!transferNotes.trim()) return setTransferError("A transfer reason is required (spec §5.3). Write why this stock is moving.")
    const availableStock = rawSummary.filter((r) => r.product_id === transferProductId && r.godown_id === transferFromGodown).reduce((a, r) => a + (Number(r.balance_kg) || 0), 0)
    if (transferQty > availableStock) return setTransferError(`Insufficient stock in the source godown: ${availableStock} kg available, but ${transferQty} kg requested. Reduce the quantity.`)
    setTransferError("")
    setShowTransferConfirm(true)
  }

  const handleConfirmTransfer = async () => {
    if (transferGuard.current) return
    transferGuard.current = true
    setIsPending(true)
    try {
      const created = await createTransfer({
        fromGodownId: transferFromGodown, toGodownId: transferToGodown, productId: transferProductId,
        quantityKg: transferQty, reason: transferNotes.trim(), notes: transferNotes.trim(),
      })
      if (!created.success || !(created.data as any)?.id) {
        setTransferError(created.error ?? "Could not create the transfer draft.")
        return
      }
      const posted = await postTransfer((created.data as any).id, `transfer-${Date.now()}`)
      if (!posted.success) {
        setTransferError(posted.error ?? "Could not post the transfer.")
        return
      }
      const fromGodownObj = godowns.find((g) => g.id === transferFromGodown)
      const toGodownObj = godowns.find((g) => g.id === transferToGodown)
      setTransferNotice(`Transfer posted — ${transferQty} kg moved from ${fromGodownObj?.name} to ${toGodownObj?.name}. Enterprise total unchanged.`)
      setShowTransferConfirm(false)
      setIsTransferModalOpen(false)
      await loadData()
    } finally {
      setIsPending(false)
      transferGuard.current = false
    }
  }

  const adjBefore = rawSummary.filter((r) => r.product_id === adjProduct && r.godown_id === adjGodown).reduce((a, r) => a + (Number(r.balance_kg) || 0), 0)
  const handleAdjustment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (adjPending) return
    if (!adjGodown || !adjProduct) return setTransferError("Select a godown and product for the adjustment.")
    if (!adjReason.trim()) return setTransferError("An adjustment reason is required.")
    if (!adjApprover.trim()) return setTransferError("An approver is required for a stock adjustment.")
    setAdjPending(true)
    try {
      const created = await createAdjustment({
        godownId: adjGodown, productId: adjProduct, quantityBeforeKg: adjBefore, quantityAfterKg: adjAfter,
        reason: adjReason.trim(), approver: adjApprover.trim(),
      })
      if (!created.success || !(created.data as any)?.id) {
        setTransferError(created.error ?? "Could not create the adjustment.")
        return
      }
      const posted = await postAdjustment((created.data as any).id, `adjustment-${Date.now()}`)
      if (!posted.success) {
        setTransferError(posted.error ?? "Could not post the adjustment.")
        return
      }
      setPostedAdjId((created.data as any).id)
      setTransferNotice(`Stock adjustment posted: ${adjBefore} kg → ${adjAfter} kg, approved by ${adjApprover.trim()}.`)
      await loadData()
    } finally {
      setAdjPending(false)
    }
  }

  const handleAdjReversal = async (reasonCode: string, reason: string) => {
    if (!postedAdjId || adjReversing) return
    setAdjReversing(true)
    try {
      const res = await reverseAdjustment(postedAdjId, `${reasonCode}: ${reason}`, `adjustment-rev-${Date.now()}`)
      if (!res.success) {
        setTransferError(res.error ?? "Could not reverse the adjustment.")
        return
      }
      setTransferNotice("Stock adjustment reversed.")
      setPostedAdjId(null)
      setAdjReverseOpen(false)
      await loadData()
    } finally {
      setAdjReversing(false)
    }
  }

  if (isLoading) return <PageSkeleton />

  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      <AlertBanner tone="success" message={transferNotice} onDismiss={() => setTransferNotice("")} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Boxes className="h-6 w-6 text-emerald-500" />
            Stock Ledger & Godown Inventory
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Authoritative single-ledger inventory balances, audit movements, and inter-godown transfers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (activeTab === "summary") {
                exportToCSV(
                  filteredSummary.map((p) => ({
                    code: p.code,
                    name: p.name,
                    category: p.category,
                    stock_kg: p.totalStock,
                    bags: p.bagsCount,
                    min_stock: p.min_stock || 0,
                  })),
                  "godown_stock_summary"
                )
              } else {
                exportToCSV(
                  filteredLedger.map((e) => ({
                    date: e.date,
                    voucher_no: e.voucher_no,
                    type: e.voucher_type,
                    godown: e.godown_name,
                    product: e.product_name,
                    inward_kg: e.inward_qty,
                    outward_kg: e.outward_qty,
                    balance_kg: e.running_balance,
                    notes: e.notes || "",
                  })),
                  "stock_movement_ledger"
                )
              }
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title="Download CSV / Excel"
          >
            <Download className="h-4 w-4 text-emerald-500" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setIsTransferModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="h-4 w-4" />
            <span>Inter-Godown Transfer</span>
          </button>
        </div>
      </div>

      {/* Tabs & Search Filter Bar */}
      <div className="expensive-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted border border-border self-start">
          <button
            type="button"
            onClick={() => setActiveTab("summary")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "summary"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Live Stock Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ledger")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "ledger"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Movement Ledger ({ledgerEntries.length})
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search product or voucher..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground"
            />
          </div>

          {activeTab === "summary" ? (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground"
            >
              <option value="all">All Categories</option>
              <option value="raw_seed">Raw Seed</option>
              <option value="finished_seed">Finished Seed</option>
              <option value="by_product">By-Product</option>
            </select>
          ) : (
            <select
              value={selectedGodown}
              onChange={(e) => setSelectedGodown(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground"
            >
              <option value="all">All Godowns</option>
              {godowns.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Tab 1: Live Stock Summary Table */}
      {activeTab === "summary" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Code</th>
                  <th className="pb-3 font-bold">Product / Grain</th>
                  <th className="pb-3 font-bold">Category</th>
                  <th className="pb-3 font-bold text-right">Available Weight</th>
                  <th className="pb-3 font-bold text-right">Estimated Bags</th>
                  <th className="pb-3 font-bold text-right">Min Threshold</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredSummary.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4">
                      <EmptyState
                        title={drillFilter === "low" ? "No low-stock items" : "No stock rows match these filters"}
                        hint={drillFilter === "low" ? "Every product is above its minimum stock right now." : "Try a different search, godown or category — or post an inward voucher to create stock."}
                      />
                    </td>
                  </tr>
                )}
                {filteredSummary.map((item) => (
                  <tr key={item.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{item.code}</td>
                    <td className="py-3 font-bold text-foreground">
                      <div>{item.name}</div>
                      {item.notes && <div className="text-[10px] text-muted-foreground">{item.notes}</div>}
                    </td>
                    <td className="py-3 text-muted-foreground capitalize">
                      {String(item.category ?? "").replace("_", " ")}
                    </td>
                    <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                      {formatWeight(item.totalStock)}
                    </td>
                    <td className="py-3 text-right font-semibold text-foreground">
                      {item.bagsCount ? formatBags(item.bagsCount) : "—"}
                    </td>
                    <td className="py-3 text-right text-muted-foreground font-mono">
                      {formatWeight(item.min_stock || 0)}
                    </td>
                    <td className="py-3 text-center">
                      {item.isLowStock ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                          <AlertTriangle className="h-3 w-3" />
                          Low Stock
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                          <CheckCircle2 className="h-3 w-3" />
                          In Stock
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Full Movement Stock Ledger Table */}
      {activeTab === "ledger" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Date & Time</th>
                  <th className="pb-3 font-bold">Voucher No</th>
                  <th className="pb-3 font-bold">Type</th>
                  <th className="pb-3 font-bold">Godown</th>
                  <th className="pb-3 font-bold">Product</th>
                  <th className="pb-3 font-bold text-right">Inward</th>
                  <th className="pb-3 font-bold text-right">Outward</th>
                  <th className="pb-3 font-bold text-right">Balance</th>
                  <th className="pb-3 font-bold">Remarks / Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {filteredLedger.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-4 font-sans">
                      <EmptyState
                        title="No ledger movements match these filters"
                        hint="Post an inward voucher, batch or gate pass and its movement will appear here with its voucher reference."
                      />
                    </td>
                  </tr>
                )}
                {filteredLedger.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 text-muted-foreground font-sans">{formatDateTime(entry.date)}</td>
                    <td className="py-3 font-bold text-foreground font-sans">{entry.voucher_no}</td>
                    <td className="py-3">
                      <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase text-[9px] font-bold">
                        {entry.voucher_type.replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-3 text-muted-foreground font-sans">{entry.godown_name}</td>
                    <td className="py-3 font-semibold text-foreground font-sans">{entry.product_name}</td>
                    <td className="py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                      {entry.inward_qty > 0 ? `+${entry.inward_qty.toLocaleString()} kg` : "-"}
                    </td>
                    <td className="py-3 text-right font-bold text-blue-600 dark:text-blue-400">
                      {entry.outward_qty > 0 ? `-${entry.outward_qty.toLocaleString()} kg` : "-"}
                    </td>
                    <td className="py-3 text-right font-black text-foreground">
                      {entry.running_balance.toLocaleString()} kg
                    </td>
                    <td className="py-3 text-muted-foreground font-sans text-[11px] truncate max-w-xs">
                      {entry.notes || "Recorded movement"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Adjustment (reason + approver, create → post → reversible) */}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Stock Adjustment</h2>
        <p className="text-xs text-muted-foreground mb-4">Correct a physical count with a reason and an approver. The adjustment is created as a draft, then posted to the ledger; a just-posted adjustment can be reversed below with a mandatory reason. There is no adjustment list action yet, so only the most recent posted adjustment on this page can be reversed from here.</p>
        <form onSubmit={handleAdjustment} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1">Godown</label><select value={adjGodown} onChange={(e) => setAdjGodown(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select godown</option>{godowns.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Product</label><select value={adjProduct} onChange={(e) => setAdjProduct(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select product</option>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Quantity after (kg)</label><input type="number" value={adjAfter} onChange={(e) => setAdjAfter(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /></div>
          <div><label className="block font-medium text-foreground mb-1">Reason *</label><input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g. Physical recount variance" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1">Approver *</label><input value={adjApprover} onChange={(e) => setAdjApprover(e.target.value)} placeholder="Approver name" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div className="flex items-end gap-2"><span className="text-muted-foreground">Current balance: {adjGodown && adjProduct ? `${adjBefore} kg` : "—"}</span><button type="submit" disabled={adjPending} className="ml-auto px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{adjPending ? "Posting…" : "Create & Post Adjustment"}</button></div>
        </form>
        {postedAdjId && (<button type="button" onClick={() => setAdjReverseOpen(true)} className="mt-3 px-3 py-1.5 rounded-lg bg-card hover:bg-red-500/10 text-red-600 dark:text-red-400 border border-border text-xs font-semibold cursor-pointer">Reverse last posted adjustment</button>)}
      </div>

      {/* Inter-Godown Transfer Modal */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4 text-emerald-500" />
                Inter-Godown Grain Transfer
              </h3>
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteTransfer} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={transferError} onDismiss={() => setTransferError("")} />
              <div>
                <label className="block font-medium text-foreground mb-1">Product</label>
                <select
                  value={transferProductId}
                  onChange={(e) => setTransferProductId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">From (Source)</label>
                  <select
                    value={transferFromGodown}
                    onChange={(e) => setTransferFromGodown(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    {godowns.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">To (Destination)</label>
                  <select
                    value={transferToGodown}
                    onChange={(e) => setTransferToGodown(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    {godowns.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Transfer Quantity (kg)</label>
                <input
                  type="number"
                  value={transferQty}
                  onChange={(e) => setTransferQty(Number(e.target.value))}
                  min="1"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Transfer Reason / Notes</label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="e.g. Shifting raw lot to Plant A for morning batch"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
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
                  <span>{isPending ? "Executing…" : "Execute Transfer"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showTransferConfirm}
        title="Execute this transfer?"
        description={`Move ${transferQty} kg of ${products.find((p) => p.id === transferProductId)?.name || "the selected product"} from ${godowns.find((g) => g.id === transferFromGodown)?.name || "source"} to ${godowns.find((g) => g.id === transferToGodown)?.name || "destination"}. Two ledger rows are written (out of source, into destination); total enterprise stock does not change.`}
        confirmLabel="Execute Transfer"
        pending={isPending}
        onConfirm={handleConfirmTransfer}
        onCancel={() => setShowTransferConfirm(false)}
      />
      <ReversalDialog
        open={adjReverseOpen}
        voucherLabel="last posted adjustment"
        pending={adjReversing}
        onConfirm={handleAdjReversal}
        onCancel={() => setAdjReverseOpen(false)}
      />
    </div>
  )
}
