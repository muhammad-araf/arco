"use client"

/**
 * Cash account add + edit in one modal form (POS pattern: the same
 * form for both, trigger is an Add button or a row Edit button).
 *
 * Replaces the cash-account slots in Masters' generic "Add a master
 * record" form and its generic edit modal, where the kind lived in a
 * second "kind" select and the opening balance in "number 1". Here
 * every field has its real name. Payloads are unchanged: on edit
 * only the name and opening balance are sent — code and kind never
 * change after creation, and are shown read-only on edit.
 */
import * as React from "react"
import { createCashAccount, updateCashAccount } from "@/app/actions/finance"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export interface CashAccountRow {
  id: string
  code: string
  name: string
  account_kind: string
  opening_balance?: number | null
}

export function CashAccountFormDialog({
  open,
  onClose,
  account,
  accounts,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** null = creating a new account; a row = editing it. */
  account: CashAccountRow | null
  accounts: CashAccountRow[]
  onSaved: (notice: string) => void
}) {
  const isEditing = account !== null
  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [kind, setKind] = React.useState<"cash" | "bank" | "online">("cash")
  const [openingBalance, setOpeningBalance] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setCode(account?.code ?? "")
      setName(account?.name ?? "")
      setKind(
        account?.account_kind === "bank" || account?.account_kind === "online"
          ? account.account_kind
          : "cash",
      )
      setOpeningBalance(
        account?.opening_balance != null ? String(account.opening_balance) : "",
      )
      setError("")
      setPending(false)
    }
  }, [open, account])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!isEditing && !code.trim()) return setError("Account code is required.")
    if (!name.trim()) return setError("Account name is required.")
    const opening =
      openingBalance.trim() === "" ? 0 : Number(openingBalance)
    if (!Number.isFinite(opening) || opening < 0)
      return setError("Opening balance cannot be negative.")
    if (
      !isEditing &&
      accounts.some((a) => a.code.trim().toLowerCase() === code.trim().toLowerCase())
    )
      return setError(`A cash account with code "${code.trim()}" already exists. Pick a different code.`)
    setPending(true)
    try {
      const res = isEditing
        ? await updateCashAccount({
            id: account.id,
            name: name.trim(),
            openingBalance: opening,
          })
        : await createCashAccount({
            code: code.trim(),
            name: name.trim(),
            accountKind: kind,
            openingBalance: opening,
          })
      if (!res.success) {
        setError(res.error ?? "Could not save the cash account.")
        return
      }
      onSaved(
        isEditing
          ? `"${name.trim()}" updated.`
          : `"${name.trim()}" created.`,
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
      title={isEditing ? `Edit ${account.code}` : "Add cash account"}
      description={
        isEditing
          ? "Change the name or opening balance. Code and kind never change."
          : "Receipts, payments and paid expenses land in one of these accounts."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field
          id="cash-code"
          label="Code"
          required={!isEditing}
          hint={isEditing ? "Code never changes after creation." : "e.g. CASH-01"}
        >
          <input
            id="cash-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. CASH-01"
            className={`${inputClass} font-mono`}
            disabled={isEditing}
            required={!isEditing}
          />
        </Field>
        <Field id="cash-name" label="Name" required>
          <input
            id="cash-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Main Cash"
            className={inputClass}
            required
          />
        </Field>
        <Field
          id="cash-kind"
          label="Kind"
          required={!isEditing}
          hint={isEditing ? "Kind never changes after creation." : undefined}
        >
          <select
            id="cash-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "cash" | "bank" | "online")}
            className={inputClass}
            disabled={isEditing}
          >
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="online">Online</option>
          </select>
        </Field>
        <Field id="cash-opening" label="Opening balance">
          <input
            id="cash-opening"
            type="number"
            min="0"
            step="0.01"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            placeholder="e.g. 0"
            className={`${inputClass} font-mono`}
          />
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>
              {pending ? "Saving…" : isEditing ? "Save changes" : "Create cash account"}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
