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
import { GodownStore } from "@/lib/services/godown-store"
import { StockLedgerEntry, Godown, Product } from "@/lib/types/database"
import { formatWeight, formatBags, formatDateTime } from "@/lib/utils"
import { exportToCSV } from "@/lib/export-utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  PageSkeleton,
  SubmitSpinner,
  getUrlFilter,
  isPositive,
} from "@/components/erp-ui"

export default function InventoryPage() {
  const [activeTab, setActiveTab] = React.useState<"summary" | "ledger">("summary")
  const [stockSummary, setStockSummary] = React.useState<any[]>([])
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

  const loadData = React.useCallback(() => {
    setStockSummary(GodownStore.getAllStockSummary())
    setLedgerEntries(GodownStore.getStockLedger())
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
    if (godowns.length >= 2) {
      if (!transferFromGodown) setTransferFromGodown(godowns[0].id)
      if (!transferToGodown) setTransferToGodown(godowns[1].id)
    }
    if (products.length > 0 && !transferProductId) {
      setTransferProductId(products[0].id)
    }
  }, [godowns, products, transferFromGodown, transferToGodown, transferProductId])

  const filteredSummary = stockSummary.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.code.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === "all" || p.category === selectedCategory
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
    const availableStock = GodownStore.getProductStock(transferProductId, transferFromGodown)
    if (transferQty > availableStock) return setTransferError(`Insufficient stock in the source godown: ${availableStock} kg available, but ${transferQty} kg requested. Reduce the quantity.`)
    setTransferError("")
    setShowTransferConfirm(true)
  }

  const handleConfirmTransfer = () => {
    if (transferGuard.current) return
    transferGuard.current = true
    setIsPending(true)
    try {
      const availableStock = GodownStore.getProductStock(transferProductId, transferFromGodown)
      const fromGodownObj = godowns.find((g) => g.id === transferFromGodown)
      const toGodownObj = godowns.find((g) => g.id === transferToGodown)
      const productObj = products.find((p) => p.id === transferProductId)
      const transferNo = `TRF-2026-${Date.now().toString().slice(-4)}`
      const now = new Date().toISOString()
      const outRow: StockLedgerEntry = {
        id: `stk-trf-out-${Date.now()}`,
        date: now,
        voucher_type: "transfer",
        voucher_id: transferNo,
        voucher_no: transferNo,
        godown_id: transferFromGodown,
        godown_name: fromGodownObj?.name,
        product_id: transferProductId,
        product_name: productObj?.name,
        inward_qty: 0,
        outward_qty: transferQty,
        unit: "kg",
        running_balance: availableStock - transferQty,
        notes: `Transfer to ${toGodownObj?.name}. ${transferNotes}`,
        created_at: now,
      }
      const toAvailableStock = GodownStore.getProductStock(transferProductId, transferToGodown)
      const inRow: StockLedgerEntry = {
        id: `stk-trf-in-${Date.now()}`,
        date: now,
        voucher_type: "transfer",
        voucher_id: transferNo,
        voucher_no: transferNo,
        godown_id: transferToGodown,
        godown_name: toGodownObj?.name,
        product_id: transferProductId,
        product_name: productObj?.name,
        inward_qty: transferQty,
        outward_qty: 0,
        unit: "kg",
        running_balance: toAvailableStock + transferQty,
        notes: `Transfer from ${fromGodownObj?.name}. ${transferNotes}`,
        created_at: now,
      }
      const currentLedger = GodownStore.getStockLedger()
      const updatedState = {
        ...((GodownStore as any).getState()),
        stockLedger: [outRow, inRow, ...currentLedger],
      }
      ;(GodownStore as any).saveState(updatedState)
      setTransferNotice(`${transferNo} executed — ${transferQty} kg moved from ${fromGodownObj?.name} to ${toGodownObj?.name}. Enterprise total unchanged.`)
    } finally {
      setIsPending(false)
      transferGuard.current = false
      setShowTransferConfirm(false)
      setIsTransferModalOpen(false)
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted/60 text-foreground border border-border/80 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
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
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted/60 border border-border/60 self-start">
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
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Code</th>
                  <th className="pb-3 font-bold">Product / Grain</th>
                  <th className="pb-3 font-bold">Category</th>
                  <th className="pb-3 font-bold text-right">Available Weight</th>
                  <th className="pb-3 font-bold text-right">Estimated Bags</th>
                  <th className="pb-3 font-bold text-right">Min Threshold</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
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
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{item.code}</td>
                    <td className="py-3 font-bold text-foreground">
                      <div>{item.name}</div>
                      {item.notes && <div className="text-[10px] text-muted-foreground">{item.notes}</div>}
                    </td>
                    <td className="py-3 text-muted-foreground capitalize">
                      {item.category.replace("_", " ")}
                    </td>
                    <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                      {formatWeight(item.totalStock)}
                    </td>
                    <td className="py-3 text-right font-semibold text-foreground">
                      {formatBags(item.bagsCount)}
                    </td>
                    <td className="py-3 text-right text-muted-foreground font-mono">
                      {formatWeight(item.min_stock || 0)}
                    </td>
                    <td className="py-3 text-center">
                      {item.isLowStock ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                          <AlertTriangle className="h-3 w-3" />
                          Low Stock
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
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
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
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
              <tbody className="divide-y divide-border/40 font-mono">
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
                  <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
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

      {/* Inter-Godown Transfer Modal */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
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
    </div>
  )
}
