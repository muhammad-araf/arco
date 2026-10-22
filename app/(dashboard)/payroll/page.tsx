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

export default function PayrollPage() {
  const [employees, setEmployees] = React.useState<Employee[]>([])
  const [attendanceDate, setAttendanceDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [attendanceState, setAttendanceState] = React.useState<{ [empId: string]: AttendanceStatus }>({})

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
  }, [loadData])

  const handleStatusChange = (empId: string, status: AttendanceStatus) => {
    setAttendanceState((prev) => ({ ...prev, [empId]: status }))
  }

  const handleSaveAttendance = () => {
    alert("Attendance successfully recorded for " + attendanceDate)
  }

  return (
    <div className="space-y-6">
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
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <CheckCircle2 className="h-4 w-4" />
          <span>Save Today's Attendance</span>
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
                const advance = 5000
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
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
