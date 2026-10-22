"use client"

import * as React from "react"
import Link from "next/link"
import {
  Truck,
  Boxes,
  ScrollText,
  FileCheck2,
  Wallet,
  TrendingUp,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  RefreshCw,
  Building2,
  Clock,
  CheckCircle2,
  Package,
} from "lucide-react"
import { GodownStore } from "@/lib/services/godown-store"
import { DashboardMetrics, StockLedgerEntry } from "@/lib/types/database"
import { formatCurrency, formatWeight, formatBags, formatDateTime } from "@/lib/utils"

export default function DashboardPage() {
  const [metrics, setMetrics] = React.useState<DashboardMetrics | null>(null)
  const [stockSummary, setStockSummary] = React.useState<any[]>([])
  const [godowns, setGodowns] = React.useState<any[]>([])

  const loadData = React.useCallback(() => {
    setMetrics(GodownStore.getDashboardMetrics())
    setStockSummary(GodownStore.getAllStockSummary())
    setGodowns(GodownStore.getGodowns())
  }, [])

  React.useEffect(() => {
    loadData()
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

  if (!metrics) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-6 w-6 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2.5">
            Operations Command Center
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-semibold">
              Live Godown Feed
            </span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Unified single-role operational overview for Seed Inward, Batch Processing, Gate Passes & Ledgers.
          </p>
        </div>

        {/* Quick Action Dock */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/inward"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Inward</span>
          </Link>
          <Link
            href="/gatepass"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card hover:bg-muted/60 text-foreground border border-border/80 text-xs font-semibold shadow-2xs transition-colors"
          >
            <FileCheck2 className="h-3.5 w-3.5 text-emerald-500" />
            <span>Issue Gate Pass</span>
          </Link>
          <Link
            href="/production"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card hover:bg-muted/60 text-foreground border border-border/80 text-xs font-semibold shadow-2xs transition-colors"
          >
            <ScrollText className="h-3.5 w-3.5 text-amber-500" />
            <span>Run Batch</span>
          </Link>
        </div>
      </div>

      {/* Primary KPI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Today's Inward */}
        <div className="expensive-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Today's Inward
            </span>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Truck className="h-4 w-4" />
            </div>
          </div>
          <div className="my-3">
            <div className="text-2xl font-black text-foreground">
              {formatWeight(metrics.todayInwardKg)}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1 font-medium">
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                {formatBags(metrics.todayInwardBags)}
              </span>
              <span>received today</span>
            </div>
          </div>
          <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Arrivals: 1 Truck</span>
            <Link href="/inward" className="text-primary hover:underline font-semibold flex items-center gap-0.5">
              <span>View Bilty</span>
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* Card 2: Today's Production */}
        <div className="expensive-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Processing Output
            </span>
            <div className="h-8 w-8 rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <Boxes className="h-4 w-4" />
            </div>
          </div>
          <div className="my-3">
            <div className="text-2xl font-black text-foreground">
              {formatWeight(metrics.todayProductionKg)}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1 font-medium">
              <span className="text-teal-600 dark:text-teal-400 font-bold">
                {metrics.todayYieldPct}% Efficiency
              </span>
              <span>Graded seed yield</span>
            </div>
          </div>
          <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>By-products: 550 kg</span>
            <Link href="/production" className="text-primary hover:underline font-semibold flex items-center gap-0.5">
              <span>Batches</span>
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* Card 3: Today's Outward & Gate Passes */}
        <div className="expensive-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Outward Dispatches
            </span>
            <div className="h-8 w-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <FileCheck2 className="h-4 w-4" />
            </div>
          </div>
          <div className="my-3">
            <div className="text-2xl font-black text-foreground">
              {formatWeight(metrics.todayOutgoingKg)}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1 font-medium">
              <span className="text-blue-600 dark:text-blue-400 font-semibold">
                {metrics.todayGatePasses} Gate Pass
              </span>
              <span>dispatched & verified</span>
            </div>
          </div>
          <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Vehicle: LES-4419</span>
            <Link href="/gatepass" className="text-primary hover:underline font-semibold flex items-center gap-0.5">
              <span>Gate Register</span>
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* Card 4: Liquid Cash & Daybook */}
        <div className="expensive-card p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Cash & Daybook
            </span>
            <div className="h-8 w-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div className="my-3">
            <div className="text-2xl font-black text-foreground">
              {formatCurrency(metrics.cashBalance)}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1 font-medium">
              <span>Bank Balance:</span>
              <span className="text-foreground font-semibold">
                {formatCurrency(metrics.bankBalance)}
              </span>
            </div>
          </div>
          <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="text-emerald-500 font-medium">Daybook Reconciled</span>
            <Link href="/daybook" className="text-primary hover:underline font-semibold flex items-center gap-0.5">
              <span>Daybook</span>
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Secondary Row: Godowns Overview & Quick Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Live Stock & Ledger Feed */}
        <div className="lg:col-span-2 space-y-6">
          {/* Live Grain & Seed Balances */}
          <div className="expensive-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Package className="h-4 w-4 text-emerald-500" />
                  Live Product Stock Summary
                </h2>
                <p className="text-xs text-muted-foreground">
                  Current physical balances calculated directly from the stock ledger.
                </p>
              </div>
              <Link
                href="/inventory"
                className="text-xs text-primary hover:underline font-semibold flex items-center gap-1"
              >
                Full Stock Ledger
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                    <th className="pb-2.5 font-bold">Product / Grade</th>
                    <th className="pb-2.5 font-bold">Category</th>
                    <th className="pb-2.5 font-bold text-right">Available Weight</th>
                    <th className="pb-2.5 font-bold text-right">Est. Bags</th>
                    <th className="pb-2.5 font-bold text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {stockSummary.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 font-medium text-foreground">
                        <div>{item.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{item.code}</div>
                      </td>
                      <td className="py-2.5 text-muted-foreground capitalize">
                        {item.category.replace("_", " ")}
                      </td>
                      <td className="py-2.5 text-right font-bold text-foreground">
                        {formatWeight(item.totalStock)}
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground font-mono">
                        {item.bagsCount} bags
                      </td>
                      <td className="py-2.5 text-center">
                        {item.isLowStock ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                            <AlertTriangle className="h-3 w-3" />
                            Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3" />
                            Normal
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Stock Movements Feed */}
          <div className="expensive-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4 text-emerald-500" />
                  Recent Stock Ledger Movements
                </h2>
                <p className="text-xs text-muted-foreground">
                  Immutable transaction trail showing inward, batch consumption, and dispatches.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {metrics.recentMovements.map((entry: StockLedgerEntry) => {
                const isInward = entry.inward_qty > 0
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-card/60 border border-border/50 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-8 w-8 rounded-lg flex items-center justify-center font-bold ${
                          isInward
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                        }`}
                      >
                        {isInward ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </div>
                      <div>
                        <div className="font-semibold text-foreground flex items-center gap-2">
                          <span>{entry.product_name || entry.voucher_no}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground uppercase font-mono">
                            {entry.voucher_type.replace("_", " ")}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {entry.godown_name} &bull; {entry.notes}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className={`font-black ${isInward ? "text-emerald-600 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400"}`}>
                        {isInward ? `+${formatWeight(entry.inward_qty)}` : `-${formatWeight(entry.outward_qty)}`}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        Bal: {formatWeight(entry.running_balance)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right Column (1 Col): Commercials, Receivables & Godown Capacities */}
        <div className="space-y-6">
          {/* Party Balances Card */}
          <div className="expensive-card p-5">
            <h2 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Commercial Ledgers
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Real-time receivables from clients and payables to seed growers.
            </p>

            <div className="space-y-3.5">
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <div className="text-xs text-muted-foreground font-medium">Customer Receivables</div>
                <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                  {formatCurrency(metrics.receivablesTotal)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Across 2 active wholesale parties
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <div className="text-xs text-muted-foreground font-medium">Vendor Payables</div>
                <div className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">
                  {formatCurrency(metrics.payablesTotal)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Raw seed grower purchase liabilities
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
              <Link href="/billing" className="text-primary hover:underline font-semibold">
                Customer Invoices
              </Link>
              <Link href="/purchases" className="text-primary hover:underline font-semibold">
                Vendor Bills
              </Link>
            </div>
          </div>

          {/* Godown Capacity Meter */}
          <div className="expensive-card p-5">
            <h2 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-500" />
              Godown Storage Utilization
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Physical storage footprint across active sheds.
            </p>

            <div className="space-y-4">
              {godowns.map((g) => {
                const totalInGodown = GodownStore.getStockLedger()
                  .filter((e) => e.godown_id === g.id)
                  .reduce((acc, curr) => acc + (curr.inward_qty - curr.outward_qty), 0)
                
                const capacityKg = (g.capacity_metric_tons || 1000) * 1000
                const percent = Math.min(100, Math.round((totalInGodown / capacityKg) * 100))

                return (
                  <div key={g.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground">{g.name}</span>
                      <span className="text-muted-foreground font-mono">{percent}% Occupied</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{formatWeight(totalInGodown)} stored</span>
                      <span>Cap: {g.capacity_metric_tons} MT</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
