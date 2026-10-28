"use client"

/**
 * Payroll rules (owner only — enforced server-side). Previously an
 * inline form at the bottom of the Payroll tab. Changes affect future
 * runs only, and a reason is mandatory.
 */
import * as React from "react"
import { updatePayrollRules } from "@/app/actions/payroll"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function PayrollRulesDialog({
  open,
  onClose,
  currentRules,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** Current configured rules, so opening the dialog never silently resets them to defaults. */
  currentRules?: {
    halfDayFactor?: number
    leavePaid?: boolean
    holidayPaid?: boolean
    monthlyMode?: "fixed" | "prorated"
    overtimeRatePerHour?: number | null
  } | null
  onSaved: (notice: string) => void
}) {
  const [halfFactor, setHalfFactor] = React.useState("0.5")
  const [leavePaid, setLeavePaid] = React.useState("no")
  const [holidayPaid, setHolidayPaid] = React.useState("yes")
  const [monthlyMode, setMonthlyMode] = React.useState<"fixed" | "prorated">("fixed")
  const [otRate, setOtRate] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setHalfFactor(
        currentRules?.halfDayFactor != null ? String(currentRules.halfDayFactor) : "0.5",
      )
      setLeavePaid(currentRules?.leavePaid ? "yes" : "no")
      setHolidayPaid(currentRules?.holidayPaid ? "yes" : "no")
      setMonthlyMode(currentRules?.monthlyMode ?? "fixed")
      setOtRate(
        currentRules?.overtimeRatePerHour != null
          ? String(currentRules.overtimeRatePerHour)
          : "",
      )
      setReason("")
      setError("")
      setPending(false)
    }
  }, [open, currentRules])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!reason.trim()) return setError("A reason is mandatory to change payroll rules.")
    const ot = otRate.trim() === "" ? null : Number(otRate)
    if (ot !== null && (!Number.isFinite(ot) || ot < 0))
      return setError("Overtime rate must be >= 0, or left blank.")
    const half = Number(halfFactor)
    if (!Number.isFinite(half) || half < 0 || half > 1)
      return setError("Half-day factor must be between 0 and 1.")
    setPending(true)
    try {
      const res = await updatePayrollRules(
        {
          halfDayFactor: half,
          leavePaid: leavePaid === "yes",
          holidayPaid: holidayPaid === "yes",
          monthlyMode,
          overtimeRatePerHour: ot,
        },
        reason.trim(),
      )
      if (!res.success) {
        setError(res.error ?? "Could not update payroll rules.")
        return
      }
      onSaved("Payroll rules updated (owner only). Future runs use the new rules.")
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
      title="Payroll rules"
      description="Owner only — the server rejects changes from any other role. Changes affect future runs only."
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="rule-half" label="Half-day factor (0–1)">
            <input id="rule-half" type="number" min="0" max="1" step="0.1" value={halfFactor} onChange={(e) => setHalfFactor(e.target.value)} className={`${inputClass} font-mono`} />
          </Field>
          <Field id="rule-leave" label="Leave paid?">
            <select id="rule-leave" value={leavePaid} onChange={(e) => setLeavePaid(e.target.value)} className={inputClass}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          <Field id="rule-holiday" label="Holiday paid?">
            <select id="rule-holiday" value={holidayPaid} onChange={(e) => setHolidayPaid(e.target.value)} className={inputClass}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
          <Field id="rule-monthly" label="Monthly mode">
            <select id="rule-monthly" value={monthlyMode} onChange={(e) => setMonthlyMode(e.target.value as "fixed" | "prorated")} className={inputClass}>
              <option value="fixed">Fixed</option>
              <option value="prorated">Prorated</option>
            </select>
          </Field>
        </div>
        <Field id="rule-ot" label="Overtime rate / hour" hint="Blank = none.">
          <input id="rule-ot" type="number" min="0" value={otRate} onChange={(e) => setOtRate(e.target.value)} className={`${inputClass} font-mono`} />
        </Field>
        <Field id="rule-reason" label="Reason" required>
          <input id="rule-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} required />
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>{pending ? "Updating…" : "Update rules"}</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
