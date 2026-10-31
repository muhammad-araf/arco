import { Suspense, cache } from "react"
import Link from "next/link"
import {
  Boxes, FileCheck2, Wallet, Plus, Clock,
} from "lucide-react"
import { getDashboardFast, getDashboardCash, getDashboardSlow } from "@/app/actions/dashboard"
import { Skel, TableCardSkeleton, ListCardSkeleton } from "@/components/erp-ui"
import {
  TodayCards, CashCard, MoneyCard, StockCard, MovementsCard, GodownCard,
  LowStockBanner, DismissibleError,
} from "./dashboard-islands"

/**
 * Server component (Settings pattern): the page shell — title row and
 * quick-action links — paints immediately with zero data trips, and
 * each section streams in behind its own Suspense boundary as its
 * server action resolves. Nothing here changes what the dashboard
 * shows, only when parts of it paint:
 * - fast sections (today cards, money card) wait only on the single
 *   dashboard_today_payload RPC + payroll query;
 * - the cash card waits only on the daybook (old path, unchanged);
 * - the stock / movements / godown sections wait only on the stock
 *   summary + ledger (old path, unchanged).
 *
 * Per-request dedup: the three loaders below are React cache()ed, so
 * sections that need the same payload (e.g. fast data for the today
 * cards, the money card and the godown list) share ONE action call
 * per render instead of re-issuing it.
 *
 * Error granularity improves deliberately: the old client page
 * blanked the whole dashboard on any fetch failure. Now a failed
 * section shows its error banner (same message text and mapping as
 * before) with that section's empty state, while the other sections
 * still paint. The cash card's daybook failure is still NOT an error
 * (it falls back to opening balances, as before).
 *
 * No prefetching is added anywhere here: the quick-action links are
 * plain Link components with no prefetch prop, exactly as before.
 */

type Row = Record<string, any>
type Data = Record<string, any> | undefined

const loadFast = cache(async () => getDashboardFast())
const loadCash = cache(async () => getDashboardCash())
const loadSlow = cache(async () => getDashboardSlow())

const rowsOf = (d: Data, key: string): Row[] => {
  const v = d?.[key]
  return Array.isArray(v) ? (v as Row[]) : []
}
const numOrNull = (d: Data, key: string): number | null => {
  const v = d?.[key]
  if (v === null || v === undefined) return null
  return Number.isFinite(Number(v)) ? Number(v) : 0
}
const strOrNull = (d: Data, key: string): string | null => {
  const v = d?.[key]
  return typeof v === "string" ? v : null
}

// --- Section fallbacks: layout-matched skeletons, flat solid blocks ---

function StatCardFallback() {
  return (
    <div className="expensive-card p-4 space-y-3">
      <Skel className="h-3 w-24 bg-muted rounded" />
      <Skel className="h-7 w-32 bg-muted rounded" />
      <Skel className="h-3 w-20 bg-muted rounded" />
    </div>
  )
}

function MoneyFallback() {
  return (
    <div className="expensive-card p-5 space-y-3">
      <Skel className="h-4 w-28 bg-muted rounded" />
      <Skel className="h-16 w-full rounded-lg bg-muted" />
      <Skel className="h-16 w-full rounded-lg bg-muted" />
      <Skel className="h-10 w-full rounded-lg bg-muted" />
    </div>
  )
}

function GodownFallback() {
  return (
    <div className="expensive-card p-5 space-y-4">
      <Skel className="h-4 w-28 bg-muted rounded" />
      {[0, 1].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Skel className="h-3 w-24 bg-muted rounded" />
            <Skel className="h-3 w-16 shrink-0 bg-muted rounded" />
          </div>
          <Skel className="h-2 w-full rounded bg-muted" />
          <div className="flex items-center justify-between gap-3">
            <Skel className="h-3 w-20 bg-muted rounded" />
            <Skel className="h-3 w-16 shrink-0 bg-muted rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// --- Async section components (each awaits only its own slice) ---

async function FastErrorSection() {
  const fast = await loadFast()
  if (fast.success) return null
  return <DismissibleError error={fast.error ?? "Could not load dashboard data."} />
}

async function TodaySection() {
  const fast = await loadFast()
  const d = (fast.success ? fast.data : undefined) as Data
  return (
    <TodayCards
      inward={rowsOf(d, "inwardToday")}
      batches={rowsOf(d, "batchesToday")}
      passes={rowsOf(d, "passesToday")}
      latestPassNo={strOrNull(d, "latestPassNo")}
    />
  )
}

async function CashSection() {
  const [fast, cash] = await Promise.all([loadFast(), loadCash()])
  const fd = (fast.success ? fast.data : undefined) as Data
  const cd = (cash.success ? cash.data : undefined) as Data
  return (
    <CashCard
      cashOpening={numOrNull(fd, "cashOpening")}
      cashPosition={numOrNull(cd, "cashPosition")}
      cashByAccount={rowsOf(cd, "cashByAccount")}
      cashSource={strOrNull(cd, "cashSource")}
      error={cash.success ? "" : (cash.error ?? "Could not load dashboard data.")}
    />
  )
}

async function SlowErrorLowStockSection() {
  const slow = await loadSlow()
  if (!slow.success) {
    return <DismissibleError error={slow.error ?? "Could not load dashboard data."} />
  }
  const d = slow.data as Data
  const summary = rowsOf(d, "summary")
  const lowCount = summary.filter((r) => r.below_min_stock).length
  return <LowStockBanner lowCount={lowCount} />
}

async function StockSection() {
  const slow = await loadSlow()
  const d = (slow.success ? slow.data : undefined) as Data
  return <StockCard summary={rowsOf(d, "summary")} />
}

async function MovementsSection() {
  const slow = await loadSlow()
  const d = (slow.success ? slow.data : undefined) as Data
  return <MovementsCard ledger={rowsOf(d, "ledger")} />
}

async function MoneySection() {
  const fast = await loadFast()
  const d = (fast.success ? fast.data : undefined) as Data
  return (
    <MoneyCard
      receivables={numOrNull(d, "receivables")}
      payables={numOrNull(d, "payables")}
      payrollDue={numOrNull(d, "payrollDue")}
    />
  )
}

async function GodownSection() {
  const [fast, slow] = await Promise.all([loadFast(), loadSlow()])
  const fd = (fast.success ? fast.data : undefined) as Data
  const sd = (slow.success ? slow.data : undefined) as Data
  return <GodownCard godowns={rowsOf(fd, "godowns")} summary={rowsOf(sd, "summary")} />
}

// --- Page shell (paints immediately, zero data trips) ---

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">
            Dashboard
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/inward" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"><Plus className="h-3.5 w-3.5" />New Inward</Link>
          <Link href="/gatepass" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold"><FileCheck2 className="h-3.5 w-3.5 text-emerald-500" />Issue Gate Pass</Link>
          <Link href="/production" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold"><Boxes className="h-3.5 w-3.5 text-amber-500" />Run Batch</Link>
          <Link href="/purchases" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold"><Plus className="h-3.5 w-3.5 text-amber-500" />Purchase</Link>
          <Link href="/billing" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold"><Wallet className="h-3.5 w-3.5 text-emerald-500" />Receipt</Link>
          <Link href="/daybook" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold"><Wallet className="h-3.5 w-3.5 text-amber-500" />Expense</Link>
          <Link href="/employees?tab=attendance" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold"><Clock className="h-3.5 w-3.5 text-emerald-500" />Attendance</Link>
        </div>
      </div>
      <Suspense fallback={null}>
        <FastErrorSection />
      </Suspense>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Suspense fallback={<><StatCardFallback /><StatCardFallback /><StatCardFallback /></>}>
          <TodaySection />
        </Suspense>
        <Suspense fallback={<StatCardFallback />}>
          <CashSection />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <SlowErrorLowStockSection />
      </Suspense>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Suspense fallback={<TableCardSkeleton rows={6} columns={[3, 2, 1]} />}>
            <StockSection />
          </Suspense>
          <Suspense fallback={<ListCardSkeleton rows={4} />}>
            <MovementsSection />
          </Suspense>
        </div>
        <div className="space-y-6">
          <Suspense fallback={<MoneyFallback />}>
            <MoneySection />
          </Suspense>
          <Suspense fallback={<GodownFallback />}>
            <GodownSection />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
