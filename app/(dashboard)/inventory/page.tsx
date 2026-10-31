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
import { getInventoryInitData, getStockSummary, getStockLedger, getStockAgeing, reverseTransfer, createAdjustment, postAdjustment, reverseAdjustment, listTransfers, listAdjustments } from "@/app/actions/inventory"
import { listGodowns, listProducts, listParties } from "@/app/actions/masters"
import { StockLedgerEntry, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatDateTime } from "@/lib/utils"
import { exportReportToCsv, exportToExcel, exportToPdf } from "@/lib/export-utils"
import { logExport } from "@/app/actions/audit-log"
import {
  AlertBanner,
  EmptyState,
  FilterBanner,
  ReversalDialog,
  getUrlFilter,
} from "@/components/erp-ui"
import { InventorySkeleton } from "@/components/route-skeletons"
import { InventoryTransferDialog } from "@/components/inventory-transfer-dialog"
import { InventoryAdjustmentDialog } from "@/components/inventory-adjustment-dialog"
import { GodownSelect } from "@/components/erp-form"

// Summary, ledger and count rows, memoized so the page's frequent
// re-renders (search typing, count typing, collapse toggles) skip rows
// whose data is unchanged. Each is the old inline row copied verbatim;
// summary/ledger rows take the row object itself (its reference is
// stable across renders of the same loaded page), the count row takes
// primitives plus the one stable callback below.
const InventorySummaryRow = React.memo(function InventorySummaryRow(props: { item: any }) {
  const { item } = props
  return (
    <tr className="hover:bg-muted transition-colors">
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
  )
})

const InventoryLedgerRow = React.memo(function InventoryLedgerRow(props: { entry: StockLedgerEntry }) {
  const { entry } = props
  return (
    <tr className="hover:bg-muted transition-colors">
      <td className="py-3 text-muted-foreground font-sans">{formatDateTime(entry.date)}</td>
      <td className="py-3 font-bold text-foreground font-sans">{entry.voucher_no}</td>
      <td className="py-3">
        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase text-[9px] font-bold">
          {entry.voucher_type.replace("_", " ")}
        </span>
      </td>
      <td className="py-3 text-muted-foreground font-sans">{entry.godown_name}</td>
      <td className="py-3 font-semibold text-foreground font-sans">{entry.product_name}</td>
      <td className="py-3 text-muted-foreground font-sans">{(entry as any).lot_number || "—"}</td>
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
  )
})

const CountRow = React.memo(function CountRow(props: {
  rowKey: string
  product: string
  owner: string
  systemQty: number
  counted: string
  variance: number
  onCounted: (key: string, value: string) => void
}) {
  const { rowKey, product, owner, systemQty, counted, variance, onCounted } = props
  return (
    <tr className="hover:bg-muted transition-colors">
      <td className="py-3 font-bold text-foreground">{product}</td>
      <td className="py-3 text-muted-foreground">{owner}</td>
      <td className="py-3 text-right font-mono">{formatWeight(systemQty)}</td>
      <td className="py-3 text-right"><input type="number" min="0" value={counted} onChange={(e) => onCounted(rowKey, e.target.value)} className="w-32 px-2 py-1.5 rounded-md bg-background border border-border text-foreground font-mono text-right" /></td>
      <td className={`py-3 text-right font-bold font-mono ${variance === 0 ? "text-muted-foreground" : variance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{variance > 0 ? `+${formatWeight(variance)}` : formatWeight(variance)}</td>
    </tr>
  )
})

export default function InventoryPage() {
  const [activeTab, setActiveTab] = React.useState<"summary" | "ledger" | "transfers" | "adjustments" | "count" | "ageing">("summary")
  const [rawSummary, setRawSummary] = React.useState<any[]>([])
  const [transfers, setTransfers] = React.useState<any[]>([])
  const [adjustments, setAdjustments] = React.useState<any[]>([])
  const [ageing, setAgeing] = React.useState<any[]>([])
  const [transferPage, setTransferPage] = React.useState(1)
  const [transferTotal, setTransferTotal] = React.useState(0)
  const [adjustmentPage, setAdjustmentPage] = React.useState(1)
  const [adjustmentTotal, setAdjustmentTotal] = React.useState(0)
  const [lotFilter, setLotFilter] = React.useState("")
  const [countGodown, setCountGodown] = React.useState("")
  const [counted, setCounted] = React.useState<Record<string, string>>({})
  const [countReason, setCountReason] = React.useState("")
  const [countApprover, setCountApprover] = React.useState("")
  const [countPending, setCountPending] = React.useState(false)
  const [parties, setParties] = React.useState<Party[]>([])
  const [collapsedGodowns, setCollapsedGodowns] = React.useState<string[]>([])
  const [ledgerPage, setLedgerPage] = React.useState(1)
  const [ledgerTotal, setLedgerTotal] = React.useState(0)
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

  // Dialogs own their own form state (POS pattern); the page only
  // tracks which one is open.
  const [isTransferModalOpen, setIsTransferModalOpen] = React.useState(false)
  const [isAdjustmentOpen, setIsAdjustmentOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [transferError, setTransferError] = React.useState("")
  const [transferNotice, setTransferNotice] = React.useState("")
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)

  // Lookup maps, rebuilt only when the lookup list changes. The old
  // per-row .find() made every transfers/adjustments/export row scan the
  // whole godown, product or party list on every render. First entry
  // wins, exactly as .find() did; a missing id still falls back to the
  // id (or "Not set") at each call site, as before.
  const godownNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const g of godowns) if (!map.has(g.id)) map.set(g.id, g.name)
    return map
  }, [godowns])
  const productNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const x of products) if (!map.has(x.id)) map.set(x.id, x.name)
    return map
  }, [products])
  const partyNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const x of parties) if (!map.has(x.id)) map.set(x.id, x.name)
    return map
  }, [parties])
  const productInfoMap = React.useMemo(() => {
    const map = new Map<string, { code: string; category: string }>()
    for (const x of products) if (!map.has(x.id)) map.set(x.id, { code: x.code, category: x.category })
    return map
  }, [products])
  // Stable identity so CountRow's memo is not defeated by a new closure
  // on every keystroke; the update is the old inline one, unchanged.
  const handleCountedChange = React.useCallback((key: string, value: string) => {
    setCounted((prev) => ({ ...prev, [key]: value }))
  }, [])

  const applyLedgerPage = React.useCallback((le: any, godownList: Godown[], productList: Product[]) => {
    const rows = Array.isArray(le.data?.rows) ? le.data.rows : []
    setLedgerTotal(Number(le.data?.total) || 0)
    setLedgerEntries(rows.map((e: any) => ({
      ...e,
      godown_name: godownList.find((x) => x.id === e.godown_id)?.name ?? e.godown_id,
      product_name: productList.find((x) => x.id === e.product_id)?.name ?? e.product_id,
    })))
  }, [])

  const loadLedgerPage = React.useCallback(async (page: number, godown: string, godownList: Godown[], productList: Product[], lot?: string) => {
    const le = await getStockLedger({ page, pageSize: 50, godownId: godown !== "all" ? godown : undefined, lotNumber: lot?.trim() ? lot.trim() : undefined })
    if (!le.success) setTransferError(le.error ?? "Could not load the ledger.")
    else applyLedgerPage(le, godownList, productList)
    setLedgerPage(page)
  }, [applyLedgerPage])

  const loadTransfersPage = React.useCallback(async (page: number) => {
    const tr = await listTransfers({ page, pageSize: 50 })
    if (!tr.success) setTransferError(tr.error ?? "Could not load transfers.")
    else {
      setTransfers(Array.isArray((tr.data as any)?.rows) ? (tr.data as any).rows : (Array.isArray(tr.data) ? tr.data : []))
      setTransferTotal(Number((tr.data as any)?.total) || 0)
      setTransferPage(Number((tr.data as any)?.page) || page)
    }
  }, [])

  const loadAdjustmentsPage = React.useCallback(async (page: number) => {
    const ad = await listAdjustments({ page, pageSize: 50 })
    if (!ad.success) setTransferError(ad.error ?? "Could not load adjustments.")
    else {
      setAdjustments(Array.isArray((ad.data as any)?.rows) ? (ad.data as any).rows : (Array.isArray(ad.data) ? ad.data : []))
      setAdjustmentTotal(Number((ad.data as any)?.total) || 0)
      setAdjustmentPage(Number((ad.data as any)?.page) || page)
    }
  }, [])

  const loadAgeingData = React.useCallback(async () => {
    try {
      const ag = await getStockAgeing()
      if (ag.success) setAgeing(Array.isArray(ag.data) ? ag.data : [])
      else setTransferError(ag.error ?? "Could not load stock ageing.")
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Could not load stock ageing.")
    }
  }, [])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await getInventoryInitData()
      if (!res.success) {
        setTransferError(res.error ?? "Could not load inventory data.")
        return
      }
      const data = (res.data ?? {}) as any
      const godownList = (Array.isArray(data.godowns) ? data.godowns : []) as Godown[]
      const productList = (Array.isArray(data.products) ? data.products : []) as Product[]
      const partyList = (Array.isArray(data.parties) ? data.parties : []) as Party[]
      setRawSummary(Array.isArray(data.summary) ? data.summary : [])
      setGodowns(godownList)
      setProducts(productList)
      setParties(partyList)
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Could not load inventory data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Mount load: without this the page never leaves its skeleton
  React.useEffect(() => { loadData(); setDrillFilter(getUrlFilter()) }, [loadData])

  // Lazy tab loader: fetch sub-registers only when switching to that tab
  React.useEffect(() => {
    if (activeTab === "ledger" && ledgerEntries.length === 0) {
      void loadLedgerPage(1, selectedGodown, godowns, products, lotFilter)
    } else if (activeTab === "transfers" && transfers.length === 0) {
      void loadTransfersPage(1)
    } else if (activeTab === "adjustments" && adjustments.length === 0) {
      void loadAdjustmentsPage(1)
    } else if (activeTab === "ageing" && ageing.length === 0) {
      void loadAgeingData()
    }
  }, [activeTab, ledgerEntries.length, transfers.length, adjustments.length, ageing.length, loadLedgerPage, selectedGodown, godowns, products, lotFilter, loadTransfersPage, loadAdjustmentsPage, loadAgeingData])

  React.useEffect(() => {
    if (godowns.length > 0 && !countGodown) {
      const first = godowns[0].id
      setCountGodown(first)
      const next: Record<string, string> = {}
      for (const r of rawSummary.filter((x) => x.godown_id === first)) {
        next[`${r.godown_id}|${r.product_id}|${r.party_id ?? ""}`] = String(r.balance_kg ?? 0)
      }
      setCounted(next)
    }
  }, [godowns, rawSummary, countGodown])

  const countRows = React.useMemo(
    () => rawSummary.filter((r) => !countGodown || r.godown_id === countGodown),
    [rawSummary, countGodown],
  )
  const countKey = (r: any) => `${r.godown_id}|${r.product_id}|${r.party_id ?? ""}`
  const handleCountSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (countPending) return
    if (!countGodown) return setTransferError("Select a godown for the count.")
    if (!countReason.trim()) return setTransferError("A count reason is required.")
    if (!countApprover.trim()) return setTransferError("An approver is required for count adjustments.")
    const variances = countRows.map((r) => {
      const systemQty = Number(r.balance_kg) || 0
      const countedQty = Number(counted[countKey(r)])
      return { row: r, systemQty, countedQty }
    }).filter((v) => Number.isFinite(v.countedQty) && v.countedQty >= 0 && v.countedQty !== v.systemQty)
    if (!variances.length) {
      setTransferNotice("Count matches system stock — no adjustments created.")
      return
    }
    setCountPending(true)
    try {
      const failures: string[] = []
      let created = 0
      for (const v of variances) {
        const adj = await createAdjustment({
          godownId: v.row.godown_id, productId: v.row.product_id, quantityBeforeKg: v.systemQty, quantityAfterKg: v.countedQty,
          reason: countReason.trim(), approver: countApprover.trim(), partyId: v.row.party_id || undefined,
        })
        if (!adj.success || !(adj.data as any)?.id) { failures.push(`${v.row.product_name}: ${adj.error ?? "could not create adjustment"}`); continue }
        const posted = await postAdjustment((adj.data as any).id, postToken("adjustment:post", (adj.data as any).id))
        if (!posted.success) failures.push(`${v.row.product_name}: ${posted.error ?? "could not post adjustment"}`)
        else created++
      }
      if (failures.length) setTransferError(`Count adjustments: ${created} posted, ${failures.length} failed — ${failures.join("; ")}`)
      else setTransferNotice(`Count posted: ${created} adjustment${created === 1 ? "" : "s"} for variances in ${godowns.find((g) => g.id === countGodown)?.name ?? "the godown"}.`)
      await loadData()
    } finally {
      setCountPending(false)
    }
  }

  const filteredSummary = React.useMemo(() => rawSummary.filter((r) => {
    const prod = productInfoMap.get(r.product_id)
    const matchesSearch = (r.product_name ?? "").toLowerCase().includes(searchQuery.toLowerCase()) || (prod?.code ?? "").toLowerCase().includes(searchQuery.toLowerCase())
    // Category now arrives server-side on the summary row; the masters
    // join is only a fallback for older cached rows.
    const matchesCategory = selectedCategory === "all" || (r.product_category ?? prod?.category ?? "") === selectedCategory
    const matchesDrill = drillFilter === "low" ? !!r.below_min_stock : true
    return matchesSearch && matchesCategory && matchesDrill
  }), [rawSummary, productInfoMap, searchQuery, selectedCategory, drillFilter])

  const filteredLedger = React.useMemo(() => ledgerEntries.filter((entry) => {
    const matchesSearch =
      (entry.product_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.voucher_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (entry.notes || "").toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  }), [ledgerEntries, searchQuery])

  // Per-godown groups, built once per filtered list: the old render
  // re-filtered the whole summary once per godown on every render, and
  // re-counted low stock per group. Order is godown order, empty godowns
  // omitted, exactly as the old godowns.map with its early return did.
  const groupedSummary = React.useMemo(() => {
    const groups: { godown: Godown; rows: any[]; lowCount: number }[] = []
    for (const g of godowns) {
      const rows = filteredSummary.filter((r) => r.godown_id === g.id)
      if (rows.length) groups.push({ godown: g, rows, lowCount: rows.filter((r) => r.below_min_stock).length })
    }
    return groups
  }, [godowns, filteredSummary])

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

  // Shared by the CSV / Excel / PDF buttons: one definition of the active
  // tab's rows, columns, title and totals, so all formats agree.
  const getInventoryExport = () => {
    if (activeTab === "count") return { rows: countRows.map((r: any) => ({ godown: godownNameMap.get(r.godown_id) ?? r.godown_id, product: r.product_name, owner: r.party_name || "Company", system_kg: r.balance_kg, counted_kg: Number(counted[countKey(r)]) || 0, variance_kg: (Number(counted[countKey(r)]) || 0) - (Number(r.balance_kg) || 0) })), filename: "stock_count", columns: [{ key: "godown", label: "Godown" }, { key: "product", label: "Product" }, { key: "owner", label: "Owner" }, { key: "system_kg", label: "System (kg)" }, { key: "counted_kg", label: "Counted (kg)" }, { key: "variance_kg", label: "Variance (kg)" }], options: { title: "Stock Count" }, report: "inventory_count" }
    if (activeTab === "ageing") return { rows: ageing.map((a: any) => ({ godown: a.godown_name, product: a.product_name, owner: a.party_name || "Company", days_0_30: a.buckets["0-30"] ?? 0, days_31_60: a.buckets["31-60"] ?? 0, days_61_90: a.buckets["61-90"] ?? 0, days_90_plus: a.buckets["90+"] ?? 0, total_kg: a.total_kg ?? 0 })), filename: "stock_ageing", columns: [{ key: "godown", label: "Godown" }, { key: "product", label: "Product" }, { key: "owner", label: "Owner" }, { key: "days_0_30", label: "0-30 days" }, { key: "days_31_60", label: "31-60 days" }, { key: "days_61_90", label: "61-90 days" }, { key: "days_90_plus", label: "90+ days" }, { key: "total_kg", label: "Total (kg)" }], options: { title: "Stock Ageing (FIFO approximation)" }, report: "inventory_ageing" }
    if (activeTab === "summary") return { rows: filteredSummary.map((r) => ({ godown: r.godown_name, product: r.product_name, owner: r.party_name || "Company", stock_kg: r.balance_kg, min_stock: r.min_stock_kg || 0, below_min: r.below_min_stock ? "yes" : "no" })), filename: "godown_stock_summary", columns: [{ key: "godown", label: "Godown" }, { key: "product", label: "Product" }, { key: "owner", label: "Owner" }, { key: "stock_kg", label: "Stock (kg)" }, { key: "min_stock", label: "Min stock" }, { key: "below_min", label: "Below min" }], options: { title: "Godown Stock Summary", totals: { stock_kg: filteredSummary.reduce((a, r) => a + (Number(r.balance_kg) || 0), 0) } }, report: "inventory_summary" }
    if (activeTab === "transfers") return { rows: transfers.map((t: any) => ({ transfer_no: t.transfer_no, date: t.date, from: godownNameMap.get(t.from_godown_id) ?? "Not set", to: godownNameMap.get(t.to_godown_id) ?? "Not set", product: productNameMap.get(t.product_id) ?? t.product_id, quantity_kg: t.quantity, status: t.status })), filename: "transfers", columns: [{ key: "transfer_no", label: "Transfer no" }, { key: "date", label: "Date" }, { key: "from", label: "From" }, { key: "to", label: "To" }, { key: "product", label: "Product" }, { key: "quantity_kg", label: "Quantity (kg)" }, { key: "status", label: "Status" }], options: { title: "Stock Transfers", totals: { quantity_kg: transfers.reduce((a, t: any) => a + (Number(t.quantity) || 0), 0) } }, report: "inventory_transfers" }
    if (activeTab === "adjustments") return { rows: adjustments.map((a: any) => ({ adjustment_no: a.adjustment_no, date: a.date, godown: godownNameMap.get(a.godown_id) ?? a.godown_id, product: productNameMap.get(a.product_id) ?? a.product_id, before_kg: a.quantity_before, after_kg: a.quantity_after, status: a.status })), filename: "adjustments", columns: [{ key: "adjustment_no", label: "Adjustment no" }, { key: "date", label: "Date" }, { key: "godown", label: "Godown" }, { key: "product", label: "Product" }, { key: "before_kg", label: "Before (kg)" }, { key: "after_kg", label: "After (kg)" }, { key: "status", label: "Status" }], options: { title: "Stock Adjustments" }, report: "inventory_adjustments" }
    return { rows: filteredLedger.map((e) => ({ date: e.date, voucher_no: e.voucher_no, type: e.voucher_type, godown: e.godown_name, product: e.product_name, inward_kg: e.inward_qty, outward_kg: e.outward_qty, balance_kg: e.running_balance, notes: e.notes || "" })), filename: "stock_movement_ledger", columns: [{ key: "date", label: "Date" }, { key: "voucher_no", label: "Voucher" }, { key: "type", label: "Type" }, { key: "godown", label: "Godown" }, { key: "product", label: "Product" }, { key: "inward_kg", label: "Inward (kg)" }, { key: "outward_kg", label: "Outward (kg)" }, { key: "balance_kg", label: "Balance (kg)" }, { key: "notes", label: "Notes" }], options: { title: "Stock Movement Ledger", totals: { inward_kg: filteredLedger.reduce((a, e) => a + (Number(e.inward_qty) || 0), 0), outward_kg: filteredLedger.reduce((a, e) => a + (Number(e.outward_qty) || 0), 0) } }, report: "inventory_ledger" }
  }
  const handleInventoryExport = async (format: "csv" | "xlsx" | "pdf") => {
    const e = getInventoryExport()
    const ok = format === "csv"
      ? exportReportToCsv<Record<string, any>>(e.rows, e.filename, e.columns as any, e.options as any)
      : format === "xlsx"
        ? await exportToExcel<Record<string, any>>(e.rows, e.filename, e.columns as any, e.options as any)
        : await exportToPdf<Record<string, any>>(e.rows, e.filename, e.columns as any, e.options as any)
    if (ok) void logExport({ report: e.report, format })
  }

  if (isLoading) return <InventorySkeleton />


  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      <AlertBanner tone="error" message={transferError} onDismiss={() => setTransferError("")} />
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
            onClick={() => void handleInventoryExport("csv")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title="Download CSV"
          >
            <Download className="h-4 w-4 text-emerald-500" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => void handleInventoryExport("xlsx")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title="Download Excel"
          >
            <Download className="h-4 w-4 text-emerald-500" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={() => void handleInventoryExport("pdf")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title="Download PDF"
          >
            <Download className="h-4 w-4 text-emerald-500" />
            <span>Export PDF</span>
          </button>

          <button
            type="button"
            onClick={() => setIsTransferModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <ArrowRightLeft className="h-4 w-4" />
            <span>Transfer</span>
          </button>
          <button
            type="button"
            onClick={() => setIsAdjustmentOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <span>Correct stock</span>
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
            Transfers ({transferTotal})
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
            Adjustments ({adjustmentTotal})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("count")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "count"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Count
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ageing")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "ageing"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Ageing ({ageing.length})
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
          ) : activeTab === "ledger" ? (
            <>
              <input
                type="text"
                value={lotFilter}
                onChange={(e) => setLotFilter(e.target.value)}
                placeholder="Lot no. (optional)"
                className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground"
              />
              <button type="button" onClick={() => void loadLedgerPage(1, selectedGodown, godowns, products, lotFilter)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-semibold cursor-pointer">Filter lot</button>
              <select
                value={selectedGodown}
                onChange={(e) => { setSelectedGodown(e.target.value); void loadLedgerPage(1, e.target.value, godowns, products, lotFilter) }}
                className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground"
              >
                <option value="all">All Godowns</option>
                {godowns.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.code})
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      </div>

      {/* Tab 1: Live Stock Summary, grouped per godown. Low stock is
          evaluated per godown row, never from an enterprise total. */}
      {activeTab === "summary" && (
        <div className="space-y-4">
          {groupedSummary.map(({ godown: g, rows, lowCount }) => (
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
                        <InventorySummaryRow key={`${item.godown_id}-${item.product_id}-${item.party_id ?? ""}`} item={item} />
                      ))}
                    </tbody>
                  </table>
                </div>
                )}
              </div>
          ))}
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
                  <th className="pb-3 font-bold">Lot</th>
                  <th className="pb-3 font-bold text-right">Inward</th>
                  <th className="pb-3 font-bold text-right">Outward</th>
                  <th className="pb-3 font-bold text-right">Balance</th>
                  <th className="pb-3 font-bold">Remarks / Trace</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {filteredLedger.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-4 font-sans">
                      <EmptyState
                        title="No ledger movements match these filters"
                        hint="Movements appear here after you post a voucher."
                      />
                    </td>
                  </tr>
                )}
                {filteredLedger.map((entry) => (
                  <InventoryLedgerRow key={entry.id} entry={entry} />
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
                    <td className="py-3 text-muted-foreground">{godownNameMap.get(t.from_godown_id) ?? "Not set"} → {godownNameMap.get(t.to_godown_id) ?? "Not set"}</td>
                    <td className="py-3 font-semibold text-foreground">{productNameMap.get(t.product_id) ?? t.product_id}</td>
                    <td className="py-3 text-muted-foreground">{t.party_id ? (partyNameMap.get(t.party_id) ?? t.party_id) : "Company"}</td>
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

      {activeTab === "transfers" && (
        <div className="expensive-card p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">
            {transferPage === 1
              ? `Showing latest ${transfers.length} of ${transferTotal} transfers`
              : `Showing rows ${(transferPage - 1) * 50 + 1}–${(transferPage - 1) * 50 + transfers.length} of ${transferTotal} transfers`}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={transferPage <= 1} onClick={() => void loadTransfersPage(transferPage - 1)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-semibold cursor-pointer disabled:opacity-50">Previous</button>
            <span className="font-mono">Page {transferPage} of {Math.max(1, Math.ceil(transferTotal / 50))}</span>
            <button type="button" disabled={transferPage * 50 >= transferTotal} onClick={() => void loadTransfersPage(transferPage + 1)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-semibold cursor-pointer disabled:opacity-50">Next</button>
          </span>
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
                    <td className="py-3 text-muted-foreground">{godownNameMap.get(a.godown_id) ?? a.godown_id}</td>
                    <td className="py-3 font-semibold text-foreground">{productNameMap.get(a.product_id) ?? a.product_id}</td>
                    <td className="py-3 text-muted-foreground">{a.party_id ? (partyNameMap.get(a.party_id) ?? a.party_id) : "Company"}</td>
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

      {activeTab === "adjustments" && (
        <div className="expensive-card p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">
            {adjustmentPage === 1
              ? `Showing latest ${adjustments.length} of ${adjustmentTotal} adjustments`
              : `Showing rows ${(adjustmentPage - 1) * 50 + 1}–${(adjustmentPage - 1) * 50 + adjustments.length} of ${adjustmentTotal} adjustments`}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={adjustmentPage <= 1} onClick={() => void loadAdjustmentsPage(adjustmentPage - 1)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-semibold cursor-pointer disabled:opacity-50">Previous</button>
            <span className="font-mono">Page {adjustmentPage} of {Math.max(1, Math.ceil(adjustmentTotal / 50))}</span>
            <button type="button" disabled={adjustmentPage * 50 >= adjustmentTotal} onClick={() => void loadAdjustmentsPage(adjustmentPage + 1)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-semibold cursor-pointer disabled:opacity-50">Next</button>
          </span>
        </div>
      )}

      {activeTab === "count" && (
        <div className="expensive-card p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Stock Count</h2>
          <p className="text-xs text-muted-foreground mb-4">Count one godown at a time. System quantities come from the live stock summary; counted quantities default to system stock, so only changed rows create adjustments. Variances post as adjustments with the reason and approver below — this count is the discrepancy source the dashboard stock-alerts card can later use, and no count is invented.</p>
          <form onSubmit={handleCountSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <GodownSelect id="count-godown" label="Godown" value={countGodown} onChange={(gid) => {
                setCountGodown(gid)
                const next: Record<string, string> = {}
                for (const r of rawSummary.filter((x) => x.godown_id === gid)) {
                  next[`${r.godown_id}|${r.product_id}|${r.party_id ?? ""}`] = String(r.balance_kg ?? 0)
                }
                setCounted(next)
              }} godowns={godowns} />
              <div><label className="block font-medium text-foreground mb-1" htmlFor="count-reason">Reason *</label><input id="count-reason" value={countReason} onChange={(e) => setCountReason(e.target.value)} placeholder="e.g. Monthly physical count" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="count-approver">Approver *</label><input id="count-approver" value={countApprover} onChange={(e) => setCountApprover(e.target.value)} placeholder="Approver name" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs min-w-[640px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                    <th className="pb-3 font-bold">Product</th>
                    <th className="pb-3 font-bold">Owner</th>
                    <th className="pb-3 font-bold text-right">System Qty (kg)</th>
                    <th className="pb-3 font-bold text-right">Counted Qty (kg)</th>
                    <th className="pb-3 font-bold text-right">Variance (kg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {countRows.length === 0 && (
                    <tr><td colSpan={5} className="py-4"><EmptyState title="No stock rows for this godown" hint="Select a godown that holds stock, or post an inward voucher first." /></td></tr>
                  )}
                  {countRows.map((r: any) => {
                    const key = countKey(r)
                    const systemQty = Number(r.balance_kg) || 0
                    const countedQty = Number(counted[key])
                    const variance = Number.isFinite(countedQty) ? countedQty - systemQty : 0
                    return (<CountRow key={key} rowKey={key} product={r.product_name} owner={r.party_name || "Company"} systemQty={systemQty} counted={counted[key] ?? ""} variance={variance} onCounted={handleCountedChange} />)
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end">
              <button type="submit" disabled={countPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{countPending ? "Posting…" : "Create Adjustments for Variances"}</button>
            </div>
          </form>
        </div>
      )}

      {activeTab === "ageing" && (
        <div className="expensive-card p-5">
          <h2 className="text-sm font-bold text-foreground mb-1">Stock Ageing (FIFO approximation)</h2>
          <p className="text-xs text-muted-foreground mb-4">Approximation pending client confirmation of the buckets: ledger rows are consumed oldest-first per godown, product and owner pool, and the remaining stock is bucketed by ledger date into 0–30, 31–60, 61–90 and 90+ days. Opening-balances stock carries no ledger date and is excluded from this view.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Godown</th>
                  <th className="pb-3 font-bold">Product</th>
                  <th className="pb-3 font-bold">Owner</th>
                  <th className="pb-3 font-bold text-right">0–30 days</th>
                  <th className="pb-3 font-bold text-right">31–60 days</th>
                  <th className="pb-3 font-bold text-right">61–90 days</th>
                  <th className="pb-3 font-bold text-right">90+ days</th>
                  <th className="pb-3 font-bold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ageing.length === 0 && (
                  <tr><td colSpan={8} className="py-4"><EmptyState title="No ageing data yet" hint="Ageing appears here after ledger movements are posted." /></td></tr>
                )}
                {ageing.map((a: any) => (
                  <tr key={`${a.godown_id}-${a.product_id}-${a.party_id ?? ""}`} className="hover:bg-muted transition-colors">
                    <td className="py-3 text-muted-foreground">{a.godown_name}</td>
                    <td className="py-3 font-semibold text-foreground">{a.product_name}</td>
                    <td className="py-3 text-muted-foreground">{a.party_name || "Company"}</td>
                    <td className="py-3 text-right font-mono">{formatWeight(a.buckets["0-30"] ?? 0)}</td>
                    <td className="py-3 text-right font-mono">{formatWeight(a.buckets["31-60"] ?? 0)}</td>
                    <td className="py-3 text-right font-mono">{formatWeight(a.buckets["61-90"] ?? 0)}</td>
                    <td className="py-3 text-right font-mono">{formatWeight(a.buckets["90+"] ?? 0)}</td>
                    <td className="py-3 text-right font-black text-foreground">{formatWeight(a.total_kg ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <InventoryTransferDialog
        open={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        godowns={godowns}
        products={products}
        parties={parties}
        summary={rawSummary}
        onPosted={(notice) => { setTransferNotice(notice); void loadData() }}
      />
      <InventoryAdjustmentDialog
        open={isAdjustmentOpen}
        onClose={() => setIsAdjustmentOpen(false)}
        godowns={godowns}
        products={products}
        parties={parties}
        summary={rawSummary}
        onPosted={(notice) => { setTransferNotice(notice); void loadData() }}
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
