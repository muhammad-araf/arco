"use client"

/**
 * Employee details, read-only. There was no View operation before:
 * the Directory table showed the same few columns for everyone, and
 * the only way to see a record was to open it for editing.
 */
import * as React from "react"
import type { Employee } from "@/lib/types/database"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Modal, secondaryButtonClass } from "@/components/erp-form"

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-border last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-bold text-foreground text-right">{value}</dd>
    </div>
  )
}

export function EmployeeViewDialog({
  open,
  onClose,
  employee,
  openAdvances,
}: {
  open: boolean
  onClose: () => void
  employee: Employee | null
  /** Outstanding (not yet recovered) advances for this employee. */
  openAdvances: number
}) {
  if (!open || !employee) return null
  const rateSuffix =
    employee.pay_type === "daily"
      ? "/ day"
      : employee.pay_type === "piece_rate"
        ? "/ piece"
        : "/ month"
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={employee.full_name}
      description={`${employee.code} · ${employee.designation}`}
    >
      <dl className="text-xs">
        <Row label="Code" value={employee.code} />
        <Row label="Designation" value={employee.designation} />
        <Row
          label="Wage category"
          value={
            employee.pay_type === "monthly"
              ? "Monthly Salary"
              : employee.pay_type === "piece_rate"
                ? "Piece Rate"
                : "Daily Wage"
          }
        />
        <Row
          label="Base rate"
          value={`${formatCurrency(Number(employee.base_rate || 0))} ${rateSuffix}`}
        />
        <Row label="Phone" value={employee.phone || "—"} />
        <Row label="Payment preference" value={employee.payment_preference || "Not recorded"} />
        <Row label="Joining date" value={formatDate(employee.joining_date)} />
        <Row
          label="Status"
          value={employee.is_active === false ? "Inactive" : "Active"}
        />
        <Row label="Open advances" value={formatCurrency(openAdvances)} />
      </dl>
      <p className="text-[11px] text-muted-foreground">
        This is a worker record for attendance and payroll. It does not give
        the person a login — login accounts live on the People page.
      </p>
      <div className="flex items-center justify-end gap-3 pt-2">
        <button type="button" onClick={onClose} className={secondaryButtonClass}>
          Close
        </button>
      </div>
    </Modal>
  )
}
