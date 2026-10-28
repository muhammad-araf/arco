"use client"

/**
 * Reverse a payroll period. The form itself is the confirmation: the
 * submit button is destructive, a reason is mandatory, and the server
 * blocks reversal once any payment exists on the period.
 */
import * as React from "react"
import { reversePayroll } from "@/app/actions/payroll"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function PayrollReverseDialog({
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
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setPeriodId("")
      setReason("")
      setError("")
      setPending(false)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!periodId) return setError("Select a period to reverse.")
    if (!reason.trim()) return setError("A reason is mandatory to reverse payroll.")
    setPending(true)
    try {
      const res = await reversePayroll(periodId, reason.trim())
      if (!res.success) {
        setError(res.error ?? "Could not reverse payroll.")
        return
      }
      onSaved("Payroll reversed.")
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
      title="Reverse a payroll"
      description="Reversal is blocked by the server once any payment exists on the period."
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field id="rev-period" label="Period" required>
          <select
            id="rev-period"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select period</option>
            {periods.map((p: any) => (
              <option key={p.id} value={p.id}>
                {employeeName(p.employee_id)} — {p.month}/{p.year} ({p.status})
              </option>
            ))}
          </select>
        </Field>
        <Field id="rev-reason" label="Reason" required>
          <input
            id="rev-reason"
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
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? <SubmitSpinner /> : null}
            <span>{pending ? "Reversing…" : "Reverse payroll"}</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
