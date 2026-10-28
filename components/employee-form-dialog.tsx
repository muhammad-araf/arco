"use client"

/**
 * Employee create + edit in one modal form (POS pattern: the same form
 * for both, trigger is an Add button or a row Edit button).
 *
 * Replaces the Directory tab's inline "Add an employee" form that sat
 * above the table, and the hand-rolled edit modal. Code is shown
 * read-only on edit (it never changes after creation); a duplicate
 * code is caught here instead of only by the server.
 */
import * as React from "react"
import { createEmployee, updateEmployee } from "@/app/actions/masters"
import type { Employee } from "@/lib/types/database"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

const PAY_TYPES = [
  { value: "monthly", label: "Monthly Salary" },
  { value: "daily", label: "Daily Wage" },
  { value: "piece_rate", label: "Piece Rate" },
] as const

export function EmployeeFormDialog({
  open,
  onClose,
  employee,
  employees,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** null = creating a new employee; a row = editing it. */
  employee: Employee | null
  employees: Employee[]
  onSaved: (notice: string) => void
}) {
  const isEditing = employee !== null
  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [designation, setDesignation] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [payType, setPayType] = React.useState<string>("monthly")
  const [baseRate, setBaseRate] = React.useState("")
  const [joiningDate, setJoiningDate] = React.useState("")
  const [payPref, setPayPref] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setCode(employee?.code ?? "")
      setName(employee?.full_name ?? "")
      setDesignation(employee?.designation ?? "")
      setPhone(employee?.phone ?? "")
      setPayType(employee?.pay_type ?? "monthly")
      setBaseRate(employee?.base_rate != null ? String(employee.base_rate) : "")
      setJoiningDate(employee?.joining_date?.slice(0, 10) ?? "")
      setPayPref(employee?.payment_preference ?? "")
      setError("")
      setPending(false)
    }
  }, [open, employee])

  const rateSuffix =
    payType === "daily" ? "/ day" : payType === "piece_rate" ? "/ piece" : "/ month"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!isEditing && !code.trim()) return setError("Employee code is required.")
    if (!name.trim() || !designation.trim())
      return setError("Employee full name and designation are required.")
    const rate = baseRate.trim() === "" ? 0 : Number(baseRate)
    if (!Number.isFinite(rate) || rate < 0)
      return setError("Base rate cannot be negative.")
    if (
      !isEditing &&
      employees.some((x) => x.code.trim().toLowerCase() === code.trim().toLowerCase())
    )
      return setError(`An employee with code "${code.trim()}" already exists. Pick a different code.`)
    setPending(true)
    try {
      const res = isEditing
        ? await updateEmployee(employee.id, {
            full_name: name.trim(),
            designation: designation.trim(),
            phone: phone.trim() || undefined,
            pay_type: payType,
            base_rate: rate,
            joining_date: joiningDate || undefined,
            payment_preference: payPref || null,
          })
        : await createEmployee({
            code: code.trim(),
            full_name: name.trim(),
            designation: designation.trim(),
            phone: phone.trim() || undefined,
            pay_type: payType,
            base_rate: rate,
            joining_date: joiningDate || undefined,
            payment_preference: payPref || undefined,
          })
      if (!res.success) {
        setError(res.error ?? "Could not save the employee.")
        return
      }
      onSaved(
        isEditing
          ? `"${name.trim()}" updated.`
          : `Employee "${name.trim()}" created.`,
      )
      onClose()
    } finally {
      setPending(false)
    }
  }

  if (!open) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? `Edit ${employee.full_name}` : "Add employee"}
      description={
        isEditing
          ? "Change the details below. The code never changes."
          : "Staff created here appear in attendance and payroll. Deactivation is reversible — records are never deleted."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field
          id="emp-code"
          label="Code"
          required={!isEditing}
          hint={isEditing ? "Code never changes after creation." : "e.g. EMP-004"}
        >
          <input
            id="emp-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. EMP-004"
            className={`${inputClass} font-mono`}
            disabled={isEditing}
            required={!isEditing}
          />
        </Field>
        <Field id="emp-name" label="Full name" required>
          <input
            id="emp-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Abdul Ghafoor"
            className={inputClass}
            required
          />
        </Field>
        <Field id="emp-designation" label="Designation" required>
          <input
            id="emp-designation"
            type="text"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            placeholder="e.g. Supervisor"
            className={inputClass}
            required
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="emp-phone" label="Phone">
            <input
              id="emp-phone"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 0300-1234567"
              className={inputClass}
            />
          </Field>
          <Field id="emp-pay-type" label="Wage category">
            <select
              id="emp-pay-type"
              value={payType}
              onChange={(e) => setPayType(e.target.value)}
              className={inputClass}
            >
              {PAY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            id="emp-base-rate"
            label="Base rate"
            hint={`Amount ${rateSuffix}. Leave blank for 0.`}
          >
            <input
              id="emp-base-rate"
              type="number"
              min="0"
              value={baseRate}
              onChange={(e) => setBaseRate(e.target.value)}
              placeholder="e.g. 45000"
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field id="emp-joining" label="Joining date">
            <input
              id="emp-joining"
              type="date"
              value={joiningDate}
              onChange={(e) => setJoiningDate(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>
        <Field id="emp-pay-pref" label="Payment preference">
          <select
            id="emp-pay-pref"
            value={payPref}
            onChange={(e) => setPayPref(e.target.value)}
            className={inputClass}
          >
            <option value="">Not recorded</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>
              {pending ? "Saving…" : isEditing ? "Save changes" : "Create employee"}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
