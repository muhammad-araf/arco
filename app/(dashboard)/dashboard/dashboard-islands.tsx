"use client"

/**
 * Dashboard client islands (route-local, not shared).
 *
 * The dashboard page itself is a server component (page.tsx): it
 * fetches each section on the server and streams it behind Suspense
 * boundaries. Everything interactive stays here, in client islands
 * that receive their section's data as props:
 * - the browser-local "today" filter (TodayBadge pattern): the
 *   today string is still set in an effect from the browser clock,
 *   exactly as the old client page did, so the early-morning
 *   UTC-vs-local date behaviour is unchanged;
 * - dismissible error banners (local error state, cleared on tap).
 *
 * All card JSX, math, links and empty states are moved verbatim
 * from the old client page — only the data source changed (server
 * props instead of a client getDashboardData() call). No prefetching
 * is added anywhere here.
 */

import * as React from "react"
import Link from "next/link"
import {
  Truck, Boxes, FileCheck2, Wallet, TrendingUp, AlertTriangle, ArrowUpRight, ArrowDownRight,
  CheckCircle2, Package, Building2,
} from "lucide-react"
import { formatCurrency, formatWeight, formatBags } from "@/lib/utils"
import { AlertBanner } from "@/components/erp-ui"

type Row = Record<string, any>
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Same message mapping the old page applied to its error banner. */
function mapError(error: string) {
  return /not configured|Authentication required/i.test(error)
    ? "Supabase is not set up, or sign-in is required. See SETUP.md."
    : error
}

/** Dismissible error banner; renders nothing when there is no error. */
export function DismissibleError({ error }: { error: string }) {
  const [visible, setVisible] = React.useState(true)
  if (!error || !visible) return null
  return <AlertBanner tone="error" message={mapError(error)} onDismiss={() => setVisible(false)} />
}

export function TodayCards({
  inward, batches, passes, latestPassNo,
}: {
  inward: Row[]
  batches: Row[]
  passes: Row[]
  latestPassNo: string | null
}) {
  // "Today" is client state, set in an effect (TodayBadge pattern): reading
  // new Date() during render makes this route un-prerenderable under
  // cacheComponents (blocking-prerender-current-time). The section
  // skeleton covers first paint, so the value is set before content
  // is visible.
  const [todayStr, setTodayStr] = React.useState<string | null>(null)
  React.useEffect(() => { setTodayStr(new Date().toISOString().slice(0, 10)) }, [])
  const isToday = (d: string) => todayStr !== null && String(d ?? "").slice(0, 10) === todayStr

  const postedToday = (rows: Row[]) => rows.filter((r) => r.status === "posted" && isToday(r.date))
  const todayInward = postedToday(inward)
  const todayBatches = postedToday(batches)
  const todayPasses = postedToday(passes)
  const todayInwardKg = todayInward.reduce((a, r) => a + num(r.total_net_weight_kg), 0)
  const todayInwardBags = todayInward.reduce((a, r) => a + num(r.total_bags), 0)
  const todayOutputKg = todayBatches.reduce((a, r) => a + num(r.actual_output_kg), 0)
  const yieldAvg = todayBatches.length ? todayBatches.reduce((a, r) => a + num(r.yield_pct), 0) / todayBatches.length : 0
  const byproductToday = todayBatches.reduce((a, r) => a + num(r.byproduct_kg), 0)
  const wastageToday = todayBatches.reduce((a, r) => a + num(r.waste_kg), 0)
  const todayOutKg = todayPasses.reduce((a, r) => a + num(r.total_weight_kg), 0)

  return (
    <>
      <div className="expensive-card p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Today&apos;s Inward</span><div className="h-8 w-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><Truck className="h-4 w-4" /></div></div>
        <div className="my-3"><div className="text-2xl font-black text-foreground">{formatWeight(todayInwardKg)}</div><div className="text-xs text-muted-foreground mt-1 font-medium"><span className="text-emerald-600 dark:text-emerald-400 font-semibold">{formatBags(todayInwardBags)}</span> received today</div></div>
        <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground"><span>Arrivals today: {todayInward.length} voucher{todayInward.length === 1 ? "" : "s"}</span><Link href="/inward?filter=today" className="text-primary hover:underline font-semibold flex items-center gap-0.5">View <ArrowUpRight className="h-3 w-3" /></Link></div>
      </div>
      <div className="expensive-card p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Processing Output</span><div className="h-8 w-8 rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center"><Boxes className="h-4 w-4" /></div></div>
        <div className="my-3"><div className="text-2xl font-black text-foreground">{formatWeight(todayOutputKg)}</div><div className="text-xs text-muted-foreground mt-1 font-medium"><span className="text-teal-600 dark:text-teal-400 font-bold">{yieldAvg.toFixed(1)}% Efficiency</span> Graded seed yield</div></div>
        <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground"><span>By-products: {formatWeight(byproductToday)} &bull; Wastage: {formatWeight(wastageToday)}</span><Link href="/production?filter=today" className="text-primary hover:underline font-semibold flex items-center gap-0.5">Batches <ArrowUpRight className="h-3 w-3" /></Link></div>
      </div>
      <div className="expensive-card p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dispatched</span><div className="h-8 w-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center"><FileCheck2 className="h-4 w-4" /></div></div>
        <div className="my-3"><div className="text-2xl font-black text-foreground">{formatWeight(todayOutKg)}</div><div className="text-xs text-muted-foreground mt-1 font-medium"><span className="text-blue-600 dark:text-blue-400 font-semibold">{todayPasses.length} gate pass{todayPasses.length === 1 ? "" : "es"}</span> today</div></div>
        <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground"><span>Latest pass: {latestPassNo ?? "—"}</span><Link href="/gatepass?filter=today" className="text-primary hover:underline font-semibold flex items-center gap-0.5">View <ArrowUpRight className="h-3 w-3" /></Link></div>
      </div>
    </>
  )
}

export function CashCard({
  cashOpening, cashPosition, cashByAccount, cashSource, error,
}: {
  cashOpening: number | null
  cashPosition: number | null
  cashByAccount: Row[]
  cashSource: string | null
  error: string
}) {
  return (
    <>
      <DismissibleError error={error} />
      <div className="expensive-card p-4 flex flex-col justify-between">
        <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cash</span><div className="h-8 w-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center"><Wallet className="h-4 w-4" /></div></div>
        <div className="my-3"><div className="text-2xl font-black text-foreground">{cashPosition !== null ? formatCurrency(cashPosition) : cashOpening === null ? "—" : formatCurrency(cashOpening)}</div><div className="text-xs text-muted-foreground mt-1 font-medium">{cashOpening === null && cashPosition === null ? "Restricted to Owner/Admin and Accountant" : cashSource === "daybook" ? "Live cash position (daybook)" : "Opening balances (daybook unavailable)"}</div>
          {cashByAccount.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {cashByAccount.map((a: Row) => (
                <div key={a.cashAccountId ?? a.code ?? a.name} className="flex items-center justify-between text-[11px] text-muted-foreground"><span>{a.code ? `${a.code} — ${a.name}` : a.name}</span><span className="font-mono font-semibold text-foreground">{formatCurrency(num(a.closing))}</span></div>
              ))}
            </div>
          )}
        </div>
        <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground"><span>See live balances on the Daybook page</span><Link href="/daybook?filter=today" className="text-primary hover:underline font-semibold flex items-center gap-0.5">Daybook <ArrowUpRight className="h-3 w-3" /></Link></div>
      </div>
    </>
  )
}

export function LowStockBanner({ lowCount }: { lowCount: number }) {
  if (lowCount <= 0) return null
  return (
    <Link href="/inventory?filter=low" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 transition-colors">
      <AlertTriangle className="h-4 w-4 shrink-0" /><span><strong>{lowCount} product{lowCount === 1 ? "" : "s"} at or below minimum stock.</strong></span><span className="ml-auto font-semibold flex items-center gap-0.5">View low stock <ArrowUpRight className="h-3.5 w-3.5" /></span>
    </Link>
  )
}

export function StockCard({ summary }: { summary: Row[] }) {
  const byProduct = new Map<string, { name: string; total: number; low: boolean }>()
  for (const r of summary) {
    const cur = byProduct.get(r.product_id) ?? { name: r.product_name, total: 0, low: false }
    cur.total += num(r.balance_kg)
    cur.low = cur.low || !!r.below_min_stock
    byProduct.set(r.product_id, cur)
  }
  const productRows = [...byProduct.values()]

  return (
    <div className="expensive-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div><h2 className="text-sm font-bold text-foreground flex items-center gap-2"><Package className="h-4 w-4 text-emerald-500" />Stock by Product</h2></div>
        <Link href="/inventory" className="text-xs text-primary hover:underline font-semibold flex items-center gap-1">Full ledger <ArrowUpRight className="h-3.5 w-3.5" /></Link>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[560px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2.5">Product / Grade</th><th className="pb-2.5 text-right">Available Weight</th><th className="pb-2.5 text-center">Status</th></tr></thead>
        <tbody className="divide-y divide-border">
          {productRows.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">No stock yet. Post an inward voucher.</td></tr>}
          {productRows.map((item) => (
            <tr key={item.name} className="hover:bg-muted transition-colors">
              <td className="py-2.5 font-medium text-foreground">{item.name}</td>
              <td className="py-2.5 text-right font-bold text-foreground">{formatWeight(item.total)}</td>
              <td className="py-2.5 text-center">{item.low ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20"><AlertTriangle className="h-3 w-3" />Low Stock</span> : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20"><CheckCircle2 className="h-3 w-3" />Normal</span>}</td>
            </tr>
          ))}
        </tbody></table></div>
    </div>
  )
}

export function MovementsCard({ ledger }: { ledger: Row[] }) {
  return (
    <div className="expensive-card p-5">
      <div className="mb-4"><h2 className="text-sm font-bold text-foreground flex items-center gap-2"><Package className="h-4 w-4 text-emerald-500" />Recent Movements</h2></div>
      <div className="space-y-3">
        {ledger.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No movements yet. Post an inward voucher.</p>}
        {ledger.map((entry: Row) => {
          const isInward = num(entry.inward_qty) > 0
          return (
            <div key={entry.id} className="flex items-center justify-between p-3 rounded-lg bg-card border border-border text-xs">
              <div className="flex items-center gap-3"><div className={`h-8 w-8 rounded-lg flex items-center justify-center font-bold ${isInward ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-blue-500/15 text-blue-600 dark:text-blue-400"}`}>{isInward ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</div>
                <div><div className="font-semibold text-foreground flex items-center gap-2"><span>{entry.product_name || entry.voucher_no}</span><span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground uppercase font-mono">{String(entry.voucher_type ?? "").replace("_", " ")}</span></div><div className="text-[11px] text-muted-foreground">{entry.godown_name} &bull; {entry.notes}</div></div></div>
              <div className="text-right"><div className={`font-black ${isInward ? "text-emerald-600 dark:text-emerald-400" : "text-blue-600 dark:text-blue-400"}`}>{isInward ? `+${formatWeight(num(entry.inward_qty))}` : `-${formatWeight(num(entry.outward_qty))}`}</div><div className="text-[10px] text-muted-foreground font-mono">Bal: {formatWeight(num(entry.running_balance))}</div></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function MoneyCard({
  receivables, payables, payrollDue,
}: {
  receivables: number | null
  payables: number | null
  payrollDue: number | null
}) {
  return (
    <div className="expensive-card p-5">
      <h2 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-500" />Money Owed</h2>
      <div className="space-y-3.5">
        <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20"><div className="text-xs text-muted-foreground font-medium">Customer Receivables</div><div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{receivables === null ? "—" : formatCurrency(receivables)}</div></div>
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20"><div className="text-xs text-muted-foreground font-medium">Vendor Payables</div><div className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">{payables === null ? "—" : formatCurrency(payables)}</div></div>
      </div>
      <Link href="/employees?tab=payroll&filter=unpaid" className="mt-3 flex items-center justify-between p-3 rounded-lg bg-card border border-border hover:bg-muted transition-colors"><span className="text-xs text-muted-foreground font-medium">Payroll due</span><span className="text-xs font-bold text-foreground flex items-center gap-1">{payrollDue === null ? "Open payroll" : formatCurrency(payrollDue)} <ArrowUpRight className="h-3.5 w-3.5 text-primary" /></span></Link>
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs"><Link href="/billing?filter=receivable" className="text-primary hover:underline font-semibold">Customer Invoices</Link><Link href="/purchases?filter=payable" className="text-primary hover:underline font-semibold">Vendor Bills</Link></div>
    </div>
  )
}

export function GodownCard({ godowns, summary }: { godowns: Row[]; summary: Row[] }) {
  return (
    <div className="expensive-card p-5">
      <h2 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2"><Building2 className="h-4 w-4 text-emerald-500" />Godown Space</h2>
      <div className="space-y-4">
        {godowns.map((g) => {
          const stored = summary.filter((r) => r.godown_id === g.id).reduce((a, r) => a + num(r.balance_kg), 0)
          const capacityKg = g.capacity_metric_tons ? num(g.capacity_metric_tons) * 1000 : 0
          const percent = capacityKg > 0 ? Math.min(100, Math.round((stored / capacityKg) * 100)) : 0
          return (
            <div key={g.id} className="space-y-1.5"><div className="flex items-center justify-between text-xs"><span className="font-semibold text-foreground">{g.name}</span><span className="text-muted-foreground font-mono">{capacityKg > 0 ? `${percent}% Occupied` : "Capacity not set"}</span></div>
              <div className="h-2 w-full rounded-md bg-muted overflow-hidden"><div className="h-full bg-emerald-600 rounded-md" style={{ width: `${percent}%` }} /></div>
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>{formatWeight(stored)} stored</span><span>Cap: {g.capacity_metric_tons ? `${g.capacity_metric_tons} MT` : "Not set"}</span></div></div>
          )
        })}
      </div>
    </div>
  )
}
