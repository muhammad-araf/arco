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
import { getPL, getBardanaLedger, getPartyStatement, getVendorStatement } from "@/app/actions/finance"
import { getStockSummary, getStockLedger } from "@/app/actions/inventory"
import { listPackagingTypes, listParties, listProducts } from "@/app/actions/masters"
import { formatCurrency, formatWeight, formatBags } from "@/lib/utils"
import { exportReportToCsv } from "@/lib/export-utils"
import {
  AlertBanner,
  EmptyState,
  PageSkeleton,
} from "@/components/erp-ui"

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = React.useState<"pnl" | "stock" | "ledger" | "bardana" | "party" | "vendor">("pnl")
  const [reportError, setReportError] = React.useState("")
  const [pl, setPl] = React.useState<any | null>(null)
  const [ledgerRows, setLedgerRows] = React.useState<any[]>([])
  const [bardanaTotals, setBardanaTotals] = React.useState<any | null>(null)
  const [parties, setParties] = React.useState<any[]>([])
  const [stmtPartyId, setStmtPartyId] = React.useState("")
  const [stmt, setStmt] = React.useState<any | null>(null)
  const [stmtError, setStmtError] = React.useState("")
  const [stockSummary, setStockSummary] = React.useState<any[]>([])
  const [packaging, setPackaging] = React.useState<any[]>([])
  const [jobs, setJobs] = React.useState<any[]>([])
  const [packingRecords, setPackingRecords] = React.useState<any[]>([])
  const [expenses, setExpenses] = React.useState<any[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")

  const effFrom = dateFrom || new Date().toISOString().slice(0, 8) + "01"
  const effTo = dateTo || new Date().toISOString().slice(0, 10)
  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    setReportError("")
    const [plRes, sm, le, ba, pk, pa, pr] = await Promise.all([
      getPL({ from: effFrom, to: effTo }),
      getStockSummary(), getStockLedger({ from: effFrom, to: effTo }),
      getBardanaLedger({ from: effFrom, to: effTo }),
      listPackagingTypes(), listParties(), listProducts(),
    ])
    const failed = [plRes, sm, le, ba, pk, pa, pr].find((x) => !x.success)
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
    setLedgerRows(Array.isArray(le.data) ? le.data : [])
    setBardanaTotals(ba.success ? ba.data : null)
    setPackaging(Array.isArray(pk.data) ? pk.data : [])
    setParties(Array.isArray(pa.data) ? pa.data : [])
    setJobs([])
    setPackingRecords([])
    setExpenses([])
    setIsLoading(false)
  }, [effFrom, effTo])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  React.useEffect(() => {
    if (!stmtPartyId) { setStmt(null); return }
    const fn = selectedReport === "vendor" ? getVendorStatement : getPartyStatement
    fn({ partyId: stmtPartyId, from: effFrom, to: effTo }).then((res) => {
      if (!res.success) setStmtError(res.error ?? "Could not load the statement.")
      else { setStmtError(""); setStmt(res.data) }
    })
  }, [stmtPartyId, selectedReport, effFrom, effTo])

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

  const stockTotals = stockSummary.reduce((acc, item) => ({ kg: acc.kg + item.totalStock, bags: acc.bags + item.bagsCount }), { kg: 0, bags: 0 })
  const bardanaEntries: any[] = bardanaTotals?.entries ?? []
  const bardanaRows = packaging.map((pkg) => {
    const recs = bardanaEntries.filter((r) => r.packaging_type_id === pkg.id)
    const consumed = recs.filter((r) => r.voucher_type !== "purchase" && r.voucher_type !== "purchase_return").reduce((a, r) => a + (Number(r.out_qty) || 0), 0)
    const purchased = recs.filter((r) => r.voucher_type === "purchase").reduce((a, r) => a + (Number(r.in_qty) || 0), 0)
    const last = recs[recs.length - 1]
    return {
      ...pkg,
      consumed, purchased,
      damaged: 0, // damaged bags are tracked on packing records, not the bardana ledger
      current_stock: last ? Number(last.running_balance) || 0 : Number(pkg.current_stock || 0),
    }
  })

  if (isLoading) return <PageSkeleton />

  return (
    <div className="space-y-6">
      <AlertBanner tone="warning" message="P&L from getPL (spec §15): posted invoices only; receipts are never revenue. Anything the backend excludes or cannot value is shown below exactly as the backend reports it — do not treat this P&L as audited accounts." />
      {reportError && <AlertBanner tone="error" message={/not configured|Authentication required/i.test(reportError) ? "Supabase is not configured / sign in required: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then sign in. No local demo data is shown." : reportError} onDismiss={() => setReportError("")} />}
      {plWarnings.map((w, i) => (<AlertBanner key={i} tone="warning" message={w} />))}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-emerald-500" />
            Executive Reports & Profit & Loss Statement
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Audit-grade reporting engine for stock movements, packaging materials, and commercial P&L analysis.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            From
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-2 py-1.5 rounded-lg bg-background border border-border text-foreground font-mono" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            To
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-2 py-1.5 rounded-lg bg-background border border-border text-foreground font-mono" />
          </label>
          <button
            type="button"
            onClick={() => {
              const range = `${effFrom} to ${effTo}`
              if (selectedReport === "stock") exportReportToCsv(stockSummary.map((p) => ({ code: p.code, name: p.name, category: p.category, stock_kg: p.totalStock, bags: p.bagsCount, min_stock: p.min_stock || 0 })), "stock_summary_report", [{ key: "code", label: "Code" }, { key: "name", label: "Product" }, { key: "category", label: "Category" }, { key: "stock_kg", label: "Stock (kg)" }, { key: "bags", label: "Bags" }, { key: "min_stock", label: "Min stock" }], { title: "Stock Summary", dateRange: range, totals: { stock_kg: stockTotals.kg, bags: stockTotals.bags } })
              else if (selectedReport === "bardana") exportReportToCsv(bardanaRows.map((p) => ({ bag_type: p.name, capacity_kg: p.capacity_kg, consumed: p.consumed, purchased: p.purchased, closing: p.current_stock, unit_cost: p.cost_per_bag })), "bardana_ledger_report", [{ key: "bag_type", label: "Bag type" }, { key: "capacity_kg", label: "Capacity (kg)" }, { key: "consumed", label: "Consumed" }, { key: "purchased", label: "Purchased" }, { key: "closing", label: "Closing" }, { key: "unit_cost", label: "Unit cost" }], { title: "Bardana Ledger", dateRange: range, totals: { consumed: Number(bardanaTotals?.consumed || 0), purchased: Number(bardanaTotals?.purchased || 0) } })
              else if (selectedReport === "ledger") exportReportToCsv(ledgerRows.map((e: any) => ({ date: e.date, voucher_no: e.voucher_no, type: e.voucher_type, godown_id: e.godown_id, product_id: e.product_id, inward_kg: e.inward_qty, outward_kg: e.outward_qty, balance_kg: e.running_balance })), "stock_ledger_report", [{ key: "date", label: "Date" }, { key: "voucher_no", label: "Voucher" }, { key: "type", label: "Type" }, { key: "inward_kg", label: "Inward (kg)" }, { key: "outward_kg", label: "Outward (kg)" }, { key: "balance_kg", label: "Balance (kg)" }], { title: "Stock Ledger", dateRange: range })
              else if (selectedReport === "party" || selectedReport === "vendor") exportReportToCsv<Record<string, any>>((stmt?.entries ?? []).map((e: any) => ({ date: e.date, voucher_no: e.voucher_no, debit: e.debit, credit: e.credit, balance: e.running_balance })), `${selectedReport}_statement`, [{ key: "date", label: "Date" }, { key: "voucher_no", label: "Voucher" }, { key: "debit", label: "Debit" }, { key: "credit", label: "Credit" }, { key: "balance", label: "Balance" }], { title: `${selectedReport === "vendor" ? "Vendor" : "Party"} Statement`, dateRange: range, totals: { debit: Number(stmt?.charges || 0), credit: Number(stmt?.settlements || 0) } })
              else exportReportToCsv([{ period: periodLabel, service_revenue: machineryRevenue, product_sales: seedSalesRevenue, other_revenue: otherRevenue, operating_expenses: operationalExpenses, packaging_cost: bardanaCost, payroll_cost: laborPayroll, cogs: cogsAmount, net_profit: netProfit }], "pnl_report", [{ key: "period", label: "Period" }, { key: "service_revenue", label: "Service revenue" }, { key: "product_sales", label: "Product sales" }, { key: "other_revenue", label: "Other revenue" }, { key: "operating_expenses", label: "Operating expenses" }, { key: "packaging_cost", label: "Packaging cost" }, { key: "payroll_cost", label: "Payroll cost" }, { key: "cogs", label: "COGS" }, { key: "net_profit", label: "Net profit" }], { title: "Profit & Loss", dateRange: range })
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export CSV
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
        <button
          type="button"
          onClick={() => setSelectedReport("bardana")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            selectedReport === "bardana"
              ? "bg-primary text-primary-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Bardana & Packaging Ledger
        </button>
        <button type="button" onClick={() => setSelectedReport("ledger")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "ledger" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Stock Ledger</button>
        <button type="button" onClick={() => setSelectedReport("party")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "party" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Party Statement</button>
        <button type="button" onClick={() => setSelectedReport("vendor")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "vendor" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Vendor Statement</button>
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
                  <strong className="font-mono text-destructive">— not yet approved</strong>
                </div>
                <p className="text-[11px] text-muted-foreground px-1">COGS needs an approved inventory valuation method (spec §15.1) and is excluded rather than estimated.</p>
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

      {/* Stock Summary Tab */}
      {selectedReport === "stock" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
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
                      <EmptyState title="No products in stock summary" hint="Add products in Master Data and post inward vouchers to build stock." />
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

      {/* Bardana Packaging Ledger Tab */}
      {selectedReport === "bardana" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Bardana / Bag Type</th>
                  <th className="pb-3 font-bold">Capacity</th>
                  <th className="pb-3 font-bold text-right">Consumed</th>
                  <th className="pb-3 font-bold text-right">Damaged</th>
                  <th className="pb-3 font-bold text-right">Current Available</th>
                  <th className="pb-3 font-bold text-right">Unit Bag Cost</th>
                  <th className="pb-3 font-bold text-right">Total Bag Asset Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {bardanaRows.map((pkg) => (
                  <tr key={pkg.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-bold text-foreground font-sans">{pkg.name}</td>
                    <td className="py-3 text-muted-foreground font-sans">{pkg.capacity_kg} kg</td>
                    <td className="py-3 text-right font-mono">{pkg.consumed} bags</td>
                    <td className="py-3 text-right font-mono text-red-600 dark:text-red-400">{pkg.damaged} bags</td>
                    <td className="py-3 text-right font-bold text-foreground">{formatBags(pkg.current_stock)}</td>
                    <td className="py-3 text-right text-muted-foreground">{formatCurrency(pkg.cost_per_bag)}</td>
                    <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(pkg.current_stock * pkg.cost_per_bag)}
                    </td>
                  </tr>
                ))}
                {bardanaRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 font-sans">
                      <EmptyState title="No packaging types yet" hint="Add bag / bardana types in Master Data to see the ledger here." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selectedReport === "ledger" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Voucher</th><th className="pb-3">Type</th><th className="pb-3 text-right">Inward</th><th className="pb-3 text-right">Outward</th><th className="pb-3 text-right">Balance</th></tr></thead>
            <tbody className="divide-y divide-border">
              {ledgerRows.length === 0 && <tr><td colSpan={6} className="py-4 text-muted-foreground">No ledger rows in this period.</td></tr>}
              {ledgerRows.map((e: any) => (<tr key={e.id}><td className="py-2">{e.date?.slice(0, 10)}</td><td className="py-2 font-mono font-bold">{e.voucher_no}</td><td className="py-2">{e.voucher_type}</td><td className="py-2 text-right">{formatWeight(Number(e.inward_qty || 0))}</td><td className="py-2 text-right">{formatWeight(Number(e.outward_qty || 0))}</td><td className="py-2 text-right font-bold">{formatWeight(Number(e.running_balance || 0))}</td></tr>))}
            </tbody></table></div>
        </div>
      )}
      {(selectedReport === "party" || selectedReport === "vendor") && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
            <label className="font-medium text-foreground">{selectedReport === "vendor" ? "Vendor" : "Party"}</label>
            <select value={stmtPartyId} onChange={(e) => setStmtPartyId(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select a party</option>{parties.filter((x) => selectedReport === "vendor" ? (x.type === "supplier" || x.type === "both") : (x.type === "customer" || x.type === "both")).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select>
            {stmtError && <span className="text-red-600 dark:text-red-400 font-medium">{stmtError}</span>}
          </div>
          {!stmt && <EmptyState title="Select a party to view its statement" hint="Statements come from getPartyStatement / getVendorStatement: opening balance, charges, settlements and closing, with a receivable-positive sign convention." />}
          {stmt && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">Opening: {formatCurrency(Number(stmt.opening || 0))} · Charges: {formatCurrency(Number(stmt.charges || 0))} · Settlements: {formatCurrency(Number(stmt.settlements || 0))} · Closing: {formatCurrency(Number(stmt.closing || 0))} ({stmt.closingKind})</p>
              <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Voucher</th><th className="pb-3 text-right">Debit</th><th className="pb-3 text-right">Credit</th><th className="pb-3 text-right">Balance</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {(stmt.entries ?? []).map((e: any) => (<tr key={e.id}><td className="py-2">{e.date?.slice(0, 10)}</td><td className="py-2 font-mono">{e.voucher_no}</td><td className="py-2 text-right">{formatCurrency(Number(e.debit || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(e.credit || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(e.running_balance || 0))}</td></tr>))}
                </tbody></table></div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
