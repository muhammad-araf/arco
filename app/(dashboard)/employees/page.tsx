import { Suspense } from "react"
import { getEmployeesInitData } from "@/app/actions/payroll"
import { listEmployees } from "@/app/actions/masters"
import { EmployeesClient } from "@/components/employees-client"
import { EmployeesSkeleton } from "@/components/route-skeletons"

type Tab = "directory" | "attendance" | "payroll" | "advances"
const TABS: Tab[] = ["directory", "attendance", "payroll", "advances"]

/**
 * Server component: fetches the Employees initial data on the server
 * (the Settings pattern — page.tsx at 958adad) and passes it as plain,
 * serializable props to the client island, instead of the old mount
 * flow where the client showed a full-page skeleton, then spent two
 * client round trips (getEmployeesInitData + listEmployees(true))
 * before anything rendered.
 *
 * The island keeps every tab, dialog, save/pay/approve flow and error
 * state of the old client page verbatim; loadData() is unchanged in
 * behaviour and still runs for attendance-date changes and for every
 * post-save refresh. The attendance worksheet stays a worksheet and
 * Approve stays one-click — the deliberate Employees-pass exceptions.
 *
 * Streaming: this page itself returns the Suspense boundary at once
 * and EmployeesLoader (below) streams the island in when its server
 * fetches resolve, so the layout shell + EmployeesSkeleton paint
 * before the data does. There is deliberately NO separate Suspense
 * boundary per slow section (estimate / register / ledger): those
 * sections share the island's single init payload and its state
 * (periods / unpaid / drafts feed the finalized list, the ledger,
 * payment history and the adjust/reverse dialogs), so a boundary
 * around one of them could not paint it any earlier — it would only
 * add skeleton flicker — and splitting that shared state apart would
 * risk the flows above. The slow sections therefore arrive with the
 * rest of the island, behind this one boundary.
 *
 * On fetch failure the island still renders, with the error in the
 * same formError banner the old page showed — never a blank page —
 * and it retries once via its old client loadData() path.
 *
 * No single-RPC change: getEmployeesInitData is left on its old path
 * (see the pass report). No prefetching is added anywhere here.
 */

/** PKT calendar date (Asia/Karachi has no DST, so this is stable).
 * The old client page used the browser's local date and its own
 * comment notes the 5am-PKT UTC trap; the server has no browser, so
 * it renders for the PKT date the app's staff work in. If the
 * browser's local today differs (travelling user, clock skew), the
 * island corrects the date on mount and loads that date via the old
 * client path — the server date is never saved against. */
function pktToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`
  const last = new Date(year, month, 0).getDate()
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}` }
}

async function EmployeesLoader(props: {
  tab: Tab
  drillFilter: string | null
}) {
  const attendanceDate = pktToday()
  const attYear = Number(attendanceDate.slice(0, 4))
  const attMonth = Number(attendanceDate.slice(5, 7))
  const range = monthRange(attYear, attMonth)
  let initialInit: any | null = null
  let initialError = ""
  let initialDirectory: any[] = []
  try {
    const [initRes, dirRes] = await Promise.all([
      getEmployeesInitData({
        attendanceDate,
        attYear,
        attMonth,
        rangeFrom: range.from,
        rangeTo: range.to,
      }),
      listEmployees(true),
    ])
    if (!initRes.success) {
      initialError = initRes.error ?? "Could not load payroll data."
    } else {
      initialInit = initRes.data as any
    }
    if (dirRes.success && Array.isArray(dirRes.data)) {
      initialDirectory = dirRes.data as any[]
    } else if (!dirRes.success && !initialError) {
      initialError = dirRes.error ?? "Could not load employees."
    }
  } catch (err) {
    initialError = err instanceof Error ? err.message : "Could not load payroll data."
  }

  return (
    <EmployeesClient
      initialInit={initialInit}
      initialDirectory={initialDirectory}
      initialError={initialError}
      initialTab={props.tab}
      initialDrillFilter={props.drillFilter}
      initialAttendanceDate={attendanceDate}
    />
  )
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const tabParam = typeof sp.tab === "string" ? sp.tab : undefined
  const filterParam = typeof sp.filter === "string" && sp.filter ? sp.filter : null
  // Mirror of the old client mount logic: a valid ?tab= wins, else a
  // ?filter= (dashboard drill-down) lands on the Payroll tab.
  const tab: Tab = tabParam && (TABS as string[]).includes(tabParam)
    ? (tabParam as Tab)
    : filterParam
      ? "payroll"
      : "directory"
  return (
    <Suspense fallback={<EmployeesSkeleton />}>
      {/* Remount the island when the drill-down query changes, so a
      soft navigation to a new ?tab= / ?filter= re-seeds it exactly
      as the old mount-only URL read did; switchTab's replaceState
      does not navigate, so it never remounts mid-session. */}
      <EmployeesLoader
        key={`${tab}:${filterParam ?? ""}`}
        tab={tab}
        drillFilter={filterParam}
      />
    </Suspense>
  )
}
