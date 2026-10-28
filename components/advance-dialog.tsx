"use client"

/** Record an advance for one employee. Previously an inline form above the advances table. */
import * as React from "react"
import { recordAdvance } from "@/app/actions/payroll"
import type { Employee } from "@/lib/types/database"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function AdvanceDialog({
  open,
  onClose,
  employees,
  defaultDate,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  employees: Employee[]
  defaultDate: string
  onSaved: (notice: string) => void
}) {
  const [employeeId, setEmployeeId] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [date, setDate] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setEmployeeId("")
      setAmount("")
      setDate(defaultDate)
      setNotes("")
      setError("")
      setPending(false)
    }
  }, [open, defaultDate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!employeeId) return setError("Select an employee for the advance.")
    if (!(Number(amount) > 0)) return setError("Advance amount must be greater than zero.")
    setPending(true)
    try {
      const res = await recordAdvance({
        employeeId,
        date: date || undefined,
        amount: Number(amount),
        notes: notes.trim() || undefined,
      })
      if (!res.success) {
        setError(res.error ?? "Could not record advance.")
        return
      }
      onSaved("Advance recorded.")
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
      title="Record advance"
      description="Money given to an employee before payday. It is recovered from later payroll runs."
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field id="adv-employee" label="Employee" required>
          <select
            id="adv-employee"
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="adv-amount" label="Amount" required>
            <input
              id="adv-amount"
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 10000"
              className={`${inputClass} font-mono`}
              required
            />
          </Field>
          <Field id="adv-date" label="Date">
            <input
              id="adv-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>
        <Field id="adv-notes" label="Notes">
          <input
            id="adv-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>{pending ? "Recording…" : "Record advance"}</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
