"use client"

/**
 * Pay a payroll period. This form did not exist before: the page kept
 * amount / account / method / date / reference state, but rendered no
 * inputs for any of them — clicking Pay only opened a confirmation
 * dialog, with the amount fixed at the full balance and the account
 * silently set to the first cash account. Partial payments were
 * therefore impossible from the UI, and the "selected" account was
 * never actually selected. This dialog is the missing form: amount
 * (editable, capped at the balance), account (explicit choice,
 * required), method, date and reference, with the balance-after
 * shown live.
 */
import * as React from "react"
import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"
import { payPayroll } from "@/app/actions/payroll"
import { formatCurrency } from "@/lib/utils"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function PayrollPayDialog({
  open,
  onClose,
  period,
  employeeName,
  cashAccounts,
  defaultDate,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  period: any | null
  employeeName: string
  cashAccounts: any[]
  defaultDate: string
  onSaved: (notice: string) => void
}) {
  const [amount, setAmount] = React.useState("")
  const [accountId, setAccountId] = React.useState("")
  const [method, setMethod] = React.useState("cash")
  const [date, setDate] = React.useState("")
  const [ref, setRef] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const tokenRef = React.useRef<string | null>(null)

  const balance = Number(period?.balance_amount || 0)
  const amountNum = Number(amount)
  const balanceAfter = Number.isFinite(amountNum) && amountNum > 0
    ? Math.max(0, balance - amountNum)
    : balance

  React.useEffect(() => {
    if (open && period) {
      setAmount(String(balance))
      setAccountId("")
      setMethod("cash")
      setDate(defaultDate)
      setRef("")
      setError("")
      setPending(false)
    }
  }, [open, period, balance, defaultDate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!period || pending) return
    if (!(amountNum > 0)) return setError("Payment amount must be greater than zero.")
    if (amountNum > balance)
      return setError("Payment exceeds the unpaid balance — partial payments must be within the balance.")
    if (!accountId) return setError("Select the cash account this payment comes from.")
    const acct = cashAccounts.find((a: any) => a.id === accountId)
    setPending(true)
    try {
      const res = await payPayroll({
        payrollId: period.id,
        amount: amountNum,
        date: date || undefined,
        paymentMethod: method,
        cashAccountId: accountId,
        account: (acct?.account_kind ?? "cash") as "cash" | "bank" | "online",
        referenceNo: ref.trim() || undefined,
        clientToken: submissionToken(tokenRef, "payrollpay"),
      })
      if (!res.success) {
        setError(res.error ?? "Could not pay payroll.")
        return
      }
      onSaved(
        `Payroll payment of ${formatCurrency(amountNum)} recorded from ${acct?.name ?? "the selected account"}.`,
      )
      resetSubmissionToken(tokenRef)
      onClose()
    } finally {
      setPending(false)
    }
  }

  if (!open || !period) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pay payroll"
      description={`${employeeName} — ${period.month}/${period.year}. Balance due: ${formatCurrency(balance)}.`}
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field
          id="pay-amount"
          label="Amount"
          required
          hint={`Balance after payment: ${formatCurrency(balanceAfter)}.`}
        >
          <input
            id="pay-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} font-mono`}
            required
          />
        </Field>
        <Field id="pay-account" label="Cash account" required>
          <select
            id="pay-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select account</option>
            {cashAccounts.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="pay-method" label="Method">
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={inputClass}
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="online">Online</option>
            </select>
          </Field>
          <Field id="pay-date" label="Date">
            <input
              id="pay-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>
        <Field id="pay-ref" label="Reference">
          <input
            id="pay-ref"
            type="text"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="e.g. cheque or transfer number"
            className={inputClass}
          />
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>{pending ? "Paying…" : "Pay"}</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
