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
import { GodownStore } from "@/lib/services/godown-store"
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
  const saveGuard = React.useRef(false)

  const loadData = React.useCallback(() => {
    const emps = GodownStore.getEmployees()
    setEmployees(emps)
    const initialAtt: { [empId: string]: AttendanceStatus } = {}
    emps.forEach((emp) => {
      initialAtt[emp.id] = "present"
    })
    setAttendanceState(initialAtt)
  }, [])

  React.useEffect(() => {
    loadData()
    setDrillFilter(getUrlFilter())
    setIsLoading(false)
  }, [loadData])

  const handleStatusChange = (empId: string, status: AttendanceStatus) => {
    setAttendanceState((prev) => ({ ...prev, [empId]: status }))
  }

  const handleSaveAttendance = () => {
    // Spec §13.2: one record per employee per date; a future date cannot
    // be marked, and re-saving a date corrects it instead of duplicating.
    if (!attendanceDate) return setFormError("Pick the attendance date first.")
    if (attendanceDate > new Date().toISOString().slice(0, 10)) return setFormError("Attendance cannot be marked for a future date. Pick today or an earlier date.")
    if (employees.length === 0) return setFormError("No employees exist yet. Add staff in Master Data before marking attendance.")
    setFormError("")
    setShowConfirm(true)
  }

  const handleConfirmSave = () => {
    if (saveGuard.current) return
    saveGuard.current = true
    setIsPending(true)
    try {
      const state = (GodownStore as any).getState()
      const existing = (state.attendance || []).filter(
        (a: AttendanceRecord) => !(a.date.slice(0, 10) === attendanceDate && employees.some((e) => e.id === a.employee_id))
      )
      const fresh: AttendanceRecord[] = employees.map((emp) => ({
        id: `att-${attendanceDate}-${emp.id}`,
        date: new Date(`${attendanceDate}T00:00:00`).toISOString(),
        employee_id: emp.id,
        employee_name: emp.full_name,
        status: attendanceState[emp.id] || "present",
        overtime_hours: 0,
        created_at: new Date().toISOString(),
      }))
      state.attendance = [...fresh, ...existing]
      ;(GodownStore as any).saveState(state)
      const presentCount = fresh.filter((a) => a.status === "present").length
      const halfCount = fresh.filter((a) => a.status === "half_day").length
      setFormNotice(`Attendance saved for ${attendanceDate}: ${presentCount} present, ${halfCount} half-day, ${fresh.length - presentCount - halfCount} leave/absent. Re-saving this date updates the same records instead of duplicating them.`)
    } finally {
      setIsPending(false)
      saveGuard.current = false
      setShowConfirm(false)
    }
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
        <AlertBanner tone="warning" message="No finalized payroll periods exist yet in this prototype — the register below is an estimate for the current period, not a finalized payable. Finalize and pay periods in Phase 2 payroll." />
      )}
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Users2 className="h-6 w-6 text-emerald-500" />
            Employee Management, Attendance & Payroll
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Log daily roster attendance, manage monthly and daily-wage staff, advances, and generate pay slips.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSaveAttendance}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
          <span>{isPending ? "Saving…" : "Save Today's Attendance"}</span>
        </button>
      </div>

      {/* Daily Attendance Grid */}
      <div className="expensive-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-border/60">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-emerald-500" />
              Daily Attendance Roster
            </h2>
            <span className="text-xs text-muted-foreground">Mark daily operational presence across godowns and plants</span>
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
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Code</th>
                <th className="pb-3 font-bold">Staff Name</th>
                <th className="pb-3 font-bold">Designation</th>
                <th className="pb-3 font-bold">Wage Category</th>
                <th className="pb-3 font-bold text-right">Base Rate</th>
                <th className="pb-3 font-bold text-center">Mark Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {employees.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4">
                    <EmptyState
                      title="No employees yet"
                      hint="Add staff in Master Data — code, designation, pay type and base rate — then mark attendance here."
                    />
                  </td>
                </tr>
              )}
              {employees.map((emp) => {
                const currentStatus = attendanceState[emp.id] || "present"
                return (
                  <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
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
                      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60">
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
            Monthly Payroll Estimated Register (Current Period)
          </h2>
          <span className="text-xs text-muted-foreground font-mono">26 Standard Business Days</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Employee</th>
                <th className="pb-3 font-bold">Designation</th>
                <th className="pb-3 font-bold text-right">Eligible Days</th>
                <th className="pb-3 font-bold text-right">Base Earned</th>
                <th className="pb-3 font-bold text-right">Advance Recovery</th>
                <th className="pb-3 font-bold text-right">Net Payable Salary</th>
                <th className="pb-3 font-bold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {employees.map((emp) => {
                const eligibleDays = 26
                const baseEarned = emp.pay_type === "monthly" ? emp.base_rate : emp.base_rate * eligibleDays
                // No advance ledger exists in this prototype, so no advance
                // is deducted here (a flat placeholder was shown before).
                const advance = 0
                const netPayable = baseEarned - advance

                return (
                  <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 font-bold text-foreground font-sans">{emp.full_name}</td>
                    <td className="py-3 text-muted-foreground font-sans">{emp.designation}</td>
                    <td className="py-3 text-right">{eligibleDays} days</td>
                    <td className="py-3 text-right font-bold text-foreground">{formatCurrency(baseEarned)}</td>
                    <td className="py-3 text-right text-destructive">-{formatCurrency(advance)}</td>
                    <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                      {formatCurrency(netPayable)}
                    </td>
                    <td className="py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase font-sans">
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
          Estimate only: 26 standard business days; daily staff at base rate × 26, monthly staff at base rate. Advance recovery is 0 until the employee advance ledger lands (Phase 2) — payroll rules (paid leave, half-day conversion, denominator) still need client approval per spec §13.4.
        </p>
      </div>
      <ConfirmDialog
        open={showConfirm}
        title="Save attendance?"
        description={`Save the roster for ${attendanceDate} for ${employees.length} employee${employees.length === 1 ? "" : "s"}. If this date was saved before, the marks are updated in place — no duplicate records are created.`}
        confirmLabel="Save Attendance"
        pending={isPending}
        onConfirm={handleConfirmSave}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}
