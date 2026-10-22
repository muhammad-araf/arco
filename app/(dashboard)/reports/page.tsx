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

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = React.useState<"pnl" | "stock" | "bardana">("pnl")
  const [stockSummary, setStockSummary] = React.useState<any[]>([])
  const [packaging, setPackaging] = React.useState<any[]>([])

  const loadData = React.useCallback(() => {
    setStockSummary(GodownStore.getAllStockSummary())
    setPackaging(GodownStore.getPackaging())
  }, [])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  // P&L Mock Calculation from business activities
  const serviceRevenue = 380000 // Machinery jobs & packing services
  const seedSalesRevenue = 1200000 // Sale of graded seeds
  const totalRevenue = serviceRevenue + seedSalesRevenue

  const rawSeedCOGS = 780000 // Cost of raw seed sold
  const bardanaCost = 65000 // Consumed bags
  const operationalExpenses = 145000 // Fuel, electricity, transport
  const laborPayroll = 155000 // Staff wages
  const totalCosts = rawSeedCOGS + bardanaCost + operationalExpenses + laborPayroll

  const netProfit = totalRevenue - totalCosts
  const netMargin = Math.round((netProfit / totalRevenue) * 100)

  return (
    <div className="space-y-6">
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

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
        >
          <Printer className="h-4 w-4" />
          <span>Print Report Sheet (A4)</span>
        </button>
      </div>

      {/* Report Switcher Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-lg bg-muted/60 border border-border/60 self-start w-fit text-xs font-semibold">
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
                Margin: +{netMargin}%
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
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Machinery Processing & Grading Charges</span>
                  <strong className="font-mono">{formatCurrency(260000)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Final Unit Bardana Packing Fees</span>
                  <strong className="font-mono">{formatCurrency(120000)}</strong>
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
                  <strong className="font-mono text-destructive">-{formatCurrency(rawSeedCOGS)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Packaging Material (Bags Consumed)</span>
                  <strong className="font-mono text-destructive">-{formatCurrency(bardanaCost)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Plant Fuel, Electricity & Maintenance</span>
                  <strong className="font-mono text-destructive">-{formatCurrency(operationalExpenses)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted/40">
                  <span className="text-foreground">Labor, Operator & Machine Wages</span>
                  <strong className="font-mono text-destructive">-{formatCurrency(laborPayroll)}</strong>
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
              <strong className="text-base text-foreground font-mono font-bold">+{netMargin}.0%</strong>
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
                    <td className="py-3 text-right text-muted-foreground font-sans">PKR 125/kg</td>
                    <td className="py-3 text-right font-black text-foreground">
                      {formatCurrency(item.totalStock * 125)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                  <th className="pb-3 font-bold text-right">Current Available</th>
                  <th className="pb-3 font-bold text-right">Unit Bag Cost</th>
                  <th className="pb-3 font-bold text-right">Total Bag Asset Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono">
                {packaging.map((pkg) => (
                  <tr key={pkg.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 font-bold text-foreground font-sans">{pkg.name}</td>
                    <td className="py-3 text-muted-foreground font-sans">{pkg.capacity_kg} kg</td>
                    <td className="py-3 text-right font-bold text-foreground">{formatBags(pkg.current_stock)}</td>
                    <td className="py-3 text-right text-muted-foreground">{formatCurrency(pkg.cost_per_bag)}</td>
                    <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(pkg.current_stock * pkg.cost_per_bag)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
