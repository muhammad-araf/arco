"use client"

import { postToken } from "@/lib/idempotency"

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
import { getStockSummary, getStockLedger, createTransfer, postTransfer, reverseTransfer, createAdjustment, postAdjustment, reverseAdjustment, listTransfers, listAdjustments } from "@/app/actions/inventory"
import { listGodowns, listProducts, listParties } from "@/app/actions/masters"
import { StockLedgerEntry, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatDateTime } from "@/lib/utils"
import { exportToCSV } from "@/lib/export-utils"
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
import { InventorySkeleton } from "@/components/route-skeletons"

export default function InventoryPage() {
  const [activeTab, setActiveTab] = React.useState<"summary" | "ledger" | "transfers" | "adjustments">("summary")
  const [rawSummary, setRawSummary] = React.useState<any[]>([])
  const [transfers, setTransfers] = React.useState<any[]>([])
  const [adjustments, setAdjustments] = React.useState<any[]>([])
  const [parties, setParties] = React.useState<Party[]>([])
  const [collapsedGodowns, setCollapsedGodowns] = React.useState<string[]>([])
  const [ledgerPage, setLedgerPage] = React.useState(1)
  const [ledgerTotal, setLedgerTotal] = React.useState(0)
  const [adjGodown, setAdjGodown] = React.useState("")
  const [adjProduct, setAdjProduct] = React.useState("")
  const [adjOwner, setAdjOwner] = React.useState("")
  const [adjAfter, setAdjAfter] = React.useState("")
  const [adjReason, setAdjReason] = React.useState("")
  const [adjApprover, setAdjApprover] = React.useState("")
  const [adjPending, setAdjPending] = React.useState(false)
  const [revTransfer, setRevTransfer] = React.useState<any | null>(null)
  const [revAdjustment, setRevAdjustment] = React.useState<any | null>(null)
  const [revPending, setRevPending] = React.useState(false)
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
  const [transferQty, setTransferQty] = React.useState<number>(0)
  const [transferOwner, setTransferOwner] = React.useState("")
  const [transferNotes, setTransferNotes] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(true)
  const [transferError, setTransferError] = React.useState("")
  const [transferNotice, setTransferNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showTransferConfirm, setShowTransferConfirm] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const transferGuard = React.useRef(false)

  const applyLedgerPage = React.useCallback((le: any, godownList: Godown[], productList: Product[]) => {
    const rows = Array.isArray(le.data?.rows) ? le.data.rows : []
    setLedgerTotal(Number(le.data?.total) || 0)
    setLedgerEntries(rows.map((e: any) => ({
      ...e,
      godown_name: godownList.find((x) => x.id === e.godown_id)?.name ?? e.godown_id,
      product_name: productList.find((x) => x.id === e.product_id)?.name ?? e.product_id,
    })))
  }, [])

  const loadLedgerPage = React.useCallback(async (page: number, godown: string, godownList: Godown[], productList: Product[]) => {
    const le = await getStockLedger({ page, pageSize: 50, godownId: godown !== "all" ? godown : undefined })
    if (!le.success) setTransferError(le.error ?? "Could not load the ledger.")
    else applyLedgerPage(le, godownList, productList)
    setLedgerPage(page)
  }, [applyLedgerPage])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [sm, le, g, pr, pa, tr, ad] = await Promise.all([getStockSummary(), getStockLedger({ page: 1, pageSize: 50 }), listGodowns(), listProducts(), listParties(), listTransfers(), listAdjustments()])
      const failed = [sm, le, g, pr, pa, tr, ad].find((r) => !r.success)
      if (failed) setTransferError(failed.error ?? "Could not load inventory data.")
      const godownList = (Array.isArray(g.data) ? g.data : []) as Godown[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      const partyList = (Array.isArray(pa.data) ? pa.data : []) as Party[]
      setRawSummary(Array.isArray(sm.data) ? sm.data : [])
      setGodowns(godownList)
      setProducts(productList)
      setParties(partyList)
      setTransfers(Array.isArray(tr.data) ? tr.data : [])
      setAdjustments(Array.isArray(ad.data) ? ad.data : [])
      setLedgerPage(1)
      applyLedgerPage(le, godownList, productList)
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Could not load inventory data.")
    } finally {
      setIsLoading(false)
    }
  }, [applyLedgerPage])

  // Mount load: without this the page never leaves its skeleton —
  // isLoading starts true and only post-action handlers reloaded before.
  React.useEffect(() => { loadData() }, [loadData])

  React.useEffect(() => {
    if (godowns.length >= 2) {
      if (!transferFromGodown) setTransferFromGodown(godowns[0].id)
      if (!transferToGodown) setTransferToGodown(godowns[1].id)
    }
    if (products.length > 0 && !transferProductId) {
      setTransferProductId(products[0].id)
    }
  }, [godowns, products, transferFromGodown, transferToGodown, transferProductId])

  const filteredSummary = rawSummary.filter((r) => {
    const prod = products.find((x) => x.id === r.product_id)
    const matchesSearch = (r.product_name ?? "").toLowerCase().includes(searchQuery.toLowerCase()) || (prod?.code ?? "").toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === "all" || (prod?.category ?? "") === selectedCategory
    const matchesDrill = drillFilter === "low" ? !!r.below_min_stock : true
    return matchesSearch && matchesCategory && matchesDrill
  })

  const filteredLedger = ledgerEntries.filter((entry) => {
    const matchesSearch =
      (entry.product_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.voucher_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (entry.notes || "").toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  const handleExecuteTransfer = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §5.3: a transfer needs distinct locations, a positive quantity,
    // enough source stock, and a reason — each failure says what to fix.
    if (!transferFromGodown || !transferToGodown || !transferProductId) return setTransferError("Select a product and both godowns for the transfer.")
    if (transferFromGodown === transferToGodown) return setTransferError("Source and destination must be different.")
    if (!isPositive(transferQty)) return setTransferError("Transfer quantity must be greater than zero.")
    if (!transferNotes.trim()) return setTransferError("A reason is required. Write why this stock is moving.")
    const ownerRow = rawSummary.find((r) => r.product_id === transferProductId && r.godown_id === transferFromGodown && (r.party_id ?? null) === (transferOwner || null))
    const availableStock = Number(ownerRow?.balance_kg) || 0
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
        partyId: transferOwner || undefined,
      })
      if (!created.success || !(created.data as any)?.id) {
        setTransferError(created.error ?? "Could not create the transfer draft.")
        return
      }
      const posted = await postTransfer((created.data as any).id, postToken("transfer:post", (created.data as any).id))
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

  const adjBeforeRow = rawSummary.find((r) => r.product_id === adjProduct && r.godown_id === adjGodown && (r.party_id ?? null) === (adjOwner || null))
  const adjBefore = Number(adjBeforeRow?.balance_kg) || 0
  const handleAdjustment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (adjPending) return
    if (!adjGodown || !adjProduct) return setTransferError("Select a godown and product for the adjustment.")
    if (adjAfter === "" || Number.isNaN(Number(adjAfter))) return setTransferError("Enter the quantity after (kg) — it is left blank on purpose so a careless submit cannot zero stock.")
    if (!adjReason.trim()) return setTransferError("An adjustment reason is required.")
    if (!adjApprover.trim()) return setTransferError("An approver is required for a stock adjustment.")
    setAdjPending(true)
    try {
      const created = await createAdjustment({
        godownId: adjGodown, productId: adjProduct, quantityBeforeKg: adjBefore, quantityAfterKg: Number(adjAfter),
        reason: adjReason.trim(), approver: adjApprover.trim(), partyId: adjOwner || undefined,
      })
      if (!created.success || !(created.data as any)?.id) {
        setTransferError(created.error ?? "Could not create the adjustment.")
        return
      }
      const posted = await postAdjustment((created.data as any).id, postToken("adjustment:post", (created.data as any).id))
      if (!posted.success) {
        setTransferError(posted.error ?? "Could not post the adjustment.")
        return
      }
      setTransferNotice(`Stock adjustment posted: ${adjBefore} kg → ${Number(adjAfter)} kg, approved by ${adjApprover.trim()}.`)
      await loadData()
    } finally {
      setAdjPending(false)
    }
  }

  const handleTransferReversal = async (reasonCode: string, reason: string) => {
    if (!revTransfer || revPending) return
    setRevPending(true)
    try {
      const res = await reverseTransfer(revTransfer.id, `${reasonCode}: ${reason}`, postToken("transfer:reverse", revTransfer.id))
      if (!res.success) {
        setTransferError(res.error ?? "Could not reverse the transfer.")
        return
      }
      setTransferNotice(`Transfer ${revTransfer.transfer_no} reversed.`)
      setRevTransfer(null)
      await loadData()
    } finally {
      setRevPending(false)
    }
  }

  const handleAdjReversal = async (reasonCode: string, reason: string) => {
    if (!revAdjustment || revPending) return
    setRevPending(true)
    try {
      const res = await reverseAdjustment(revAdjustment.id, `${reasonCode}: ${reason}`, postToken("adjustment:reverse", revAdjustment.id))
      if (!res.success) {
        setTransferError(res.error ?? "Could not reverse the adjustment.")
        return
      }
      setTransferNotice(`Adjustment ${revAdjustment.adjustment_no} reversed.`)
      setRevAdjustment(null)
      await loadData()
    } finally {
      setRevPending(false)
    }
  }

  if (isLoading) return <InventorySkeleton />

  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      <AlertBanner tone="success" message={transferNotice} onDismiss={() => setTransferNotice("")} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Boxes className="h-6 w-6 text-emerald-500" />
            Stock
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (activeTab === "summary") {
                exportToCSV(
                  filteredSummary.map((r) => ({
                    godown: r.godown_name,
                    product: r.product_name,
                    owner: r.party_name || "Company",
                    stock_kg: r.balance_kg,
                    min_stock: r.min_stock_kg || 0,
                    below_min: r.below_min_stock ? "yes" : "no",
                  })),
                  "godown_stock_summary"
                )
              } else if (activeTab === "transfers") {
                exportToCSV(
                  transfers.map((t: any) => ({
                    transfer_no: t.transfer_no, date: t.date, from: godowns.find((g) => g.id === t.from_godown_id)?.name ?? "Not set",
                    to: godowns.find((g) => g.id === t.to_godown_id)?.name ?? "Not set",
                    product: products.find((x) => x.id === t.product_id)?.name ?? t.product_id,
                    quantity_kg: t.quantity, status: t.status,
                  })),
                  "transfers"
                )
              } else if (activeTab === "adjustments") {
                exportToCSV(
                  adjustments.map((a: any) => ({
                    adjustment_no: a.adjustment_no, date: a.date, godown: godowns.find((g) => g.id === a.godown_id)?.name ?? a.godown_id,
                    product: products.find((x) => x.id === a.product_id)?.name ?? a.product_id,
                    before_kg: a.quantity_before, after_kg: a.quantity_after, status: a.status,
                  })),
                  "adjustments"
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
            <span>Transfer</span>
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
            Movement Ledger ({ledgerTotal})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("transfers")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "transfers"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Transfers ({transfers.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("adjustments")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "adjustments"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Adjustments ({adjustments.length})
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
              onChange={(e) => { setSelectedGodown(e.target.value); void loadLedgerPage(1, e.target.value, godowns, products) }}
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

      {/* Tab 1: Live Stock Summary, grouped per godown. Low stock is
          evaluated per godown row, never from an enterprise total. */}
      {activeTab === "summary" && (
        <div className="space-y-4">
          {godowns.map((g) => {
            const rows = filteredSummary.filter((r) => r.godown_id === g.id)
            if (!rows.length) return null
            const lowCount = rows.filter((r) => r.below_min_stock).length
            return (
              <div key={g.id} className="expensive-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-foreground">{g.name}</h2>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {rows.length} product pools{lowCount > 0 ? ` · ${lowCount} below minimum` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCollapsedGodowns((prev) => prev.includes(g.id) ? prev.filter((id) => id !== g.id) : [...prev, g.id])}
                      className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                    >
                      {collapsedGodowns.includes(g.id) ? "Expand" : "Collapse"}
                    </button>
                  </span>
                </div>
                {!collapsedGodowns.includes(g.id) && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs min-w-[640px]">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                        <th className="pb-3 font-bold">Product / Grain</th>
                        <th className="pb-3 font-bold">Owner</th>
                        <th className="pb-3 font-bold text-right">Available Weight</th>
                        <th className="pb-3 font-bold text-right">Min Threshold</th>
                        <th className="pb-3 font-bold text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((item: any) => (
                        <tr key={`${item.godown_id}-${item.product_id}-${item.party_id ?? ""}`} className="hover:bg-muted transition-colors">
                          <td className="py-3 font-bold text-foreground">{item.product_name}</td>
                          <td className="py-3 text-muted-foreground">{item.party_name || "Company"}</td>
                          <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                            {formatWeight(item.balance_kg)}
                          </td>
                          <td className="py-3 text-right text-muted-foreground font-mono">
                            {formatWeight(item.min_stock_kg || 0)}
                          </td>
                          <td className="py-3 text-center">
                            {item.below_min_stock ? (
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
                )}
              </div>
            )
          })}
          {filteredSummary.length === 0 && (
            <div className="expensive-card p-5">
              <EmptyState
                title={drillFilter === "low" ? "No low-stock items" : "No stock rows match these filters"}
                hint={drillFilter === "low" ? "Every godown pool is above its minimum stock right now." : "Try a different search, or post an inward voucher."}
              />
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Full Movement Stock Ledger Table */}
      {activeTab === "ledger" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
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
                        hint="Movements appear here after you post a voucher."
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

      {activeTab === "ledger" && (
        <div className="expensive-card p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">
            {ledgerPage === 1
              ? `Showing latest ${ledgerEntries.length} of ${ledgerTotal} ledger rows`
              : `Showing rows ${(ledgerPage - 1) * 50 + 1}–${(ledgerPage - 1) * 50 + ledgerEntries.length} of ${ledgerTotal} ledger rows`}
            {searchQuery ? ` (search filters this page only)` : ""}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={ledgerPage <= 1} onClick={() => void loadLedgerPage(ledgerPage - 1, selectedGodown, godowns, products)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-semibold cursor-pointer disabled:opacity-50">Previous</button>
            <span className="font-mono">Page {ledgerPage} of {Math.max(1, Math.ceil(ledgerTotal / 50))}</span>
            <button type="button" disabled={ledgerPage * 50 >= ledgerTotal} onClick={() => void loadLedgerPage(ledgerPage + 1, selectedGodown, godowns, products)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-semibold cursor-pointer disabled:opacity-50">Next</button>
          </span>
        </div>
      )}

      {/* Transfers register */}
      {activeTab === "transfers" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Transfer No</th>
                  <th className="pb-3 font-bold">Date</th>
                  <th className="pb-3 font-bold">From → To</th>
                  <th className="pb-3 font-bold">Product</th>
                  <th className="pb-3 font-bold">Owner</th>
                  <th className="pb-3 font-bold text-right">Quantity</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                  <th className="pb-3 font-bold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transfers.length === 0 && (
                  <tr><td colSpan={8} className="py-4"><EmptyState title="No transfers yet" hint="Use the Transfer button to move stock between godowns." /></td></tr>
                )}
                {transfers.map((t: any) => (
                  <tr key={t.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-bold text-foreground font-mono">{t.transfer_no}</td>
                    <td className="py-3 text-muted-foreground">{formatDateTime(t.date)}</td>
                    <td className="py-3 text-muted-foreground">{godowns.find((g) => g.id === t.from_godown_id)?.name ?? "Not set"} → {godowns.find((g) => g.id === t.to_godown_id)?.name ?? "Not set"}</td>
                    <td className="py-3 font-semibold text-foreground">{products.find((x) => x.id === t.product_id)?.name ?? t.product_id}</td>
                    <td className="py-3 text-muted-foreground">{t.party_id ? (parties.find((x) => x.id === t.party_id)?.name ?? t.party_id) : "Company"}</td>
                    <td className="py-3 text-right font-bold text-foreground">{formatWeight(t.quantity)}</td>
                    <td className="py-3 text-center">{t.status === "draft" ? "Draft" : t.status === "reversed" ? "Reversed" : "Posted"}</td>
                    <td className="py-3 text-center">
                      {t.status === "posted" && (
                        <button type="button" onClick={() => setRevTransfer(t)} className="px-2 py-1 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Reverse</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Adjustments register: every posted row reversible, not just the latest. */}
      {activeTab === "adjustments" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Adjustment No</th>
                  <th className="pb-3 font-bold">Date</th>
                  <th className="pb-3 font-bold">Godown</th>
                  <th className="pb-3 font-bold">Product</th>
                  <th className="pb-3 font-bold">Owner</th>
                  <th className="pb-3 font-bold text-right">Before → After</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                  <th className="pb-3 font-bold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {adjustments.length === 0 && (
                  <tr><td colSpan={8} className="py-4"><EmptyState title="No adjustments yet" hint="Adjustments appear here after you post one below." /></td></tr>
                )}
                {adjustments.map((a: any) => (
                  <tr key={a.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-bold text-foreground font-mono">{a.adjustment_no}</td>
                    <td className="py-3 text-muted-foreground">{formatDateTime(a.date)}</td>
                    <td className="py-3 text-muted-foreground">{godowns.find((g) => g.id === a.godown_id)?.name ?? a.godown_id}</td>
                    <td className="py-3 font-semibold text-foreground">{products.find((x) => x.id === a.product_id)?.name ?? a.product_id}</td>
                    <td className="py-3 text-muted-foreground">{a.party_id ? (parties.find((x) => x.id === a.party_id)?.name ?? a.party_id) : "Company"}</td>
                    <td className="py-3 text-right font-bold text-foreground">{a.quantity_before} kg → {a.quantity_after} kg</td>
                    <td className="py-3 text-center">{a.status === "draft" ? "Draft" : a.status === "reversed" ? "Reversed" : "Posted"}</td>
                    <td className="py-3 text-center">
                      {a.status === "posted" && (
                        <button type="button" onClick={() => setRevAdjustment(a)} className="px-2 py-1 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Reverse</button>
                      )}
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
        <p className="text-xs text-muted-foreground mb-4">Fix a physical count with a reason and an approver. Every posted adjustment can be reversed from the Adjustments register above.</p>
        <form onSubmit={handleAdjustment} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="godown">Godown</label><select id="godown" value={adjGodown} onChange={(e) => setAdjGodown(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select godown</option>{godowns.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="product-2">Product</label><select id="product-2" value={adjProduct} onChange={(e) => setAdjProduct(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select product</option>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="stock-owner-2">Stock owner</label><select id="stock-owner-2" value={adjOwner} onChange={(e) => setAdjOwner(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Company stock</option>{parties.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="quantity-after-kg">Quantity after (kg)</label><div className="flex gap-2"><input id="quantity-after-kg" type="number" value={adjAfter} onChange={(e) => setAdjAfter(e.target.value)} min="0" placeholder="Enter quantity after" className="flex-1 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required /><button type="button" onClick={() => setAdjAfter(String(adjBefore))} className="px-2 py-2 rounded-lg bg-muted text-muted-foreground text-[11px] font-semibold cursor-pointer" title="Fill with the current balance">Use current</button></div></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="reason">Reason *</label><input id="reason" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g. Physical recount variance" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="approver">Approver *</label><input id="approver" value={adjApprover} onChange={(e) => setAdjApprover(e.target.value)} placeholder="Approver name" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div className="flex items-end gap-2"><span className="text-muted-foreground">Current balance: {adjGodown && adjProduct ? `${adjBefore} kg` : "—"}</span><button type="submit" disabled={adjPending} className="ml-auto px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{adjPending ? "Posting…" : "Create & Post Adjustment"}</button></div>
        </form>
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
                <label className="block font-medium text-foreground mb-1" htmlFor="product">Product</label>
                <select id="product"
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
                  <label className="block font-medium text-foreground mb-1" htmlFor="from-source">From (Source)</label>
                  <select id="from-source"
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
                  <label className="block font-medium text-foreground mb-1" htmlFor="to-destination">To (Destination)</label>
                  <select id="to-destination"
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
                <label className="block font-medium text-foreground mb-1" htmlFor="stock-owner">Stock owner</label>
                <select id="stock-owner"
                  value={transferOwner}
                  onChange={(e) => setTransferOwner(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                >
                  <option value="">Company stock</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="transfer-quantity-kg">Transfer Quantity (kg)</label>
                <input id="transfer-quantity-kg"
                  type="number"
                  value={transferQty}
                  onChange={(e) => setTransferQty(Number(e.target.value))}
                  min="1"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="transfer-reason-notes">Transfer Reason / Notes</label>
                <input id="transfer-reason-notes"
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="e.g. Moving lot to Plant A"
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
        description={`Move ${transferQty} kg of ${products.find((p) => p.id === transferProductId)?.name || "the selected product"} from ${godowns.find((g) => g.id === transferFromGodown)?.name || "source"} to ${godowns.find((g) => g.id === transferToGodown)?.name || "destination"}. Total stock does not change.`}
        confirmLabel="Execute Transfer"
        pending={isPending}
        onConfirm={handleConfirmTransfer}
        onCancel={() => setShowTransferConfirm(false)}
      />
      <ReversalDialog
        open={!!revTransfer}
        voucherLabel={revTransfer?.transfer_no ?? ""}
        pending={revPending}
        onConfirm={handleTransferReversal}
        onCancel={() => setRevTransfer(null)}
      />
      <ReversalDialog
        open={!!revAdjustment}
        voucherLabel={revAdjustment?.adjustment_no ?? ""}
        pending={revPending}
        onConfirm={handleAdjReversal}
        onCancel={() => setRevAdjustment(null)}
      />
    </div>
  )
}
