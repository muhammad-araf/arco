"use client"

/** Adjust an approved / partially-paid payroll period, with a mandatory reason. */
import * as React from "react"
import { adjustPayroll } from "@/app/actions/payroll"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function PayrollAdjustDialog({
  open,
  onClose,
  periods,
  employeeName,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  periods: any[]
  employeeName: (employeeId: string) => string
  onSaved: (notice: string) => void
}) {
  const [periodId, setPeriodId] = React.useState("")
  const [delta, setDelta] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setPeriodId("")
      setDelta("")
      setReason("")
      setError("")
      setPending(false)
    }
  }, [open])

  const options = periods.filter((p: any) =>
    ["approved", "partially_paid"].includes(p.status),
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!periodId) return setError("Select an approved period to adjust.")
    if (!reason.trim()) return setError("A reason is mandatory for payroll adjustments.")
    setPending(true)
    try {
      const res = await adjustPayroll(periodId, Number(delta) || 0, reason.trim())
      if (!res.success) {
        setError(res.error ?? "Could not adjust payroll.")
        return
      }
      onSaved("Payroll adjusted.")
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
      title="Adjust an approved payroll"
      description="Change the net payable of an approved or partially-paid period. A reason is mandatory."
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field id="adj-period" label="Period (approved / partially paid)" required>
          <select
            id="adj-period"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select period</option>
            {options.map((p: any) => (
              <option key={p.id} value={p.id}>
                {employeeName(p.employee_id)} — {p.month}/{p.year} ({p.status})
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="adj-delta"
          label="Change in net payable"
          hint="Can be negative."
        >
          <input
            id="adj-delta"
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="e.g. -5000 or 3000"
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field id="adj-reason" label="Reason" required>
          <input
            id="adj-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
            required
          />
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>{pending ? "Adjusting…" : "Adjust payroll"}</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
