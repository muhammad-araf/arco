"use client"

import * as React from "react"
import Link from "next/link"
import {
  Boxes,
  Users,
  Wallet,
  PackageCheck,
  ScrollText,
  Download,
} from "lucide-react"
import { getStockLedger } from "@/app/actions/inventory"
import {
  getDaybook,
  getPartyStatement,
  getVendorStatement,
  getBardanaLedger,
  listCashAccounts,
} from "@/app/actions/finance"
import {
  listGodowns,
  listProducts,
  listParties,
  listPackagingTypes,
  getCommonMasters,
} from "@/app/actions/masters"
import { listProductionCostLedger } from "@/app/actions/ledgers"
import { DaybookPrint } from "@/components/print/daybook-print"
import { StockLedgerPrint } from "@/components/print/stock-ledger-print"
import { CustomerStatementPrint } from "@/components/print/customer-statement-print"
import { PrintButton } from "@/components/print/print-button"
import { formatCurrency, formatWeight } from "@/lib/utils"
import { exportReportToCsv, exportToExcel, exportToPdf } from "@/lib/export-utils"
import { logExport } from "@/app/actions/audit-log"
import { AlertBanner, EmptyState } from "@/components/erp-ui"
import { LedgersSkeleton } from "@/components/route-skeletons"

type Tab = "stock" | "party" | "cash" | "bardana" | "cost" | "payments"

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "stock", label: "Stock", icon: <Boxes size={14} /> },
  { id: "party", label: "Party", icon: <Users size={14} /> },
  { id: "cash", label: "Cash", icon: <Wallet size={14} /> },
  { id: "bardana", label: "Bardana", icon: <PackageCheck size={14} /> },
  { id: "cost", label: "Cost", icon: <ScrollText size={14} /> },
  { id: "payments", label: "Payments", icon: <Wallet size={14} /> },
]

const inputCls =
  "px-2.5 py-2 rounded-lg bg-background border border-border text-foreground text-xs"
const btnCls =
  "px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
const ghostBtnCls =
  "px-3 py-1.5 rounded-lg bg-card border border-border text-xs font-bold cursor-pointer disabled:opacity-50"
const thCls = "pb-2 text-left"

async function exportRows(
  format: "csv" | "xlsx" | "pdf",
  rows: Record<string, unknown>[],
  filename: string,
  columns: { key: string; label: string }[],
  options: Record<string, unknown>,
  report: string,
) {
  const ok =
    format === "csv"
      ? exportReportToCsv(rows, filename, columns as never, options as never)
      : format === "xlsx"
        ? await exportToExcel(rows, filename, columns as never, options as never)
        : await exportToPdf(rows, filename, columns as never, options as never)
  if (ok) void logExport({ report, format })
}

// One stock-ledger row, memoized on primitive props only. Typing in the
// stock filters (voucher, lot, godown…) re-renders the page while the
// loaded rows are unchanged; with names resolved by the parent, unchanged
// rows now skip re-rendering. Cells copied verbatim from the old inline row.
const StockLedgerRow = React.memo(function StockLedgerRow(props: {
  date: string | undefined
  voucherNo: string
  type: string
  godown: string
  product: string
  lot: string
  inwardQty: number
  outwardQty: number
  balance: number
}) {
  const { date, voucherNo, type, godown, product, lot, inwardQty, outwardQty, balance } = props
  return (
    <tr>
      <td className="py-2">{date}</td>
      <td className="py-2 font-mono font-bold">{voucherNo}</td>
      <td className="py-2">{type}</td>
      <td className="py-2">{godown}</td>
      <td className="py-2">{product}</td>
      <td className="py-2 font-mono">{lot}</td>
      <td className="py-2 text-right">{formatWeight(inwardQty)}</td>
      <td className="py-2 text-right">{formatWeight(outwardQty)}</td>
      <td className="py-2 text-right font-bold">{formatWeight(balance)}</td>
    </tr>
  )
})

// Windowed-table pager, inlined here (not a shared component, so no other
// page is touched). It pages only over rows already fetched in memory:
// totals, exports and print documents still use the full arrays, never
// this window. Shown only when a table exceeds WINDOW_SIZE rows, so small
// tables render exactly as before with no new controls.
const WINDOW_SIZE = 100
function WindowPager(props: { page: number; totalPages: number; from: number; to: number; total: number; onPage: (p: number) => void }) {
  const { page, totalPages, from, to, total, onPage } = props
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground print:hidden">
      <span>Showing {from}–{to} of {total} rows</span>
      <span className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={ghostBtnCls}>Previous</button>
        <span className="font-mono self-center">Page {page} of {totalPages}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} className={ghostBtnCls}>Next</button>
      </span>
    </div>
  )
}

export default function LedgersPage() {
  const [activeTab, setActiveTab] = React.useState<Tab>("stock")
  const [error, setError] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(true)

  // Month defaults come from a client-side effect, never from render
  // (reading new Date() during render blocks prerendering).
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [datesReady, setDatesReady] = React.useState(false)
  React.useEffect(() => {
    const now = new Date()
    setFrom(now.toISOString().slice(0, 8) + "01")
    setTo(now.toISOString().slice(0, 10))
    setDatesReady(true)
  }, [])

  // Lookup lists, shared by every tab.
  const [godowns, setGodowns] = React.useState<any[]>([])
  const [products, setProducts] = React.useState<any[]>([])
  const [parties, setParties] = React.useState<any[]>([])
  const [packaging, setPackaging] = React.useState<any[]>([])
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])

  // --- Stock tab (getStockLedger, the Inventory ledger tab's action) ---
  const [stockRows, setStockRows] = React.useState<any[]>([])
  const [stockPage, setStockPage] = React.useState(1)
  const [stockTotal, setStockTotal] = React.useState(0)
  const [stockBusy, setStockBusy] = React.useState(false)
  const [stGodown, setStGodown] = React.useState("")
  const [stProduct, setStProduct] = React.useState("")
  const [stParty, setStParty] = React.useState("")
  const [stVoucher, setStVoucher] = React.useState("")
  const [stLot, setStLot] = React.useState("")

  // --- Party tab (getPartyStatement / getVendorStatement, Reports tabs) ---
  const [stmtKind, setStmtKind] = React.useState<"party" | "vendor">("party")
  const [stmtPartyId, setStmtPartyId] = React.useState("")
  const [stmt, setStmt] = React.useState<any | null>(null)
  const [stmtBusy, setStmtBusy] = React.useState(false)

  // --- Cash tab (getDaybook, the Daybook page's action) ---
  const [cashAccountId, setCashAccountId] = React.useState("")
  const [daybook, setDaybook] = React.useState<any | null>(null)
  const [cashBusy, setCashBusy] = React.useState(false)

  // --- Bardana tab (getBardanaLedger, Packing summary / Reports tab) ---
  const [baPackaging, setBaPackaging] = React.useState("")
  const [baGodown, setBaGodown] = React.useState("")
  const [bardana, setBardana] = React.useState<any | null>(null)
  const [bardanaBusy, setBardanaBusy] = React.useState(false)

  // --- Cost tab (read-only listProductionCostLedger) ---
  const [costRows, setCostRows] = React.useState<any[]>([])
  const [costType, setCostType] = React.useState("")
  const [costBusy, setCostBusy] = React.useState(false)

  // Lookup maps, rebuilt only when the lookup list changes. The old
  // per-row .find() made every ledger row scan the whole lookup list on
  // every render, for the table and again for print/export rows. First
  // entry wins, exactly as .find() did; a missing id still falls back
  // to the id itself.
  const godownNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const g of godowns) if (!map.has(g.id)) map.set(g.id, g.name)
    return map
  }, [godowns])
  const productNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const p of products) if (!map.has(p.id)) map.set(p.id, p.name)
    return map
  }, [products])
  const packagingNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const p of packaging) if (!map.has(p.id)) map.set(p.id, p.name)
    return map
  }, [packaging])
  const godownName = (id: string) => godownNameMap.get(id) ?? id
  const productName = (id: string) => productNameMap.get(id) ?? id
  const packagingName = (id: string) => packagingNameMap.get(id) ?? id

  const loadStock = React.useCallback(
    async (page: number) => {
      setStockBusy(true)
      try {
        const res = await getStockLedger({
          page,
          pageSize: 50,
          godownId: stGodown || undefined,
          productId: stProduct || undefined,
          partyId: stParty || undefined,
          voucherNo: stVoucher.trim() || undefined,
          lotNumber: stLot.trim() || undefined,
          from: from || undefined,
          to: to || undefined,
        })
        if (!res.success) setError(res.error ?? "Could not load the stock ledger.")
        else {
          setStockRows(Array.isArray((res.data as any)?.rows) ? (res.data as any).rows : [])
          setStockTotal(Number((res.data as any)?.total) || 0)
          setStockPage(Number((res.data as any)?.page) || page)
        }
      } finally {
        setStockBusy(false)
      }
    },
    [stGodown, stProduct, stParty, stVoucher, stLot, from, to],
  )

  const loadParty = React.useCallback(async () => {
    if (!stmtPartyId || !from || !to) {
      setStmt(null)
      return
    }
    setStmtBusy(true)
    try {
      const fn = stmtKind === "vendor" ? getVendorStatement : getPartyStatement
      const res = await fn({ partyId: stmtPartyId, from, to })
      if (!res.success) {
        setError(res.error ?? "Could not load the statement.")
        setStmt(null)
      } else setStmt(res.data)
    } finally {
      setStmtBusy(false)
    }
  }, [stmtPartyId, stmtKind, from, to])

  const loadCash = React.useCallback(async () => {
    if (!from || !to) return
    setCashBusy(true)
    try {
      const res = await getDaybook({
        accountId: cashAccountId || undefined,
        from,
        to,
      })
      if (!res.success) {
        setError(res.error ?? "Could not load the daybook.")
        setDaybook(null)
      } else setDaybook(res.data)
    } finally {
      setCashBusy(false)
    }
  }, [cashAccountId, from, to])

  const loadBardana = React.useCallback(async () => {
    setBardanaBusy(true)
    try {
      const res = await getBardanaLedger({
        packagingTypeId: baPackaging || undefined,
        godownId: baGodown || undefined,
        from: from || undefined,
        to: to || undefined,
      })
      if (!res.success) {
        setError(res.error ?? "Could not load the bardana ledger.")
        setBardana(null)
      } else setBardana(res.data)
    } finally {
      setBardanaBusy(false)
    }
  }, [baPackaging, baGodown, from, to])

  const loadCost = React.useCallback(async () => {
    setCostBusy(true)
    try {
      const res = await listProductionCostLedger({
        from: from || undefined,
        to: to || undefined,
      })
      if (!res.success) {
        setError(res.error ?? "Could not load the cost ledger.")
        setCostRows([])
      } else {
        setCostRows(Array.isArray((res.data as any)?.rows) ? (res.data as any).rows : [])
      }
    } finally {
      setCostBusy(false)
    }
  }, [from, to])

  // Lookups load once via single unified call
  React.useEffect(() => {
    getCommonMasters()
      .then((res) => {
        if (!res.success) {
          setError(res.error ?? "Could not load lookup data.")
          return
        }
        const data = (res.data ?? {}) as any
        setGodowns(Array.isArray(data.godowns) ? data.godowns : [])
        setProducts(Array.isArray(data.products) ? data.products : [])
        setParties(Array.isArray(data.parties) ? data.parties : [])
        setPackaging(Array.isArray(data.packagingTypes) ? data.packagingTypes : [])
        setCashAccounts(Array.isArray(data.cashAccounts) ? data.cashAccounts : [])
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load lookup data."))
      .finally(() => setIsLoading(false))
  }, [])

  React.useEffect(() => {
    if (!datesReady) return
    if (activeTab === "stock") void loadStock(1)
    if (activeTab === "party") void loadParty()
    if (activeTab === "cash") void loadCash()
    if (activeTab === "bardana") void loadBardana()
    if (activeTab === "cost") void loadCost()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, datesReady])

  const applyFilters = () => {
    if (activeTab === "stock") void loadStock(1)
    if (activeTab === "party") void loadParty()
    if (activeTab === "cash") void loadCash()
    if (activeTab === "bardana") void loadBardana()
    if (activeTab === "cost") void loadCost()
  }

  const stockTotals = React.useMemo(
    () => stockRows.reduce(
      (a, r) => ({
        inward: a.inward + (Number(r.inward_qty) || 0),
        outward: a.outward + (Number(r.outward_qty) || 0),
      }),
      { inward: 0, outward: 0 },
    ),
    [stockRows],
  )
  const costTypes = React.useMemo(
    () => [...new Set(costRows.map((r) => String(r.cost_type ?? "")))].filter(Boolean),
    [costRows],
  )
  const shownCostRows = React.useMemo(
    () => (costType ? costRows.filter((r) => r.cost_type === costType) : costRows),
    [costRows, costType],
  )
  const shownCostTotal = React.useMemo(
    () => shownCostRows.reduce((a, r) => a + (Number(r.amount) || 0), 0),
    [shownCostRows],
  )
  const stmtParties = React.useMemo(
    () => parties.filter((x) =>
      stmtKind === "vendor" ? x.type === "supplier" || x.type === "both" : x.type === "customer" || x.type === "both",
    ),
    [parties, stmtKind],
  )

  // DOM windows over the already-fetched entry arrays. The stock tab is
  // NOT windowed here: it is already server-paginated at 50 rows/page.
  // Party/cash/bardana/cost entries arrive as one unbounded array and
  // were rendered in full, so each gets a 100-row screen window. Totals
  // (stmt charges/settlements, daybook receipts/payments, bardana
  // opening/closing, shownCostTotal), exports and print documents all
  // still map the full arrays, never these slices. Each window resets
  // when its source array changes, so a new statement/load never strands
  // the view on an empty later page. Row keys (entry ids) are unchanged,
  // so paging does not remount rows within a page.
  const [partyPage, setPartyPage] = React.useState(1)
  const [cashPage, setCashPage] = React.useState(1)
  const [bardanaPage, setBardanaPage] = React.useState(1)
  const [costPage, setCostPage] = React.useState(1)
  const partyEntries = React.useMemo(() => stmt?.entries ?? [], [stmt])
  const cashEntries = React.useMemo(() => daybook?.entries ?? [], [daybook])
  const bardanaEntries = React.useMemo(() => bardana?.entries ?? [], [bardana])
  React.useEffect(() => { setPartyPage(1) }, [partyEntries])
  React.useEffect(() => { setCashPage(1) }, [cashEntries])
  React.useEffect(() => { setBardanaPage(1) }, [bardanaEntries])
  React.useEffect(() => { setCostPage(1) }, [shownCostRows])
  const windowFor = (rows: any[], page: number) => {
    const totalPages = Math.max(1, Math.ceil(rows.length / WINDOW_SIZE))
    const clamped = Math.min(page, totalPages)
    return { totalPages, clamped, window: rows.slice((clamped - 1) * WINDOW_SIZE, clamped * WINDOW_SIZE) }
  }
  const partyWin = React.useMemo(() => windowFor(partyEntries, partyPage), [partyEntries, partyPage])
  const cashWin = React.useMemo(() => windowFor(cashEntries, cashPage), [cashEntries, cashPage])
  const bardanaWin = React.useMemo(() => windowFor(bardanaEntries, bardanaPage), [bardanaEntries, bardanaPage])
  const costWin = React.useMemo(() => windowFor(shownCostRows, costPage), [shownCostRows, costPage])

  if (isLoading) return <LedgersSkeleton />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Ledgers</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Stock, party, cash, bardana and production cost ledgers in one place.
          These are the same ledgers shown on the Inventory, Reports, Packing
          and Daybook pages — this page adds nothing new except the cost view.
        </p>
      </div>

      <AlertBanner tone="error" message={error} onDismiss={() => setError("")} />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold cursor-pointer border ${
              activeTab === t.id
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-card border-border text-foreground"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Date range shared by every tab */}
      <div className="expensive-card p-4 flex flex-wrap items-end gap-3 text-xs">
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="led-from">From</label>
          <input id="led-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="led-to">To</label>
          <input id="led-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <button type="button" onClick={applyFilters} className={btnCls}>Apply</button>
      </div>

      {activeTab === "stock" && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-bold text-foreground">Stock ledger</h2>
            <PrintButton label="Print stock ledger" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
            <span className="flex gap-2 text-xs">
              {(["csv", "xlsx", "pdf"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() =>
                    void exportRows(
                      f,
                      stockRows.map((e: any) => ({
                        date: e.date?.slice(0, 10),
                        voucher_no: e.voucher_no,
                        type: e.voucher_type,
                        godown: godownName(e.godown_id),
                        product: productName(e.product_id),
                        lot: e.lot_number ?? "",
                        inward_kg: e.inward_qty,
                        outward_kg: e.outward_qty,
                        balance_kg: e.running_balance,
                        notes: e.notes || "",
                      })),
                      "stock_ledger",
                      [
                        { key: "date", label: "Date" },
                        { key: "voucher_no", label: "Voucher" },
                        { key: "type", label: "Type" },
                        { key: "godown", label: "Godown" },
                        { key: "product", label: "Product" },
                        { key: "lot", label: "Lot" },
                        { key: "inward_kg", label: "Inward (kg)" },
                        { key: "outward_kg", label: "Outward (kg)" },
                        { key: "balance_kg", label: "Balance (kg)" },
                        { key: "notes", label: "Notes" },
                      ],
                      { title: "Stock Ledger", dateRange: `${from} to ${to}`, totals: { inward_kg: stockTotals.inward, outward_kg: stockTotals.outward } },
                      "ledgers_stock",
                    )
                  }
                  className={ghostBtnCls}
                >
                  <Download size={12} className="inline mr-1" />
                  {f.toUpperCase()}
                </button>
              ))}
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs mb-4">
            <select aria-label="Godown filter" value={stGodown} onChange={(e) => setStGodown(e.target.value)} className={inputCls}>
              <option value="">All godowns</option>
              {godowns.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
            </select>
            <select aria-label="Product filter" value={stProduct} onChange={(e) => setStProduct(e.target.value)} className={inputCls}>
              <option value="">All products</option>
              {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
            <select aria-label="Party filter" value={stParty} onChange={(e) => setStParty(e.target.value)} className={inputCls}>
              <option value="">All parties</option>
              {parties.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
            <input aria-label="Voucher filter" value={stVoucher} onChange={(e) => setStVoucher(e.target.value)} placeholder="Voucher no" className={inputCls} />
            <input aria-label="Lot filter" value={stLot} onChange={(e) => setStLot(e.target.value)} placeholder="Lot no" className={inputCls} />
          </div>
          <div className="hidden print:block">
            <StockLedgerPrint
              godown={stGodown ? godownName(stGodown) : "All godowns"}
              product={stProduct ? productName(stProduct) : "All products"}
              dateFrom={from}
              dateTo={to}
              rows={stockRows.map((e: any) => ({ date: e.date?.slice(0, 10), voucherNo: e.voucher_no, type: e.voucher_type, godown: godownName(e.godown_id), product: productName(e.product_id), lot: e.lot_number ?? undefined, inwardQty: e.inward_qty, outwardQty: e.outward_qty, balance: e.running_balance }))}
            />
          </div>
          {stockBusy ? (
            <p className="text-xs text-muted-foreground py-4">Loading…</p>
          ) : stockRows.length === 0 ? (
            <EmptyState title="No stock ledger rows match these filters" hint="Widen the date range or clear a filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[760px]">
                <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className={thCls}>Date</th><th className={thCls}>Voucher</th><th className={thCls}>Type</th>
                  <th className={thCls}>Godown</th><th className={thCls}>Product</th><th className={thCls}>Lot</th>
                  <th className={`${thCls} text-right`}>Inward</th><th className={`${thCls} text-right`}>Outward</th>
                  <th className={`${thCls} text-right`}>Balance</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {stockRows.map((e: any) => (
                    <StockLedgerRow
                      key={e.id}
                      date={e.date?.slice(0, 10)}
                      voucherNo={e.voucher_no}
                      type={e.voucher_type}
                      godown={godownName(e.godown_id)}
                      product={productName(e.product_id)}
                      lot={e.lot_number ?? "—"}
                      inwardQty={Number(e.inward_qty || 0)}
                      outwardQty={Number(e.outward_qty || 0)}
                      balance={Number(e.running_balance || 0)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {stockTotal === 0
                ? "No rows"
                : `Showing ${(stockPage - 1) * 50 + 1}–${(stockPage - 1) * 50 + stockRows.length} of ${stockTotal} rows`}
            </span>
            <span className="flex gap-2">
              <button type="button" disabled={stockPage <= 1 || stockBusy} onClick={() => void loadStock(stockPage - 1)} className={ghostBtnCls}>Previous</button>
              <span className="font-mono self-center">Page {stockPage} of {Math.max(1, Math.ceil(stockTotal / 50))}</span>
              <button type="button" disabled={stockPage * 50 >= stockTotal || stockBusy} onClick={() => void loadStock(stockPage + 1)} className={ghostBtnCls}>Next</button>
            </span>
          </div>
        </div>
      )}

      {activeTab === "payments" && (
        <div className="space-y-4">
          <div className="expensive-card p-5">
            <h2 className="text-sm font-bold text-foreground mb-1">Payments</h2>
            <p className="text-xs text-muted-foreground">Links to the three existing pay flows. Nothing is paid from this tab — each link opens the form where it already lives.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="expensive-card p-5">
              <h3 className="text-sm font-bold text-foreground mb-1">Vendor payments</h3>
              <p className="text-xs text-muted-foreground mb-3">Pay a posted purchase from its balance on the Purchases page.</p>
              <Link href="/purchases" className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-block">Go to Purchases</Link>
            </div>
            <div className="expensive-card p-5">
              <h3 className="text-sm font-bold text-foreground mb-1">Customer receipts</h3>
              <p className="text-xs text-muted-foreground mb-3">Record a customer receipt (a collection, not new revenue) on the Billing page.</p>
              <Link href="/billing" className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-block">Go to Billing</Link>
            </div>
            <div className="expensive-card p-5">
              <h3 className="text-sm font-bold text-foreground mb-1">Salary payments</h3>
              <p className="text-xs text-muted-foreground mb-3">Pay an approved payroll period on the Employees Payroll tab.</p>
              <Link href="/employees?tab=payroll" className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-block">Go to Employees payroll</Link>
            </div>
          </div>
        </div>
      )}

      {activeTab === "party" && (
        <div className="expensive-card p-5">
          <div className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-3 text-xs">
            <span className="font-bold">Need to correct a balance? </span>
            Party adjustments are made on the{" "}
            <Link href="/parties" className="font-bold underline text-emerald-700 dark:text-emerald-400">
              Parties page →
            </Link>{" "}
            — this tab only shows statements, it never changes a balance.
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
            <label className="font-medium text-foreground" htmlFor="stmt-kind">Statement for</label>
            <select id="stmt-kind" value={stmtKind} onChange={(e) => { setStmtKind(e.target.value as "party" | "vendor"); setStmtPartyId(""); setStmt(null) }} className={inputCls}>
              <option value="party">Party (customer)</option>
              <option value="vendor">Vendor (supplier)</option>
            </select>
            <label className="font-medium text-foreground" htmlFor="stmt-party">{stmtKind === "vendor" ? "Vendor" : "Party"}</label>
            <select id="stmt-party" value={stmtPartyId} onChange={(e) => setStmtPartyId(e.target.value)} className={inputCls}>
              <option value="">Select a party</option>
              {stmtParties.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
            {stmt && (
              <span className="flex gap-2 ml-auto">
                {(["csv", "xlsx", "pdf"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() =>
                      void exportRows(
                        f,
                        (stmt.entries ?? []).map((e: any) => ({
                          date: e.date?.slice(0, 10),
                          voucher_no: e.voucher_no,
                          type: e.entry_type,
                          debit: e.debit,
                          credit: e.credit,
                          balance: e.running_balance,
                        })),
                        "party_statement",
                        [
                          { key: "date", label: "Date" },
                          { key: "voucher_no", label: "Voucher" },
                          { key: "type", label: "Type" },
                          { key: "debit", label: "Debit" },
                          { key: "credit", label: "Credit" },
                          { key: "balance", label: "Balance" },
                        ],
                        { title: `${stmtKind === "vendor" ? "Vendor" : "Party"} Statement — ${stmt.party?.name ?? ""}`, dateRange: `${from} to ${to}`, totals: { debit: stmt.charges, credit: stmt.settlements } },
                        "ledgers_party",
                      )
                    }
                    className={ghostBtnCls}
                  >
                    <Download size={12} className="inline mr-1" />
                    {f.toUpperCase()}
                  </button>
                ))}
                <PrintButton label="Print statement" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
              </span>
            )}
          </div>
          {stmtBusy ? (
            <p className="text-xs text-muted-foreground py-4">Loading…</p>
          ) : !stmt ? (
            <EmptyState title="Select a party to view its statement" hint="Shows opening balance, charges, settlements and closing. A positive balance means the party owes you." />
          ) : (
            <div>
              <p className="text-xs text-muted-foreground mb-3">
                Opening: {formatCurrency(Number(stmt.opening || 0))} · Charges: {formatCurrency(Number(stmt.charges || 0))} · Settlements: {formatCurrency(Number(stmt.settlements || 0))} · Closing: {formatCurrency(Number(stmt.closing || 0))} ({stmt.closingKind})
              </p>
              <div className="hidden print:block">
                <CustomerStatementPrint
                  customerName={stmt.party?.name}
                  customerPhone={stmt.party?.phone}
                  customerAddress={stmt.party?.address}
                  dateFrom={from}
                  dateTo={to}
                  openingBalance={Number(stmt.opening || 0)}
                  closingBalance={Number(stmt.closing || 0)}
                  rows={(stmt.entries ?? []).map((e: any) => ({ date: e.date?.slice(0, 10), voucherNo: e.voucher_no, type: e.entry_type, description: e.notes ?? "", debit: Number(e.debit || 0), credit: Number(e.credit || 0), balance: Number(e.running_balance || 0) }))}
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[640px]">
                  <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                    <th className={thCls}>Date</th><th className={thCls}>Voucher</th><th className={thCls}>Type</th>
                    <th className={`${thCls} text-right`}>Debit</th><th className={`${thCls} text-right`}>Credit</th><th className={`${thCls} text-right`}>Balance</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {partyWin.window.map((e: any) => (
                      <tr key={e.id}>
                        <td className="py-2">{e.date?.slice(0, 10)}</td>
                        <td className="py-2 font-mono">{e.voucher_no}</td>
                        <td className="py-2">{e.entry_type}</td>
                        <td className="py-2 text-right">{formatCurrency(Number(e.debit || 0))}</td>
                        <td className="py-2 text-right">{formatCurrency(Number(e.credit || 0))}</td>
                        <td className="py-2 text-right font-bold">{formatCurrency(Number(e.running_balance || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {partyEntries.length > WINDOW_SIZE && (<WindowPager page={partyWin.clamped} totalPages={partyWin.totalPages} from={(partyWin.clamped - 1) * WINDOW_SIZE + 1} to={(partyWin.clamped - 1) * WINDOW_SIZE + partyWin.window.length} total={partyEntries.length} onPage={setPartyPage} />)}
            </div>
          )}
        </div>
      )}

      {activeTab === "cash" && (
        <div className="space-y-6">
          <div className="expensive-card p-5">
            <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
              <label className="font-medium text-foreground" htmlFor="cash-account">Account</label>
              <select id="cash-account" value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)} className={inputCls}>
                <option value="">All accounts</option>
                {cashAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name} ({a.account_kind})</option>))}
              </select>
              {daybook && (
                <span className="flex gap-2 ml-auto">
                  {(["csv", "xlsx", "pdf"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() =>
                        void exportRows(
                          f,
                          (daybook.entries ?? []).map((r: any) => ({
                            date: r.date?.slice(0, 10),
                            voucher_no: r.voucher_no,
                            type: r.voucher_type,
                            account: r.account_label ?? r.account,
                            description: r.description,
                            debit: r.debit,
                            credit: r.credit,
                            balance: r.running_balance,
                          })),
                          "daybook",
                          [
                            { key: "date", label: "Date" },
                            { key: "voucher_no", label: "Voucher" },
                            { key: "type", label: "Type" },
                            { key: "account", label: "Account" },
                            { key: "description", label: "Description" },
                            { key: "debit", label: "Cash in (Debit)" },
                            { key: "credit", label: "Cash out (Credit)" },
                            { key: "balance", label: "Balance" },
                          ],
                          { title: "Daybook", dateRange: `${from} to ${to}`, totals: { debit: daybook.receipts, credit: daybook.payments } },
                          "ledgers_cash",
                        )
                      }
                      className={ghostBtnCls}
                    >
                      <Download size={12} className="inline mr-1" />
                      {f.toUpperCase()}
                    </button>
                  ))}
                  <PrintButton label="Print daybook" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
                </span>
              )}
            </div>
            {cashBusy ? (
              <p className="text-xs text-muted-foreground py-4">Loading…</p>
            ) : !daybook ? (
              <EmptyState title="No daybook data for this range" hint="Pick a date range and an account, then Apply." />
            ) : (
              <div>
                <p className="text-xs text-muted-foreground mb-4">
                  Opening: {formatCurrency(Number(daybook.opening || 0))} · Cash in: {formatCurrency(Number(daybook.receipts || 0))} · Cash out: {formatCurrency(Number(daybook.payments || 0))} · Closing: {formatCurrency(Number(daybook.closing || 0))}
                </p>
                <h3 className="text-xs font-bold text-foreground mb-2">Balances by account</h3>
                <div className="overflow-x-auto mb-5">
                  <table className="w-full text-left text-xs min-w-[560px]">
                    <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                      <th className={thCls}>Code</th><th className={thCls}>Account</th><th className={thCls}>Kind</th>
                      <th className={`${thCls} text-right`}>Opening</th><th className={`${thCls} text-right`}>Closing</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                      {(daybook.balances ?? []).length === 0 && (
                        <tr><td colSpan={5} className="py-4 text-muted-foreground">No account balances in this range.</td></tr>
                      )}
                      {(daybook.balances ?? []).map((b: any, i: number) => (
                        <tr key={b.cashAccountId ?? `kind:${b.accountKind}:${i}`}>
                          <td className="py-2 font-mono font-bold">{b.code}</td>
                          <td className="py-2">{b.name}</td>
                          <td className="py-2 uppercase text-muted-foreground">{b.accountKind}</td>
                          <td className="py-2 text-right">{formatCurrency(Number(b.opening || 0))}</td>
                          <td className="py-2 text-right font-bold">{formatCurrency(Number(b.closing || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="hidden print:block">
                  <DaybookPrint
                    accountName={daybook.account ?? "All accounts"}
                    dateFrom={from}
                    dateTo={to}
                    openingBalance={daybook.opening}
                    closingBalance={daybook.closing}
                    rows={(daybook.entries ?? []).map((r: any) => ({ date: r.date, voucherNo: r.voucher_no, voucherType: r.voucher_type, description: r.description, receipt: r.debit, payment: r.credit, balance: r.running_balance }))}
                  />
                </div>
                <h3 className="text-xs font-bold text-foreground mb-2">Entries</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[640px]">
                    <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                      <th className={thCls}>Date</th><th className={thCls}>Voucher</th><th className={thCls}>Type</th>
                      <th className={thCls}>Account</th><th className={thCls}>Description</th>
                      <th className={`${thCls} text-right`}>In</th><th className={`${thCls} text-right`}>Out</th><th className={`${thCls} text-right`}>Balance</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                      {(daybook.entries ?? []).length === 0 && (
                        <tr><td colSpan={8} className="py-4 text-muted-foreground">No cash entries in this range.</td></tr>
                      )}
                      {cashWin.window.map((r: any) => (
                        <tr key={r.id}>
                          <td className="py-2">{r.date?.slice(0, 10)}</td>
                          <td className="py-2 font-mono font-bold">{r.voucher_no}</td>
                          <td className="py-2">{r.voucher_type}</td>
                          <td className="py-2">{r.account_label ?? r.account}</td>
                          <td className="py-2">{r.description || "—"}</td>
                          <td className="py-2 text-right">{formatCurrency(Number(r.debit || 0))}</td>
                          <td className="py-2 text-right">{formatCurrency(Number(r.credit || 0))}</td>
                          <td className="py-2 text-right font-bold">{formatCurrency(Number(r.running_balance || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {cashEntries.length > WINDOW_SIZE && (<WindowPager page={cashWin.clamped} totalPages={cashWin.totalPages} from={(cashWin.clamped - 1) * WINDOW_SIZE + 1} to={(cashWin.clamped - 1) * WINDOW_SIZE + cashWin.window.length} total={cashEntries.length} onPage={setCashPage} />)}
                <p className="text-xs text-muted-foreground mt-3">
                  The balance column is per account, not one merged chain. Transfers are included in the entries.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "bardana" && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
            <select aria-label="Packaging filter" value={baPackaging} onChange={(e) => setBaPackaging(e.target.value)} className={inputCls}>
              <option value="">All bag types</option>
              {packaging.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
            <select aria-label="Godown filter" value={baGodown} onChange={(e) => setBaGodown(e.target.value)} className={inputCls}>
              <option value="">All godowns</option>
              {godowns.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
            </select>
            {bardana && (
              <span className="flex gap-2 ml-auto">
                {(["csv", "xlsx", "pdf"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() =>
                      void exportRows(
                        f,
                        (bardana.entries ?? []).map((r: any) => ({
                          date: r.date?.slice(0, 10),
                          voucher_no: r.voucher_no,
                          type: r.voucher_type,
                          packaging: packagingName(r.packaging_type_id),
                          godown: r.godown_id ? godownName(r.godown_id) : "",
                          in_qty: r.in_qty,
                          out_qty: r.out_qty,
                          balance: r.running_balance,
                        })),
                        "bardana_ledger",
                        [
                          { key: "date", label: "Date" },
                          { key: "voucher_no", label: "Voucher" },
                          { key: "type", label: "Type" },
                          { key: "packaging", label: "Bag type" },
                          { key: "godown", label: "Godown" },
                          { key: "in_qty", label: "In" },
                          { key: "out_qty", label: "Out" },
                          { key: "balance", label: "Balance" },
                        ],
                        { title: "Bardana Ledger", dateRange: `${from} to ${to}` },
                        "ledgers_bardana",
                      )
                    }
                    className={ghostBtnCls}
                  >
                    <Download size={12} className="inline mr-1" />
                    {f.toUpperCase()}
                  </button>
                ))}
              </span>
            )}
          </div>
          {bardanaBusy ? (
            <p className="text-xs text-muted-foreground py-4">Loading…</p>
          ) : !bardana ? (
            <EmptyState title="No bardana rows for these filters" hint="Widen the date range or clear a filter." />
          ) : (
            <div>
              <p className="text-xs text-muted-foreground mb-4">
                Opening: {Number(bardana.opening || 0).toLocaleString()} · Purchased: {Number(bardana.purchased || 0).toLocaleString()} · Consumed: {Number(bardana.consumed || 0).toLocaleString()} · Returned: {Number(bardana.returned || 0).toLocaleString()} · Damaged: {Number(bardana.damaged || 0).toLocaleString()} · Closing: {Number(bardana.closing || 0).toLocaleString()}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[640px]">
                  <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                    <th className={thCls}>Date</th><th className={thCls}>Voucher</th><th className={thCls}>Type</th>
                    <th className={thCls}>Bag type</th><th className={thCls}>Godown</th>
                    <th className={`${thCls} text-right`}>In</th><th className={`${thCls} text-right`}>Out</th><th className={`${thCls} text-right`}>Balance</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {(bardana.entries ?? []).length === 0 && (
                      <tr><td colSpan={8} className="py-4 text-muted-foreground">No bardana entries in this range.</td></tr>
                    )}
                    {bardanaWin.window.map((r: any) => (
                      <tr key={r.id}>
                        <td className="py-2">{r.date?.slice(0, 10)}</td>
                        <td className="py-2 font-mono font-bold">{r.voucher_no}</td>
                        <td className="py-2">{r.voucher_type}</td>
                        <td className="py-2">{packagingName(r.packaging_type_id)}</td>
                        <td className="py-2">{r.godown_id ? godownName(r.godown_id) : "—"}</td>
                        <td className="py-2 text-right">{Number(r.in_qty || 0).toLocaleString()}</td>
                        <td className="py-2 text-right">{Number(r.out_qty || 0).toLocaleString()}</td>
                        <td className="py-2 text-right font-bold">{Number(r.running_balance || 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {bardanaEntries.length > WINDOW_SIZE && (<WindowPager page={bardanaWin.clamped} totalPages={bardanaWin.totalPages} from={(bardanaWin.clamped - 1) * WINDOW_SIZE + 1} to={(bardanaWin.clamped - 1) * WINDOW_SIZE + bardanaWin.window.length} total={bardanaEntries.length} onPage={setBardanaPage} />)}
            </div>
          )}
        </div>
      )}

      {activeTab === "cost" && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
            <select aria-label="Cost type filter" value={costType} onChange={(e) => setCostType(e.target.value)} className={inputCls}>
              <option value="">All cost types</option>
              {costTypes.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
            <span className="flex gap-2 ml-auto">
              {(["csv", "xlsx", "pdf"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() =>
                    void exportRows(
                      f,
                      shownCostRows.map((r: any) => ({
                        recorded_at: r.recorded_at?.slice(0, 10),
                        cost_type: r.cost_type,
                        batch_id: r.batch_id ?? "",
                        job_id: r.job_id ?? "",
                        qty_kg: r.qty_kg,
                        amount: r.amount,
                        basis: r.basis ?? "",
                      })),
                      "production_cost_ledger",
                      [
                        { key: "recorded_at", label: "Date" },
                        { key: "cost_type", label: "Cost type" },
                        { key: "batch_id", label: "Batch" },
                        { key: "job_id", label: "Job" },
                        { key: "qty_kg", label: "Qty (kg)" },
                        { key: "amount", label: "Amount" },
                        { key: "basis", label: "Basis" },
                      ],
                      { title: "Production Cost Ledger", dateRange: `${from} to ${to}`, totals: { amount: shownCostTotal } },
                      "ledgers_cost",
                    )
                  }
                  className={ghostBtnCls}
                >
                  <Download size={12} className="inline mr-1" />
                  {f.toUpperCase()}
                </button>
              ))}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Read-only view of the production cost ledger. Rows appear only when
            the cost ledger is turned on in Settings — an empty table means
            nothing has been posted yet, not an error. Nothing on this tab
            writes, edits or deletes a cost row.
          </p>
          {costBusy ? (
            <p className="text-xs text-muted-foreground py-4">Loading…</p>
          ) : shownCostRows.length === 0 ? (
            <EmptyState title="No cost ledger rows in this range" hint="Turn the cost ledger on in Settings and post a batch or job, or widen the date range." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className={thCls}>Date</th><th className={thCls}>Cost type</th><th className={thCls}>Batch</th>
                  <th className={thCls}>Job</th><th className={`${thCls} text-right`}>Qty (kg)</th>
                  <th className={`${thCls} text-right`}>Amount</th><th className={thCls}>Basis</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {costWin.window.map((r: any) => (
                    <tr key={r.id}>
                      <td className="py-2">{r.recorded_at?.slice(0, 10)}</td>
                      <td className="py-2 font-bold">{r.cost_type}</td>
                      <td className="py-2 font-mono">{r.batch_id ? String(r.batch_id).slice(0, 8) : "—"}</td>
                      <td className="py-2 font-mono">{r.job_id ? String(r.job_id).slice(0, 8) : "—"}</td>
                      <td className="py-2 text-right">{r.qty_kg === null || r.qty_kg === undefined ? "—" : formatWeight(Number(r.qty_kg || 0))}</td>
                      <td className="py-2 text-right font-bold">{r.amount === null || r.amount === undefined ? "—" : formatCurrency(Number(r.amount || 0))}</td>
                      <td className="py-2">{r.basis ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shownCostRows.length > WINDOW_SIZE && (<WindowPager page={costWin.clamped} totalPages={costWin.totalPages} from={(costWin.clamped - 1) * WINDOW_SIZE + 1} to={(costWin.clamped - 1) * WINDOW_SIZE + costWin.window.length} total={shownCostRows.length} onPage={setCostPage} />)}
              <p className="text-xs text-muted-foreground mt-3">
                Total amount shown: {formatCurrency(shownCostTotal)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
