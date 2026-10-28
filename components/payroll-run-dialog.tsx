"use client"

/**
 * Run payroll (creates a draft period). Previously an inline form under
 * a card titled "Finalized Payroll" — the heading described the list
 * below it, not the form — and clicking Run with no employee selected
 * did nothing at all, with no message. Both are fixed here: the form
 * lives in its own modal, and a missing employee is a named error.
 */
import * as React from "react"
import { runPayroll } from "@/app/actions/payroll"
import type { Employee } from "@/lib/types/database"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function PayrollRunDialog({
  open,
  onClose,
  employees,
  defaultMonth,
  defaultYear,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  employees: Employee[]
  defaultMonth: number
  defaultYear: number
  onSaved: (notice: string, warnings: string[]) => void
}) {
  const [employeeId, setEmployeeId] = React.useState("")
  const [month, setMonth] = React.useState("")
  const [year, setYear] = React.useState("")
  const [bonus, setBonus] = React.useState("")
  const [deductions, setDeductions] = React.useState("")
  const [prevBalance, setPrevBalance] = React.useState("")
  const [pieces, setPieces] = React.useState("")
  const [otRate, setOtRate] = React.useState("")
  const [advRecovery, setAdvRecovery] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setEmployeeId("")
      setMonth(defaultMonth ? String(defaultMonth) : "")
      setYear(defaultYear ? String(defaultYear) : "")
      setBonus("")
      setDeductions("")
      setPrevBalance("")
      setPieces("")
      setOtRate("")
      setAdvRecovery("")
      setNotes("")
      setError("")
      setPending(false)
    }
  }, [open, defaultMonth, defaultYear])

  const num = (v: string) => (v.trim() === "" ? undefined : Number(v))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!employeeId) return setError("Select an employee to run payroll for.")
    const m = Number(month)
    const y = Number(year)
    if (!Number.isInteger(m) || m < 1 || m > 12)
      return setError("Month must be between 1 and 12.")
    if (!Number.isInteger(y) || y < 2000 || y > 2100)
      return setError("Enter a valid year.")
    const bonusN = num(bonus) ?? 0
    const dedN = num(deductions) ?? 0
    const advN = num(advRecovery) ?? 0
    if (bonusN < 0 || dedN < 0 || advN < 0)
      return setError("Bonus, deductions and advance recovery cannot be negative.")
    const piecesN = num(pieces)
    if (piecesN !== undefined && (!Number.isFinite(piecesN) || piecesN < 0))
      return setError("Pieces must be >= 0, or left blank.")
    const otN = num(otRate)
    if (otN !== undefined && (!Number.isFinite(otN) || otN < 0))
      return setError("Overtime rate must be >= 0, or left blank to use the configured rate.")
    setPending(true)
    try {
      const res = await runPayroll({
        employeeId,
        month: m,
        year: y,
        bonus: bonusN,
        deductions: dedN,
        previousBalance: num(prevBalance) ?? 0,
        pieces: piecesN,
        overtimeRatePerHour: otN,
        advanceRecoveryRequested: advN,
        notes: notes.trim() || undefined,
      })
      if (!res.success) {
        setError(res.error ?? "Could not run payroll.")
        return
      }
      const warnings = (res.data as any)?.warnings as string[] | undefined
      onSaved(
        "Payroll period created as a draft. Approve it, then pay it.",
        Array.isArray(warnings) ? warnings : [],
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
      title="Run payroll"
      description="Creates a draft period for one employee and month. Approve the draft, then pay it."
      wide
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field id="run-employee" label="Employee" required>
            <select
              id="run-employee"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="run-month" label="Month" required>
            <input
              id="run-month"
              type="number"
              min="1"
              max="12"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={`${inputClass} font-mono`}
              required
            />
          </Field>
          <Field id="run-year" label="Year" required>
            <input
              id="run-year"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={`${inputClass} font-mono`}
              required
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field id="run-bonus" label="Bonus">
            <input id="run-bonus" type="number" min="0" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="0" className={`${inputClass} font-mono`} />
          </Field>
          <Field id="run-deductions" label="Deductions">
            <input id="run-deductions" type="number" min="0" value={deductions} onChange={(e) => setDeductions(e.target.value)} placeholder="0" className={`${inputClass} font-mono`} />
          </Field>
          <Field id="run-prev-balance" label="Previous balance (signed carry-in)">
            <input id="run-prev-balance" type="number" value={prevBalance} onChange={(e) => setPrevBalance(e.target.value)} placeholder="0" className={`${inputClass} font-mono`} />
          </Field>
          <Field id="run-pieces" label="Pieces" hint="Piece-rate only; blank = fallback.">
            <input id="run-pieces" type="number" min="0" value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder="Leave blank if not piece-rate" className={`${inputClass} font-mono`} />
          </Field>
          <Field id="run-ot-rate" label="Overtime rate / hour" hint="Blank = configured rate.">
            <input id="run-ot-rate" type="number" min="0" value={otRate} onChange={(e) => setOtRate(e.target.value)} placeholder="Leave blank to use configured rate" className={`${inputClass} font-mono`} />
          </Field>
          <Field id="run-adv-recovery" label="Advance recovery requested">
            <input id="run-adv-recovery" type="number" min="0" value={advRecovery} onChange={(e) => setAdvRecovery(e.target.value)} placeholder="0" className={`${inputClass} font-mono`} />
          </Field>
        </div>
        <Field id="run-notes" label="Notes">
          <input id="run-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>{pending ? "Running…" : "Run payroll (draft)"}</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
