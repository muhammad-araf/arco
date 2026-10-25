"use client"

import * as React from "react"
import {
  Users2,
  Calendar,
  CheckCircle2,
  DollarSign,
  Printer,
  Plus,
  Clock,
  UserCheck,
} from "lucide-react"
import { markAttendance, correctAttendance, listAttendance, listPayroll, runPayroll, approvePayroll, payPayroll, getUnpaidSalaries, getPayrollRegister } from "@/app/actions/payroll"
import { listEmployees } from "@/app/actions/masters"
import { Employee, AttendanceRecord, AttendanceStatus } from "@/lib/types/database"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  PageSkeleton,
  SubmitSpinner,
  getUrlFilter,
} from "@/components/erp-ui"

export default function PayrollPage() {
  const [employees, setEmployees] = React.useState<Employee[]>([])
  const [attendanceDate, setAttendanceDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [attendanceState, setAttendanceState] = React.useState<{ [empId: string]: AttendanceStatus }>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const [periods, setPeriods] = React.useState<any[]>([])
  const [unpaid, setUnpaid] = React.useState<any[]>([])
  const [unpaidTotal, setUnpaidTotal] = React.useState(0)
  const [runEmployeeId, setRunEmployeeId] = React.useState("")
  const [runMonth, setRunMonth] = React.useState(() => new Date().getMonth() + 1)
  const [runYear, setRunYear] = React.useState(() => new Date().getFullYear())
  const [runPending, setRunPending] = React.useState(false)
  const saveGuard = React.useRef(false)

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    const now = new Date()
    const [em, att, per, un] = await Promise.all([
      listEmployees(), listAttendance({ from: attendanceDate, to: attendanceDate }),
      listPayroll({ month: now.getMonth() + 1, year: now.getFullYear() }), getUnpaidSalaries(),
    ])
    const failed = [em, att, per, un].find((x) => !x.success)
    if (failed) setFormError(failed.error ?? "Could not load payroll data.")
    const emps = (Array.isArray(em.data) ? em.data : []) as Employee[]
    setEmployees(emps)
    const initialAtt: { [empId: string]: AttendanceStatus } = {}
    emps.forEach((emp) => { initialAtt[emp.id] = "present" })
    for (const row of (Array.isArray(att.data) ? att.data : []) as any[]) {
      if (row.employee_id && row.status) initialAtt[row.employee_id] = row.status
    }
    setAttendanceState(initialAtt)
    setPeriods(Array.isArray(per.data) ? per.data : [])
    const unData: any = un.data ?? {}
    setUnpaid(Array.isArray(unData.rows) ? unData.rows : [])
    setUnpaidTotal(Number(unData.totalUnpaid || 0))
    setIsLoading(false)
  }, [attendanceDate])

  React.useEffect(() => {
    loadData()
    setDrillFilter(getUrlFilter())
  }, [loadData])

  const handleStatusChange = (empId: string, status: AttendanceStatus) => {
    setAttendanceState((prev) => ({ ...prev, [empId]: status }))
  }

  const handleSaveAttendance = () => {
    // Spec §13.2: one record per employee per date; a future date cannot
    // be marked, and re-saving a date corrects it instead of duplicating.
    if (!attendanceDate) return setFormError("Pick the attendance date first.")
    if (attendanceDate > new Date().toISOString().slice(0, 10)) return setFormError("Attendance cannot be marked for a future date. Pick today or an earlier date.")
    if (employees.length === 0) return setFormError("No employees exist yet. Add staff in Masters before marking attendance.")
    setFormError("")
    setShowConfirm(true)
  }

  const handleConfirmSave = async () => {
    if (saveGuard.current) return
    saveGuard.current = true
    setIsPending(true)
    try {
      let saved = 0
      const errors: string[] = []
      for (const emp of employees) {
        const status = attendanceState[emp.id] || "present"
        const marked = await markAttendance({ employeeId: emp.id, date: attendanceDate, status })
        if (marked.success) { saved++; continue }
        const corrected = await correctAttendance({ employeeId: emp.id, date: attendanceDate, status, reason: "Re-marking attendance for this date" })
        if (corrected.success) saved++
        else errors.push(`${emp.full_name}: ${corrected.error ?? marked.error ?? "failed"}`)
      }
      if (errors.length) setFormError(errors.join(" | "))
      else {
        const presentCount = employees.filter((e) => (attendanceState[e.id] || "present") === "present").length
        const halfCount = employees.filter((e) => attendanceState[e.id] === "half_day").length
        setFormNotice(`Attendance saved for ${attendanceDate}: ${saved} record(s) (${presentCount} present, ${halfCount} half-day). Re-saving this date corrects the same records instead of duplicating them.`)
      }
      setShowConfirm(false)
      await loadData()
    } finally {
      setIsPending(false)
      saveGuard.current = false
    }
  }

  const handleRunPayroll = async (e: React.FormEvent) => {
    e.preventDefault()
    if (runPending || !runEmployeeId) return
    setRunPending(true)
    try {
      const res = await runPayroll({ employeeId: runEmployeeId, month: runMonth, year: runYear })
      if (!res.success) { setFormError(res.error ?? "Could not run payroll."); return }
      setFormNotice("Payroll period created as a draft. Approve it, then pay it.")
      await loadData()
    } finally { setRunPending(false) }
  }

  const handleApprove = async (id: string) => {
    const res = await approvePayroll(id)
    if (!res.success) { setFormError(res.error ?? "Could not approve payroll."); return }
    setFormNotice("Payroll period approved.")
    await loadData()
  }

  const handlePay = async (period: any) => {
    const amount = Number(period.balance_amount || 0)
    if (!(amount > 0)) return setFormError("Nothing outstanding on this period.")
    const res = await payPayroll({ payrollId: period.id, amount, account: "cash" })
    if (!res.success) { setFormError(res.error ?? "Could not pay payroll."); return }
    setFormNotice(`Payroll payment of ${formatCurrency(amount)} recorded.`)
    await loadData()
  }

  const registerTotals = employees.reduce(
    (acc, emp) => {
      const baseEarned = emp.pay_type === "monthly" ? emp.base_rate : emp.base_rate * 26
      return { base: acc.base + baseEarned, net: acc.net + baseEarned }
    },
    { base: 0, net: 0 }
  )

  if (isLoading) return <PageSkeleton />

  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      {drillFilter === "unpaid" && (
        <AlertBanner tone="warning" message={periods.length === 0 ? "No finalized periods yet — the register below is only an estimate." : "The register below is only an estimate. Finalized periods are listed separately."} />
      )}
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Users2 className="h-6 w-6 text-emerald-500" />
            Payroll
          </h1>
        </div>

        <button
          type="button"
          onClick={handleSaveAttendance}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
          <span>{isPending ? "Saving…" : "Save Attendance"}</span>
        </button>
      </div>

      {/* Daily Attendance Grid */}
      <div className="expensive-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-emerald-500" />
              Attendance
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={attendanceDate}
              onChange={(e) => setAttendanceDate(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground font-mono"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Code</th>
                <th className="pb-3 font-bold">Staff Name</th>
                <th className="pb-3 font-bold">Designation</th>
                <th className="pb-3 font-bold">Wage Category</th>
                <th className="pb-3 font-bold text-right">Base Rate</th>
                <th className="pb-3 font-bold text-center">Mark Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {employees.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4">
                    <EmptyState
                      title="No employees yet"
                      hint="Add staff in Masters, then mark attendance here."
                    />
                  </td>
                </tr>
              )}
              {employees.map((emp) => {
                const currentStatus = attendanceState[emp.id] || "present"
                return (
                  <tr key={emp.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{emp.code}</td>
                    <td className="py-3 font-bold text-foreground">{emp.full_name}</td>
                    <td className="py-3 text-muted-foreground">{emp.designation}</td>
                    <td className="py-3 text-muted-foreground capitalize">
                      {emp.pay_type === "monthly" ? "Monthly Salary" : "Daily Wage"}
                    </td>
                    <td className="py-3 text-right font-mono font-bold text-foreground">
                      {formatCurrency(emp.base_rate)} {emp.pay_type === "daily" ? "/ day" : "/ mo"}
                    </td>
                    <td className="py-3 text-center">
                      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted border border-border">
                        <button
                          type="button"
                          onClick={() => handleStatusChange(emp.id, "present")}
                          className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                            currentStatus === "present"
                              ? "bg-emerald-600 text-white shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Present
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(emp.id, "half_day")}
                          className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                            currentStatus === "half_day"
                              ? "bg-amber-600 text-white shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Half-Day
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(emp.id, "leave")}
                          className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                            currentStatus === "leave"
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Leave
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(emp.id, "absent")}
                          className={`px-2 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                            currentStatus === "absent"
                              ? "bg-destructive text-white shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Absent
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Payroll Estimated Register */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            Payroll Estimate
          </h2>
          <span className="text-xs text-muted-foreground font-mono">26 Standard Business Days</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Employee</th>
                <th className="pb-3 font-bold">Designation</th>
                <th className="pb-3 font-bold text-right">Eligible Days</th>
                <th className="pb-3 font-bold text-right">Base Earned</th>
                <th className="pb-3 font-bold text-right">Advance Recovery</th>
                <th className="pb-3 font-bold text-right">Net Payable Salary</th>
                <th className="pb-3 font-bold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {employees.map((emp) => {
                const eligibleDays = 26
                const baseEarned = emp.pay_type === "monthly" ? emp.base_rate : emp.base_rate * eligibleDays
                // No advance ledger exists in this prototype, so no advance
                // is deducted here (a flat placeholder was shown before).
                const advance = 0
                const netPayable = baseEarned - advance

                return (
                  <tr key={emp.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-bold text-foreground font-sans">{emp.full_name}</td>
                    <td className="py-3 text-muted-foreground font-sans">{emp.designation}</td>
                    <td className="py-3 text-right">{eligibleDays} days</td>
                    <td className="py-3 text-right font-bold text-foreground">{formatCurrency(baseEarned)}</td>
                    <td className="py-3 text-right text-destructive">-{formatCurrency(advance)}</td>
                    <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                      {formatCurrency(netPayable)}
                    </td>
                    <td className="py-3 text-center">
                      <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase font-sans">
                        Calculated
                      </span>
                    </td>
                  </tr>
                )
              })}
              {employees.length > 0 && (
                <tr className="border-t-2 border-border font-bold">
                  <td className="py-3 font-sans" colSpan={3}>Register totals (estimate)</td>
                  <td className="py-3 text-right">{formatCurrency(registerTotals.base)}</td>
                  <td className="py-3 text-right text-muted-foreground">—</td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">{formatCurrency(registerTotals.net)}</td>
                  <td className="py-3" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Estimate only: 26 standard business days. Daily staff at base rate × 26, monthly staff at base rate. Advance recovery is not counted yet.
        </p>
      </div>
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Finalized Payroll</h2>
        <p className="text-xs text-muted-foreground mb-4">Only approved or partially-paid periods with a balance appear here. Total unpaid: {formatCurrency(unpaidTotal)}.</p>
        <form onSubmit={handleRunPayroll} className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs mb-4">
          <div><label className="block font-medium text-foreground mb-1">Employee *</label><select value={runEmployeeId} onChange={(e) => setRunEmployeeId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select employee</option>{employees.map((e) => (<option key={e.id} value={e.id}>{e.full_name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Month</label><input type="number" value={runMonth} onChange={(e) => setRunMonth(Number(e.target.value))} min="1" max="12" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Year</label><input type="number" value={runYear} onChange={(e) => setRunYear(Number(e.target.value))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div className="flex items-end"><button type="submit" disabled={runPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{runPending ? "Running…" : "Run payroll (draft)"}</button></div>
        </form>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2">Period</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Net payable</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Balance</th><th className="pb-2 text-center">Status / Actions</th></tr></thead>
          <tbody className="divide-y divide-border">
            {periods.length === 0 && unpaid.length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground">No payroll periods yet — run the first draft above. Until then, only the estimate register above applies.</td></tr>}
            {[...periods, ...unpaid.filter((u) => !periods.some((p) => p.id === u.id))].map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{employees.find((e) => e.id === p.employee_id)?.full_name ?? p.employee_id}</td><td className="py-2">{p.month}/{p.year}</td><td className="py-2 text-right">{formatCurrency(Number(p.gross_pay || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.paid_amount || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(p.balance_amount || 0))}</td><td className="py-2 text-center">{p.status}{p.status === "draft" && (<button type="button" onClick={() => handleApprove(p.id)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Approve</button>)}{(p.status === "approved" || p.status === "partially_paid") && Number(p.balance_amount || 0) > 0 && (<button type="button" onClick={() => handlePay(p)} className="ml-2 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer">Pay balance</button>)}</td></tr>))}
          </tbody></table></div>
      </div>
      <ConfirmDialog
        open={showConfirm}
        title="Save attendance?"
        description={`Save the roster for ${attendanceDate} for ${employees.length} employee${employees.length === 1 ? "" : "s"}. Saving again updates the same marks.`}
        confirmLabel="Save Attendance"
        pending={isPending}
        onConfirm={handleConfirmSave}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}
