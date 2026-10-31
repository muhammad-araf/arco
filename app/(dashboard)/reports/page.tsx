"use client"

import * as React from "react"
import {
  BarChart3,
  Printer,
  Calendar,
  Building2,
  TrendingUp,
  Boxes,
  Package,
  Layers,
  ArrowUpRight,
} from "lucide-react"
import { getPL, listOpeningBalances, saveCogsApproval, getCogsApproval, getStockValuation } from "@/app/actions/finance"
import { getSettingsSnapshot } from "@/app/actions/settings"
import { getStockSummary, getStockLedger } from "@/app/actions/inventory"
import { listParties, listProducts, listGodowns } from "@/app/actions/masters"
import { formatCurrency, formatWeight } from "@/lib/utils"
import { exportReportToCsv, exportToExcel, exportToPdf } from "@/lib/export-utils"
import { logExport } from "@/app/actions/audit-log"
import {
  AlertBanner,
  EmptyState,
  } from "@/components/erp-ui"
import { ReportsSkeleton } from "@/components/route-skeletons"

// One stock-movement row, memoized on primitive props only. The movement
// table re-rendered on every ReportsPage render (date typing, COGS typing,
// banners) even when its rows were unchanged; with names resolved by the
// parent into strings, unchanged rows now skip re-rendering. No output
// change: the cells below are the old inline row, copied verbatim.
const StockMovementRow = React.memo(function StockMovementRow(props: {
  godown: string
  product: string
  owner: string
  opening: number
  inward: number
  consumed: number
  produced: number
  dispatched: number
  adjusted: number
  closing: number
}) {
  const { godown, product, owner, opening, inward, consumed, produced, dispatched, adjusted, closing } = props
  return (<tr><td className="py-2 font-sans">{godown}</td><td className="py-2 font-sans font-semibold">{product}</td><td className="py-2 font-sans">{owner}</td><td className="py-2 text-right">{formatWeight(opening)}</td><td className="py-2 text-right">{formatWeight(inward)}</td><td className="py-2 text-right">{formatWeight(consumed)}</td><td className="py-2 text-right">{formatWeight(produced)}</td><td className="py-2 text-right">{formatWeight(dispatched)}</td><td className="py-2 text-right">{formatWeight(adjusted)}</td><td className="py-2 text-right font-bold">{formatWeight(closing)}</td></tr>)
})

// Windowed-table pager, inlined here (not a shared component, so no other
// page is touched). It pages only over rows already fetched and filtered
// in memory: totals and exports still use the full filtered array, never
// this window. Shown only when a table exceeds WINDOW_SIZE rows, so small
// tables render exactly as before with no new controls.
const WINDOW_SIZE = 100
function WindowPager(props: { page: number; totalPages: number; from: number; to: number; total: number; onPage: (p: number) => void }) {
  const { page, totalPages, from, to, total, onPage } = props
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground print:hidden">
      <span>Showing {from}–{to} of {total} rows</span>
      <span className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-3 py-1.5 rounded-lg bg-card border border-border text-xs font-bold cursor-pointer disabled:opacity-50">Previous</button>
        <span className="font-mono self-center">Page {page} of {totalPages}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="px-3 py-1.5 rounded-lg bg-card border border-border text-xs font-bold cursor-pointer disabled:opacity-50">Next</button>
      </span>
    </div>
  )
}

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = React.useState<"pnl" | "stock" | "valuation">("pnl")
  const [reportError, setReportError] = React.useState("")
  const [pl, setPl] = React.useState<any | null>(null)
  const [parties, setParties] = React.useState<any[]>([])
  const [stockSummary, setStockSummary] = React.useState<any[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [cogsInput, setCogsInput] = React.useState("")
  const [cogsBasisInput, setCogsBasisInput] = React.useState("")
  const [cogsNoteInput, setCogsNoteInput] = React.useState("")
  const [appliedCogs, setAppliedCogs] = React.useState<{ amount: number; basis: string; note: string; saved: boolean } | null>(null)
  const [cogsUnavailable, setCogsUnavailable] = React.useState(false)
  const [cogsSaving, setCogsSaving] = React.useState(false)
  // Lookup lists for the stock movement filters.
  const [godowns, setGodowns] = React.useState<any[]>([])
  const [products, setProducts] = React.useState<any[]>([])
  // Stock movement view (inside the stock tab)
  const [stockView, setStockView] = React.useState<"current" | "movement">("current")
  const [movGodown, setMovGodown] = React.useState("")
  const [movProduct, setMovProduct] = React.useState("")
  const [movCategory, setMovCategory] = React.useState("")
  const [movOwner, setMovOwner] = React.useState("")
  const [movRows, setMovRows] = React.useState<any[]>([])
  const [movLoading, setMovLoading] = React.useState(false)
  // Stock valuation tab (finance team's action, loaded defensively)
  const [valStatus, setValStatus] = React.useState<"checking" | "unavailable" | "not-set" | "valued">("checking")
  const [valData, setValData] = React.useState<any | null>(null)
  const [valMethod, setValMethod] = React.useState("")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  // Month defaults come from a client-side effect, never from render
  // (blocking-prerender-current-time under cacheComponents). The skeleton
  // covers first paint, so real defaults are set before content renders.
  const [defaultFrom, setDefaultFrom] = React.useState("")
  const [defaultTo, setDefaultTo] = React.useState("")
  React.useEffect(() => {
    const now = new Date()
    setDefaultFrom(now.toISOString().slice(0, 8) + "01")
    setDefaultTo(now.toISOString().slice(0, 10))
  }, [])

  const effFrom = dateFrom || defaultFrom
  const effTo = dateTo || defaultTo

  // Saved COGS approval for the report month, fetched BEFORE the main
  // load so the main load runs once with it. Previously the approval
  // effect set appliedCogs after the first load had already run, which
  // re-triggered loadData and loaded everything a second time whenever
  // a saved approval existed. The gate below (approvalPendingRef +
  // approvalEpoch) makes the main load wait for this fetch: it runs
  // once per period, either with the saved approval or, when none
  // exists, with no COGS — the same two outcomes the old code produced,
  // minus the duplicate run. Save/Clear still reload via loadData's
  // appliedCogs dependency. The approval fetch itself is unchanged
  // (same action, same month/year args); like before, when the new
  // month has no approval the previous month's approval is left in
  // place — that quirk is preserved, not fixed here.
  const [approvalEpoch, setApprovalEpoch] = React.useState(0)
  const approvalPendingRef = React.useRef(false)
  React.useEffect(() => {
    let cancelled = false
    approvalPendingRef.current = true
    const month = Number(effFrom.slice(5, 7)) || 1
    const year = Number(effFrom.slice(0, 4)) || 2026
    ;(async () => {
      try {
        const res: any = await getCogsApproval({ month, year })
        if (!cancelled && res?.success && res.data) {
          setAppliedCogs({ amount: Number(res.data.amount || 0), basis: res.data.basis ?? "", note: res.data.note ?? "", saved: true })
          setCogsInput(String(res.data.amount ?? "")); setCogsBasisInput(res.data.basis ?? ""); setCogsNoteInput(res.data.note ?? "")
        }
      } catch { /* as before: a failed approval read is ignored */ }
      finally {
        if (!cancelled) {
          approvalPendingRef.current = false
          setApprovalEpoch((e) => e + 1)
        }
      }
    })()
    setCogsUnavailable(false)
    return () => { cancelled = true }
  }, [effFrom])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      setReportError("")
      const [plRes, sm, pa, pr] = await Promise.all([
        getPL({ from: effFrom, to: effTo, ...(appliedCogs ? { cogsAmount: appliedCogs.amount, cogsBasis: appliedCogs.basis } : {}) }),
        getStockSummary(), listParties(), listProducts(),
      ])
      const failed = [plRes, sm, pa, pr].find((x) => !x.success)
      if (failed) setReportError(failed.error ?? "Could not load report data.")
      setPl(plRes.success ? plRes.data : null)
      const productList = Array.isArray(pr.data) ? pr.data : []
      const grouped = new Map<string, any>()
      for (const r of (Array.isArray(sm.data) ? sm.data : []) as any[]) {
        const prod = productList.find((x: any) => x.id === r.product_id)
        const cur = grouped.get(r.product_id) ?? { id: r.product_id, code: prod?.code ?? "", name: r.product_name, category: prod?.category ?? "", totalStock: 0, bagsCount: 0, min_stock: prod?.min_stock ?? 0 }
        cur.totalStock += Number(r.balance_kg) || 0
        grouped.set(r.product_id, cur)
      }
      for (const cur of grouped.values()) {
        const prod = productList.find((x: any) => x.id === cur.id)
        cur.bagsCount = prod?.weight_per_bag ? Math.round(cur.totalStock / prod.weight_per_bag) : 0
      }
      setStockSummary([...grouped.values()])
      setParties(Array.isArray(pa.data) ? pa.data : [])
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Could not load report data.")
    } finally {
      setIsLoading(false)
    }
  }, [effFrom, effTo, appliedCogs])

  React.useEffect(() => {
    if (!effFrom || !effTo || approvalPendingRef.current) return
    loadData()
  }, [loadData, approvalEpoch])

  React.useEffect(() => {
    listGodowns().then((g) => {
      if (g.success) setGodowns(Array.isArray(g.data) ? g.data : [])
    })
  }, [])
  React.useEffect(() => {
    // Full product list (with categories) for the movement filters.
    listProducts().then((res) => { if (res.success) setProducts(Array.isArray(res.data) ? res.data : []) })
  }, [])

  // Stock movement: every ledger page (no date filter) + opening balances,
  // then opening = openings + pre-period net, closing = opening + period net.
  React.useEffect(() => {
    if (selectedReport !== "stock" || stockView !== "movement") return
    let cancelled = false
    setMovLoading(true)
    ;(async () => {
      try {
        // Ledger pages in parallel, not one-by-one. getStockLedger caps
        // pageSize at 200 server-side, so no single range/limit call can
        // return the whole ledger — pages are still the unit, they just
        // no longer wait on each other. Page 1 reveals the total, the
        // remaining pages (same 50-page cap as before) are fetched
        // together and concatenated in page order, so the rows and
        // their order are identical to the old sequential loop. A page
        // that comes back unsuccessful truncates the result at that
        // page, matching the old loop's break. The openings fetch is
        // independent of the ledger, so it runs alongside the pages;
        // openings are still processed before ledger rows below, so
        // the pool order (and therefore the movement rows' order) is
        // unchanged.
        const openingsPromise = listOpeningBalances()
        const first: any = await getStockLedger({ page: 1, pageSize: 200 })
        const all: any[] = []
        if (first.success && first.data) {
          const firstRows = Array.isArray(first.data.rows) ? first.data.rows : []
          all.push(...firstRows)
          const total = first.data.total
          if (firstRows.length >= 200 && total != null && all.length < total) {
            const lastPage = Math.min(50, Math.ceil(total / 200))
            const rest: any[] = await Promise.all(
              Array.from({ length: lastPage - 1 }, (_, i) => i + 2).map((page) => getStockLedger({ page, pageSize: 200 })),
            )
            for (const res of rest) {
              if (!res.success || !res.data) break
              const rows = Array.isArray(res.data.rows) ? res.data.rows : []
              all.push(...rows)
              if (rows.length < 200) break
            }
          }
        }
        const openings: any = await openingsPromise
        const openRows = openings.success && Array.isArray(openings.data) ? openings.data.filter((o: any) => o.balance_kind === "stock") : []
        if (cancelled) return
        const pools = new Map<string, any>()
        const key = (g: string, p: string, o: string) => `${g}|${p}|${o}`
        for (const o of openRows) {
          const k = key(o.godown_id, o.product_id, o.party_id ?? "")
          const cur = pools.get(k) ?? { godown_id: o.godown_id, product_id: o.product_id, party_id: o.party_id ?? null, opening: 0, inward: 0, consumed: 0, produced: 0, dispatched: 0, adjusted: 0 }
          // An opening dated after the period start is not a period opening.
          if (!effFrom || !o.as_of || String(o.as_of).slice(0, 10) < effFrom) cur.opening += Number(o.quantity || 0)
          pools.set(k, cur)
        }
        for (const r of all) {
          const k = key(r.godown_id, r.product_id, r.party_id ?? "")
          const cur = pools.get(k) ?? { godown_id: r.godown_id, product_id: r.product_id, party_id: r.party_id ?? null, opening: 0, inward: 0, consumed: 0, produced: 0, dispatched: 0, adjusted: 0 }
          const d = String(r.date ?? "").slice(0, 10)
          const inQ = Number(r.inward_qty || 0); const outQ = Number(r.outward_qty || 0)
          if (effFrom && d < effFrom) { cur.opening += inQ - outQ }
          else if ((!effFrom || d >= effFrom) && (!effTo || d <= effTo)) {
            if (r.voucher_type === "inward") cur.inward += inQ
            else if (r.voucher_type === "batch_consume") cur.consumed += outQ
            else if (r.voucher_type === "batch_produce") cur.produced += inQ
            else if (r.voucher_type === "gatepass") cur.dispatched += outQ
            else cur.adjusted += inQ - outQ // adjustment + transfer net
          }
          pools.set(k, cur)
        }
        setMovRows([...pools.values()].map((m) => ({ ...m, closing: m.opening + m.inward - m.consumed + m.produced - m.dispatched + m.adjusted })))
      } finally { if (!cancelled) setMovLoading(false) }
    })()
    return () => { cancelled = true }
  }, [selectedReport, stockView, effFrom, effTo])

  // Stock valuation (finance team's action, import only). The COGS
  // approval half of this effect moved above loadData so the main load
  // runs once with the approval instead of twice; this half is unchanged.
  // The valuation method comes from the valuation_method app setting via
  // the settings snapshot; when it is unconfirmed the valuation action
  // itself returns method_not_set with a null total, and no number is shown.
  React.useEffect(() => {
    getSettingsSnapshot().then(async (snap: any) => {
      const method = snap?.success ? String((snap.data as any)?.valuation_method ?? "unconfirmed") : "unconfirmed"
      setValMethod(method)
      if (method !== "last_purchase_cost" && method !== "average_cost") { setValStatus("not-set"); return }
      try {
        const res: any = await getStockValuation(method)
        if (res?.success && res.data?.status === "valued") { setValData(res.data); setValStatus("valued") }
        else setValStatus("not-set")
      } catch { setValStatus("not-set") }
    }).catch(() => setValStatus("unavailable"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effFrom])

  const handleCogsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = Number(cogsInput)
    if (!(amt >= 0) || !Number.isFinite(amt)) return
    const payload = { amount: amt, basis: cogsBasisInput.trim(), note: cogsNoteInput.trim() }
    setCogsSaving(true)
    try {
      const month = Number(effFrom.slice(5, 7)) || 1
      const year = Number(effFrom.slice(0, 4)) || 2026
      const res = await saveCogsApproval({ month, year, ...payload })
      if (res?.success) { setAppliedCogs({ ...payload, saved: true }); setCogsUnavailable(false) }
      else setReportError(res?.error ?? "Could not save the COGS approval.")
    } catch (err) { setReportError(err instanceof Error ? err.message : "Could not save the COGS approval.") }
    finally { setCogsSaving(false) }
  }

  const inPeriod = (iso: string) => {
    if (dateFrom && iso.slice(0, 10) < dateFrom) return false
    if (dateTo && iso.slice(0, 10) > dateTo) return false
    return true
  }
  const periodLabel = dateFrom || dateTo
    ? `${dateFrom || "…"} to ${dateTo || "…"}`
    : "All posted records to date"

  // P&L straight from getPL (spec §15): posted invoices only for revenue,
  // receipts never counted as revenue, COGS 0 with a warning unless the
  // accountant supplies an approved valuation. Warnings are shown verbatim.
  const machineryRevenue = Number(pl?.serviceRevenue || 0)
  const packingRevenue = 0 // packing-source invoices are inside serviceRevenue above
  const seedSalesRevenue = Number(pl?.productSalesRevenue || 0)
  const otherRevenue = Number(pl?.otherRevenue || 0)
  const totalRevenue = Number(pl?.revenue ?? machineryRevenue + seedSalesRevenue + otherRevenue)
  const operationalExpenses = Number(pl?.operatingExpenses || 0)
  const bardanaCost = Number(pl?.packagingCost || 0)
  const laborPayroll = Number(pl?.payrollCost || 0)
  const cogsAmount = Number(pl?.cogs || 0)
  const totalCosts = Number(pl?.totalCost ?? operationalExpenses + bardanaCost + laborPayroll + cogsAmount)
  const netProfit = Number(pl?.netProfit ?? totalRevenue - totalCosts)
  const netMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0
  const plWarnings: string[] = Array.isArray(pl?.warnings) ? pl.warnings : []

  // Lookup maps, rebuilt only when the lookup list changes. The old
  // per-row .find() made every movement/valuation row scan the whole
  // lookup list on every render (rows x lookups, repeated for the table,
  // the totals and the export). First entry wins, exactly as .find() did,
  // and a missing id still falls back to the id itself.
  const godownNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const g of godowns as any[]) if (!map.has(g.id)) map.set(g.id, g.name)
    return map
  }, [godowns])
  const productNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const x of products as any[]) if (!map.has(x.id)) map.set(x.id, x.name)
    return map
  }, [products])
  const productCategoryMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const x of products as any[]) if (!map.has(x.id)) map.set(x.id, x.category)
    return map
  }, [products])
  const partyNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const x of parties as any[]) if (!map.has(x.id)) map.set(x.id, x.name)
    return map
  }, [parties])
  const productCategories = React.useMemo(
    () => [...new Set(products.map((x: any) => x.category).filter(Boolean))],
    [products],
  )
  // Movement computed rows.
  const godownName = (id: string) => godownNameMap.get(id) ?? id
  const productName = (id: string) => productNameMap.get(id) ?? id
  const partyName = (id: string) => partyNameMap.get(id) ?? id
  const stockTotals = React.useMemo(
    () => stockSummary.reduce((acc, item) => ({ kg: acc.kg + item.totalStock, bags: acc.bags + item.bagsCount }), { kg: 0, bags: 0 }),
    [stockSummary],
  )
  const movFiltered = React.useMemo(() => movRows.filter((m: any) => {
    if (movGodown && m.godown_id !== movGodown) return false
    if (movProduct && m.product_id !== movProduct) return false
    if (movOwner && (m.party_id ?? "") !== movOwner) return false
    if (movCategory && productCategoryMap.get(m.product_id) !== movCategory) return false
    return true
  }), [movRows, movGodown, movProduct, movOwner, movCategory, productCategoryMap])
  const movTotals = React.useMemo(
    () => movFiltered.reduce((a: any, m: any) => ({ opening: a.opening + m.opening, inward: a.inward + m.inward, consumed: a.consumed + m.consumed, produced: a.produced + m.produced, dispatched: a.dispatched + m.dispatched, adjusted: a.adjusted + m.adjusted, closing: a.closing + m.closing }), { opening: 0, inward: 0, consumed: 0, produced: 0, dispatched: 0, adjusted: 0, closing: 0 }),
    [movFiltered],
  )
  // DOM window over the full filtered movement rows. Fetched data,
  // filters, totals (movTotals above) and the export (getCurrentReportExport
  // maps movFiltered, not this slice) are all untouched — only the rows
  // rendered on screen are windowed, at most WINDOW_SIZE at a time. The
  // window resets whenever the filtered set changes, so a filter change
  // never strands the view on an empty later page. The pool key
  // (godown|product|owner) is unique by construction (pools live in a Map
  // keyed on it), so windowed rows keep stable keys and the memoized row
  // component is not remounted by paging within a page.
  const [movPage, setMovPage] = React.useState(1)
  React.useEffect(() => { setMovPage(1) }, [movFiltered])
  const movTotalPages = Math.max(1, Math.ceil(movFiltered.length / WINDOW_SIZE))
  const movPageClamped = Math.min(movPage, movTotalPages)
  const movWindow = React.useMemo(
    () => movFiltered.slice((movPageClamped - 1) * WINDOW_SIZE, movPageClamped * WINDOW_SIZE),
    [movFiltered, movPageClamped],
  )
  // Shared by the CSV / Excel / PDF buttons below: one definition of the
  // current tab's rows, columns, title, range and totals (spec §16), so
  // all three formats of the same report always agree.
  const getCurrentReportExport = () => {
    const range = `${effFrom} to ${effTo}`
    if (selectedReport === "stock" && stockView !== "movement") return { rows: stockSummary.map((p) => ({ code: p.code, name: p.name, category: p.category, stock_kg: p.totalStock, bags: p.bagsCount, min_stock: p.min_stock || 0 })), filename: "stock_summary_report", columns: [{ key: "code", label: "Code" }, { key: "name", label: "Product" }, { key: "category", label: "Category" }, { key: "stock_kg", label: "Stock (kg)" }, { key: "bags", label: "Bags" }, { key: "min_stock", label: "Min stock" }], options: { title: "Stock Summary", dateRange: range, totals: { stock_kg: stockTotals.kg, bags: stockTotals.bags } }, report: "stock_summary" }
    if (selectedReport === "valuation") return { rows: valStatus === "valued" && Array.isArray((valData as any)?.rows) ? (valData as any).rows : [], filename: "stock_valuation_report", columns: [{ key: "productId", label: "Product" }, { key: "closingQty", label: "Closing qty" }, { key: "unitCost", label: "Unit cost" }, { key: "value", label: "Value" }], options: { title: "Stock Valuation", dateRange: range }, report: "stock_valuation" }
    if (selectedReport === "stock" && stockView === "movement") return { rows: movFiltered.map((m: any) => ({ godown: godownName(m.godown_id), product: productName(m.product_id), owner: m.party_id ? partyName(m.party_id) : "Company", opening: m.opening, inward: m.inward, consumed: m.consumed, produced: m.produced, dispatched: m.dispatched, adjusted: m.adjusted, closing: m.closing })), filename: "stock_movement_report", columns: [{ key: "godown", label: "Godown" }, { key: "product", label: "Product" }, { key: "owner", label: "Owner" }, { key: "opening", label: "Opening" }, { key: "inward", label: "Inward" }, { key: "consumed", label: "Consumed" }, { key: "produced", label: "Produced" }, { key: "dispatched", label: "Dispatched" }, { key: "adjusted", label: "Adjusted" }, { key: "closing", label: "Closing" }], options: { title: "Stock Movement", dateRange: range, totals: { opening: movTotals.opening, closing: movTotals.closing } }, report: "stock_movement" }
    return { rows: [{ period: periodLabel, service_revenue: machineryRevenue, product_sales: seedSalesRevenue, other_revenue: otherRevenue, operating_expenses: operationalExpenses, packaging_cost: bardanaCost, payroll_cost: laborPayroll, cogs: cogsAmount, net_profit: netProfit }], filename: "pnl_report", columns: [{ key: "period", label: "Period" }, { key: "service_revenue", label: "Service revenue" }, { key: "product_sales", label: "Product sales" }, { key: "other_revenue", label: "Other revenue" }, { key: "operating_expenses", label: "Operating expenses" }, { key: "packaging_cost", label: "Packaging cost" }, { key: "payroll_cost", label: "Payroll cost" }, { key: "cogs", label: "COGS" }, { key: "net_profit", label: "Net profit" }], options: { title: "Profit & Loss", dateRange: range }, report: "profit_and_loss" }
  }
  const handleReportExport = async (format: "csv" | "xlsx" | "pdf") => {
    const e = getCurrentReportExport()
    const ok = format === "csv"
      ? exportReportToCsv(e.rows, e.filename, e.columns as any, e.options as any)
      : format === "xlsx"
        ? await exportToExcel(e.rows, e.filename, e.columns as any, e.options as any)
        : await exportToPdf(e.rows, e.filename, e.columns as any, e.options as any)
    if (ok) void logExport({ report: e.report, format, filters: { dateRange: `${effFrom} to ${effTo}` } })
  }

  if (isLoading) return <ReportsSkeleton />


  return (
    <div className="space-y-6">
      <AlertBanner tone="warning" message="P&L counts posted invoices only. Receipts are never revenue. This is not audited accounts." />
      {reportError && <AlertBanner tone="error" message={/not configured|Authentication required/i.test(reportError) ? "Supabase is not set up, or sign-in is required. See SETUP.md." : reportError} onDismiss={() => setReportError("")} />}
      {plWarnings.map((w, i) => (<AlertBanner key={i} tone="warning" message={w} />))}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-emerald-500" />
            Reports
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" htmlFor="report-date-from">
            From
            <input id="report-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-2 py-1.5 rounded-lg bg-background border border-border text-foreground font-mono" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" htmlFor="report-date-to">
            To
            <input id="report-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-2 py-1.5 rounded-lg bg-background border border-border text-foreground font-mono" />
          </label>
          <button
            type="button"
            onClick={() => void handleReportExport("csv")}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void handleReportExport("xlsx")}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => void handleReportExport("pdf")}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export PDF
          </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
        >
          <Printer className="h-4 w-4" />
          <span>Print Report Sheet (A4)</span>
        </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">Report period: <strong className="text-foreground">{periodLabel}</strong> · Filters and totals are shown on each report, per spec §16.</p>

      {/* Report Switcher Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1 rounded-lg bg-muted border border-border self-start max-w-full text-xs font-semibold">
        <button
          type="button"
          onClick={() => setSelectedReport("pnl")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            selectedReport === "pnl"
              ? "bg-primary text-primary-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Profit & Loss Statement (P.ID P-L)
        </button>
        <button
          type="button"
          onClick={() => setSelectedReport("stock")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            selectedReport === "stock"
              ? "bg-primary text-primary-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Godown Stock Inventory Summary
        </button>
        <button type="button" onClick={() => setSelectedReport("valuation")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "valuation" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Stock Valuation</button>
      </div>

      {/* P&L Statement View */}
      {selectedReport === "pnl" && (
        <div className="expensive-card p-6 printable-document space-y-6">
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <h2 className="text-lg font-black text-foreground">ARCO SEED GODOWN & PROCESSING</h2>
              <div className="text-xs text-muted-foreground">Comprehensive Commercial Profit & Loss Statement</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Calculated from posted transaction ledgers</div>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 rounded border border-emerald-500/25">
                Margin: {totalRevenue > 0 ? `+${netMargin}%` : "—"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs">
            {/* Revenue Column */}
            <div className="space-y-3">
              <h3 className="font-bold text-foreground uppercase tracking-wider text-[11px] pb-1 border-b border-border flex items-center justify-between">
                <span>Operational Revenues</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(totalRevenue)}</span>
              </h3>

              <div className="space-y-2">
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Certified Seed Product Sales</span>
                  <strong className="font-mono">{formatCurrency(seedSalesRevenue)}</strong>
                </div>
                <p className="text-[11px] text-muted-foreground px-1">No product-sale invoices exist in this prototype, so sales revenue is 0 — it is not estimated.</p>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Machinery Processing & Grading Charges</span>
                  <strong className="font-mono">{formatCurrency(machineryRevenue)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Final Unit Bardana Packing Fees</span>
                  <strong className="font-mono">{formatCurrency(packingRevenue)}</strong>
                </div>
              </div>
            </div>

            {/* Expenses Column */}
            <div className="space-y-3">
              <h3 className="font-bold text-foreground uppercase tracking-wider text-[11px] pb-1 border-b border-border flex items-center justify-between">
                <span>Recognized Costs & Overheads</span>
                <span className="text-destructive font-mono">{formatCurrency(totalCosts)}</span>
              </h3>

              <div className="space-y-2">
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Cost of Goods Sold (Raw Seeds)</span>
                  <strong className="font-mono text-destructive">{appliedCogs ? `-${formatCurrency(cogsAmount)}` : "— not yet approved"}</strong>
                </div>
                <p className="text-[11px] text-muted-foreground px-1">{appliedCogs ? `${appliedCogs.saved ? "Saved approved COGS" : "Local COGS preview (approval action unavailable)"} for this report: ${appliedCogs.basis || "no basis noted"}${appliedCogs.note ? ` — ${appliedCogs.note}` : ""}.` : "COGS needs an approved inventory valuation method (spec §15.1) and is excluded rather than estimated."}</p>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Packaging Material (Bags Consumed)</span>
                  <strong className="font-mono text-destructive">-{formatCurrency(bardanaCost)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Posted Operating Expenses</span>
                  <strong className="font-mono text-destructive">-{formatCurrency(operationalExpenses)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Labor, Operator & Machine Wages</span>
                  <strong className="font-mono text-destructive">{laborPayroll === 0 ? "— no finalized periods" : `-${formatCurrency(laborPayroll)}`}</strong>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleCogsSubmit} className="p-4 rounded-md bg-card border border-border space-y-3">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Approved COGS for this period</h3>
            <p className="text-[11px] text-muted-foreground">The accountant supplies the approved COGS valuation for this period; it is passed to the P&amp;L as-is and is not derived from purchases. Saving uses the finance team&apos;s COGS approval action.</p>
            {cogsUnavailable && <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">COGS approval unavailable — the finance team&apos;s approval action is not available yet, so the amount below is a local preview only and was not saved as an approval.</p>}
            {appliedCogs && !appliedCogs.saved && <p className="text-[11px] text-muted-foreground">Applied as a local preview (not a saved approval).</p>}
            {appliedCogs && appliedCogs.saved && <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">Saved approval loaded for this month{appliedCogs.note ? `: ${appliedCogs.note}` : ""}.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div><label className="block font-medium text-foreground mb-1" htmlFor="cogs-amount-pkr">COGS amount (PKR)</label><input id="cogs-amount-pkr" type="number" value={cogsInput} onChange={(e) => setCogsInput(e.target.value)} min="0" placeholder="e.g. 120000" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="valuation-basis">Valuation basis</label><input id="valuation-basis" value={cogsBasisInput} onChange={(e) => setCogsBasisInput(e.target.value)} placeholder="e.g. Weighted-average closing stock valuation, approved 2026-10-27" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="cogs-note">Note</label><input id="cogs-note" value={cogsNoteInput} onChange={(e) => setCogsNoteInput(e.target.value)} placeholder="Approver note (optional)" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
            </div>
            <div className="flex justify-end gap-2">
              {appliedCogs && (<button type="button" onClick={() => { setAppliedCogs(null); setCogsInput(""); setCogsBasisInput(""); setCogsNoteInput("") }} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Clear COGS</button>)}
              <button type="submit" disabled={cogsSaving} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60">{cogsSaving ? "Saving…" : "Save COGS approval"}</button>
            </div>
          </form>

          {/* Net Profit Banner */}
          <div className="p-4 rounded-md bg-emerald-100 dark:bg-emerald-900 border border-emerald-300 dark:border-emerald-700 flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">
                Net Operating Profit
              </span>
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                {formatCurrency(netProfit)}
              </span>
            </div>
            <div className="text-right text-xs">
              <span className="text-muted-foreground block">Net Profit Margin</span>
              <strong className="text-base text-foreground font-mono font-bold">{totalRevenue > 0 ? `+${netMargin}.0%` : "—"}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Stock Summary Tab: current stock + movement views */}
      {selectedReport === "stock" && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap gap-2 mb-4 text-xs font-semibold">
            <button type="button" onClick={() => setStockView("current")} className={`px-3 py-1.5 rounded-md cursor-pointer ${stockView === "current" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Current stock</button>
            <button type="button" onClick={() => setStockView("movement")} className={`px-3 py-1.5 rounded-md cursor-pointer ${stockView === "movement" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Stock movement</button>
          </div>
          {stockView === "movement" && (
            <div>
              <div className="flex flex-wrap gap-2 mb-4 text-xs">
                <select value={movGodown} onChange={(e) => setMovGodown(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All godowns</option>{godowns.map((g: any) => (<option key={g.id} value={g.id}>{g.name}</option>))}</select>
                <select value={movProduct} onChange={(e) => setMovProduct(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All products</option>{products.map((x: any) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select>
                <select value={movCategory} onChange={(e) => setMovCategory(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All categories</option>{productCategories.map((c: any) => (<option key={c} value={c}>{c}</option>))}</select>
                <select value={movOwner} onChange={(e) => setMovOwner(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All owners</option><option value="">Company stock</option>{parties.map((x: any) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select>
              </div>
              {movLoading ? <p className="text-xs text-muted-foreground">Loading movement…</p> : (
              <div>
              <div className="overflow-x-auto print:hidden"><table className="w-full text-left text-xs min-w-[880px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Godown</th><th className="pb-3">Product</th><th className="pb-3">Owner</th><th className="pb-3 text-right">Opening</th><th className="pb-3 text-right">Inward</th><th className="pb-3 text-right">Consumed</th><th className="pb-3 text-right">Produced</th><th className="pb-3 text-right">Dispatched</th><th className="pb-3 text-right">Adjusted</th><th className="pb-3 text-right">Closing</th></tr></thead>
                <tbody className="divide-y divide-border font-mono">
                  {movFiltered.length === 0 && <tr><td colSpan={10} className="py-4 text-muted-foreground font-sans">No movement rows for these filters.</td></tr>}
                  {movWindow.map((m: any) => (<StockMovementRow key={`${m.godown_id}|${m.product_id}|${m.party_id ?? ""}`} godown={godownName(m.godown_id)} product={productName(m.product_id)} owner={m.party_id ? partyName(m.party_id) : "Company"} opening={m.opening} inward={m.inward} consumed={m.consumed} produced={m.produced} dispatched={m.dispatched} adjusted={m.adjusted} closing={m.closing} />))}
                  {movFiltered.length > 0 && (<tr className="border-t-2 border-border font-bold"><td className="py-2 font-sans" colSpan={3}>Totals</td><td className="py-2 text-right">{formatWeight(movTotals.opening)}</td><td className="py-2 text-right">{formatWeight(movTotals.inward)}</td><td className="py-2 text-right">{formatWeight(movTotals.consumed)}</td><td className="py-2 text-right">{formatWeight(movTotals.produced)}</td><td className="py-2 text-right">{formatWeight(movTotals.dispatched)}</td><td className="py-2 text-right">{formatWeight(movTotals.adjusted)}</td><td className="py-2 text-right">{formatWeight(movTotals.closing)}</td></tr>)}
                </tbody></table></div>
              {movFiltered.length > WINDOW_SIZE && (<WindowPager page={movPageClamped} totalPages={movTotalPages} from={(movPageClamped - 1) * WINDOW_SIZE + 1} to={(movPageClamped - 1) * WINDOW_SIZE + movWindow.length} total={movFiltered.length} onPage={setMovPage} />)}
              {/* Print keeps the full movement table: the screen table above
              is print:hidden, and this copy (display:none on screen, so it
              costs no screen layout/paint) prints every filtered row plus
              the full-data totals, exactly as window.print() printed before
              windowing. It is not an export — exports still use movFiltered. */}
              <div className="hidden print:block overflow-x-auto"><table className="w-full text-left text-xs min-w-[880px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Godown</th><th className="pb-3">Product</th><th className="pb-3">Owner</th><th className="pb-3 text-right">Opening</th><th className="pb-3 text-right">Inward</th><th className="pb-3 text-right">Consumed</th><th className="pb-3 text-right">Produced</th><th className="pb-3 text-right">Dispatched</th><th className="pb-3 text-right">Adjusted</th><th className="pb-3 text-right">Closing</th></tr></thead>
                <tbody className="divide-y divide-border font-mono">
                  {movFiltered.map((m: any) => (<StockMovementRow key={`print-${m.godown_id}|${m.product_id}|${m.party_id ?? ""}`} godown={godownName(m.godown_id)} product={productName(m.product_id)} owner={m.party_id ? partyName(m.party_id) : "Company"} opening={m.opening} inward={m.inward} consumed={m.consumed} produced={m.produced} dispatched={m.dispatched} adjusted={m.adjusted} closing={m.closing} />))}
                  {movFiltered.length > 0 && (<tr className="border-t-2 border-border font-bold"><td className="py-2 font-sans" colSpan={3}>Totals</td><td className="py-2 text-right">{formatWeight(movTotals.opening)}</td><td className="py-2 text-right">{formatWeight(movTotals.inward)}</td><td className="py-2 text-right">{formatWeight(movTotals.consumed)}</td><td className="py-2 text-right">{formatWeight(movTotals.produced)}</td><td className="py-2 text-right">{formatWeight(movTotals.dispatched)}</td><td className="py-2 text-right">{formatWeight(movTotals.adjusted)}</td><td className="py-2 text-right">{formatWeight(movTotals.closing)}</td></tr>)}
                </tbody></table></div>
              </div>)}
              <p className="text-[11px] text-muted-foreground mt-3">Opening = opening balances + ledger net before the period. Adjusted includes adjustment vouchers and transfer net (a transfer moves stock between godowns, so it nets within a pool). Computed from stock_ledger + openings; the current-stock view above is the closing balance.</p>
            </div>
          )}
          {stockView === "current" && (
          <div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Product</th>
                  <th className="pb-3 font-bold">Category</th>
                  <th className="pb-3 font-bold text-right">Physical Stock</th>
                  <th className="pb-3 font-bold text-right">Bags</th>
                  <th className="pb-3 font-bold text-right">Valuation Rate</th>
                  <th className="pb-3 font-bold text-right">Inventory Valuation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {stockSummary.map((item) => (
                  <tr key={item.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-bold text-foreground font-sans">{item.name}</td>
                    <td className="py-3 text-muted-foreground capitalize font-sans">{item.category.replace("_", " ")}</td>
                    <td className="py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatWeight(item.totalStock)}</td>
                    <td className="py-3 text-right text-foreground">{item.bagsCount} bags</td>
                    <td className="py-3 text-right text-muted-foreground font-sans">—</td>
                    <td className="py-3 text-right font-black text-foreground">—</td>
                  </tr>
                ))}
                {stockSummary.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 font-sans">
                      <EmptyState title="No products in stock summary" hint="Add products in Masters and post inward vouchers." />
                    </td>
                  </tr>
                )}
                {stockSummary.length > 0 && (
                  <tr className="border-t-2 border-border font-bold">
                    <td className="py-3 font-sans" colSpan={2}>Totals</td>
                    <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">{formatWeight(stockTotals.kg)}</td>
                    <td className="py-3 text-right">{stockTotals.bags} bags</td>
                    <td className="py-3" colSpan={2} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">Valuation is not shown: no costing method is approved yet (spec §5.1). Quantity tracking works without it.</p>
          </div>
          )}
        </div>
      )}

      {/* Stock valuation */}
      {selectedReport === "valuation" && (
        <div className="expensive-card p-5">
          {valStatus === "checking" && <p className="text-xs text-muted-foreground">Checking valuation availability…</p>}
          {valStatus === "unavailable" && <EmptyState title="Stock valuation unavailable" hint="The finance team's stock valuation action is not available yet, so no valuation is shown rather than an invented number." />}
          {valStatus === "not-set" && <EmptyState title="Valuation method not set" hint="The valuation_method app setting is unconfirmed (or has no committed reader yet). Set the method first — no value is shown until then." />}
          {valStatus === "valued" && valData && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">Method: {valMethod} · Total value: {formatCurrency(Number((valData as any).totalValue ?? 0))}</p>
              <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Product</th><th className="pb-3 text-right">Closing qty</th><th className="pb-3 text-right">Unit cost</th><th className="pb-3 text-right">Value</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {((valData as any).rows ?? []).map((r: any, i: number) => (<tr key={i}><td className="py-2 font-semibold">{productName(r.productId)}</td><td className="py-2 text-right">{formatWeight(Number(r.closingQty || 0))}</td><td className="py-2 text-right">{r.unitCost == null ? "—" : formatCurrency(Number(r.unitCost))}</td><td className="py-2 text-right font-bold">{r.value == null ? "—" : formatCurrency(Number(r.value))}</td></tr>))}
                </tbody></table></div>
              {((valData as any).uncostedProductIds ?? []).length > 0 && <p className="text-[11px] text-muted-foreground mt-3">Uncosted products (no purchase history under this method): {((valData as any).uncostedProductIds ?? []).map((id: string) => productName(id)).join(", ")}.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
