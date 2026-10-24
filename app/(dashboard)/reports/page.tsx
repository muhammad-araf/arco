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
import { GodownStore } from "@/lib/services/godown-store"
import { formatCurrency, formatWeight, formatBags } from "@/lib/utils"
import { exportToCSV } from "@/lib/export-utils"
import {
  AlertBanner,
  EmptyState,
  PageSkeleton,
} from "@/components/erp-ui"

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = React.useState<"pnl" | "stock" | "bardana">("pnl")
  const [stockSummary, setStockSummary] = React.useState<any[]>([])
  const [packaging, setPackaging] = React.useState<any[]>([])
  const [jobs, setJobs] = React.useState<any[]>([])
  const [packingRecords, setPackingRecords] = React.useState<any[]>([])
  const [expenses, setExpenses] = React.useState<any[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")

  const loadData = React.useCallback(() => {
    const state = (GodownStore as any).getState()
    setStockSummary(GodownStore.getAllStockSummary())
    setPackaging(GodownStore.getPackaging())
    setJobs(state.machineryJobs || [])
    setPackingRecords(state.packingRecords || [])
    setExpenses(GodownStore.getExpenses())
  }, [])

  React.useEffect(() => {
    loadData()
    setIsLoading(false)
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

  const inPeriod = (iso: string) => {
    if (dateFrom && iso.slice(0, 10) < dateFrom) return false
    if (dateTo && iso.slice(0, 10) > dateTo) return false
    return true
  }
  const periodLabel = dateFrom || dateTo
    ? `${dateFrom || "…"} to ${dateTo || "…"}`
    : "All posted records to date"

  // Provisional P&L derived ONLY from posted prototype ledgers (spec §15:
  // no unverified spreadsheet formula is treated as accounting truth).
  // Product-sale revenue and COGS are 0 here because this prototype has
  // no product-sale invoices and no approved valuation method — both need
  // client/accountant approval before they appear in a P&L.
  const machineryRevenue = jobs.filter((j) => j.status === "posted" && inPeriod(j.date)).reduce((a, j) => a + (j.service_charge || 0), 0)
  const packingRevenue = packingRecords.filter((r) => r.status === "posted" && inPeriod(r.date)).reduce((a, r) => a + (r.packing_charge || 0), 0)
  const seedSalesRevenue = 0
  const totalRevenue = machineryRevenue + packingRevenue + seedSalesRevenue
  const operationalExpenses = expenses.filter((e) => e.status === "posted" && inPeriod(e.date)).reduce((a, e) => a + (e.amount || 0), 0)
  const bardanaCost = packingRecords.filter((r) => r.status === "posted" && inPeriod(r.date)).reduce((a, r) => {
    const pkg = packaging.find((p) => p.id === r.packaging_type_id)
    return a + (r.bags_packed + (r.damaged_bags || 0)) * (pkg?.cost_per_bag || 0)
  }, 0)
  const laborPayroll = 0 // No finalized payroll periods exist yet
  const totalCosts = operationalExpenses + bardanaCost + laborPayroll
  const netProfit = totalRevenue - totalCosts
  const netMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0

  const stockTotals = stockSummary.reduce((acc, item) => ({ kg: acc.kg + item.totalStock, bags: acc.bags + item.bagsCount }), { kg: 0, bags: 0 })
  const bardanaRows = packaging.map((pkg) => {
    const recs = packingRecords.filter((r) => r.packaging_type_id === pkg.id && inPeriod(r.date))
    return {
      ...pkg,
      consumed: recs.reduce((a, r) => a + r.bags_packed, 0),
      damaged: recs.reduce((a, r) => a + (r.damaged_bags || 0), 0),
    }
  })

  if (isLoading) return <PageSkeleton />

  return (
    <div className="space-y-6">
      <AlertBanner tone="warning" message="Provisional report from posted prototype ledgers only (spec §15). Product-sale revenue and cost of goods sold are excluded until the client/accountant approves the costing and valuation method — do not treat this P&L as audited accounts." />
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
              if (selectedReport === "stock") exportToCSV(stockSummary.map((p) => ({ code: p.code, name: p.name, category: p.category, stock_kg: p.totalStock, bags: p.bagsCount, min_stock: p.min_stock || 0 })), "stock_summary_report")
              else if (selectedReport === "bardana") exportToCSV(bardanaRows.map((p) => ({ bag_type: p.name, capacity_kg: p.capacity_kg, consumed: p.consumed, damaged: p.damaged, closing: p.current_stock, unit_cost: p.cost_per_bag })), "bardana_ledger_report")
              else exportToCSV([{ period: periodLabel, machinery_revenue: machineryRevenue, packing_revenue: packingRevenue, operating_expenses: operationalExpenses, bardana_cost: bardanaCost, net_profit: netProfit }], "provisional_pnl_report")
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
      <div className="flex flex-wrap items-center gap-2 p-1 rounded-lg bg-muted/60 border border-border/60 self-start max-w-full text-xs font-semibold">
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
              <h3 className="font-bold text-foreground uppercase tracking-wider text-[11px] pb-1 border-b border-border/60 flex items-center justify-between">
                <span>Operational Revenues</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(totalRevenue)}</span>
              </h3>

              <div className="space-y-2">
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Certified Seed Product Sales</span>
                  <strong className="font-mono">{formatCurrency(seedSalesRevenue)}</strong>
                </div>
                <p className="text-[11px] text-muted-foreground px-1">No product-sale invoices exist in this prototype, so sales revenue is 0 — it is not estimated.</p>
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Machinery Processing & Grading Charges</span>
                  <strong className="font-mono">{formatCurrency(machineryRevenue)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Final Unit Bardana Packing Fees</span>
                  <strong className="font-mono">{formatCurrency(packingRevenue)}</strong>
                </div>
              </div>
            </div>

            {/* Expenses Column */}
            <div className="space-y-3">
              <h3 className="font-bold text-foreground uppercase tracking-wider text-[11px] pb-1 border-b border-border/60 flex items-center justify-between">
                <span>Recognized Costs & Overheads</span>
                <span className="text-destructive font-mono">{formatCurrency(totalCosts)}</span>
              </h3>

              <div className="space-y-2">
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Cost of Goods Sold (Raw Seeds)</span>
                  <strong className="font-mono text-destructive">— not yet approved</strong>
                </div>
                <p className="text-[11px] text-muted-foreground px-1">COGS needs an approved inventory valuation method (spec §15.1) and is excluded rather than estimated.</p>
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Packaging Material (Bags Consumed)</span>
                  <strong className="font-mono text-destructive">-{formatCurrency(bardanaCost)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Posted Operating Expenses</span>
                  <strong className="font-mono text-destructive">-{formatCurrency(operationalExpenses)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Labor, Operator & Machine Wages</span>
                  <strong className="font-mono text-destructive">{laborPayroll === 0 ? "— no finalized periods" : `-${formatCurrency(laborPayroll)}`}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Net Profit Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/15 via-teal-500/15 to-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
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
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Product</th>
                  <th className="pb-3 font-bold">Category</th>
                  <th className="pb-3 font-bold text-right">Physical Stock</th>
                  <th className="pb-3 font-bold text-right">Bags</th>
                  <th className="pb-3 font-bold text-right">Valuation Rate</th>
                  <th className="pb-3 font-bold text-right">Inventory Valuation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono">
                {stockSummary.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
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
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Bardana / Bag Type</th>
                  <th className="pb-3 font-bold">Capacity</th>
                  <th className="pb-3 font-bold text-right">Consumed</th>
                  <th className="pb-3 font-bold text-right">Damaged</th>
                  <th className="pb-3 font-bold text-right">Current Available</th>
                  <th className="pb-3 font-bold text-right">Unit Bag Cost</th>
                  <th className="pb-3 font-bold text-right">Total Bag Asset Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono">
                {bardanaRows.map((pkg) => (
                  <tr key={pkg.id} className="hover:bg-muted/30 transition-colors">
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
                )}}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
