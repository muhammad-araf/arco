import { redirect } from "next/navigation"

// Payroll now lives on the Employees page (/employees, Payroll tab).
// Old links keep working: /payroll?filter=unpaid (dashboard drill-down)
// lands on the Payroll tab with the filter applied, and a plain /payroll
// (dashboard Attendance link) lands on the Attendance tab.
export default async function PayrollRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  const filter = sp.filter
  if (typeof filter === "string" && filter) params.set("filter", filter)
  const tab = sp.tab
  if (typeof tab === "string" && tab) params.set("tab", tab)
  else params.set("tab", typeof filter === "string" && filter ? "payroll" : "attendance")
  redirect(`/employees?${params.toString()}`)
}
