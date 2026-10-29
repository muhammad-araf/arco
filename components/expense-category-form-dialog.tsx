"use client"

/**
 * Expense category add + edit in one modal form (POS pattern: the
 * same form for both, trigger is an Add button or a row Edit button).
 *
 * Replaces the expense-category slots in Masters' generic "Add a
 * master record" form and its generic edit modal. Expense categories
 * have no code — just a name and an optional description. Payloads
 * are unchanged: on create a blank description becomes undefined;
 * on edit it becomes null (exactly what the old form passed).
 */
import * as React from "react"
import { createExpenseCategory, updateExpenseCategory } from "@/app/actions/finance"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export interface ExpenseCategoryRow {
  id: string
  name: string
  description?: string | null
}

export function ExpenseCategoryFormDialog({
  open,
  onClose,
  category,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** null = creating a new category; a row = editing it. */
  category: ExpenseCategoryRow | null
  onSaved: (notice: string) => void
}) {
  const isEditing = category !== null
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName(category?.name ?? "")
      setDescription(category?.description ?? "")
      setError("")
      setPending(false)
    }
  }, [open, category])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!name.trim()) return setError("Name is required.")
    setPending(true)
    try {
      const res = isEditing
        ? await updateExpenseCategory({
            id: category.id,
            name: name.trim(),
            description: description.trim() || null,
          })
        : await createExpenseCategory({
            name: name.trim(),
            description: description.trim() || undefined,
          })
      if (!res.success) {
        setError(res.error ?? "Could not save the expense category.")
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
      title={isEditing ? `Edit ${category.name}` : "Add expense category"}
      description={
        isEditing
          ? "Change the name or description."
          : "Categories for Daybook expenses. They appear in the Daybook expense form."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field id="exp-name" label="Name" required>
          <input
            id="exp-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Transport"
            className={inputClass}
            required
          />
        </Field>
        <Field id="exp-description" label="Description">
          <input
            id="exp-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Truck hire and fuel"
            className={inputClass}
          />
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>
              {pending ? "Saving…" : isEditing ? "Save changes" : "Create expense category"}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
