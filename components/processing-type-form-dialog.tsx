"use client"

/**
 * Processing type create dialog (POS pattern, create only).
 *
 * Replaces the processing-type slot in Masters' generic "Add a
 * master record" form, where the kind select had to be switched to
 * "Processing type" before the single name field meant anything.
 * There is deliberately no edit here: no updateProcessingType
 * action exists, and the old table never offered an Edit button
 * for processing types — only Deactivate / Reactivate, which stay
 * on the row. Names are unique (DB constraint), so a duplicate
 * name is caught here instead of only by the server.
 */
import * as React from "react"
import { createProcessingType } from "@/app/actions/processing-types"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export interface ProcessingTypeRow {
  id: string
  name: string
}

export function ProcessingTypeFormDialog({
  open,
  onClose,
  processingTypes,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  processingTypes: ProcessingTypeRow[]
  onSaved: (notice: string) => void
}) {
  const [name, setName] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName("")
      setError("")
      setPending(false)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!name.trim()) return setError("Name is required.")
    if (
      processingTypes.some((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase())
    )
      return setError(`A processing type named "${name.trim()}" already exists. Pick a different name.`)
    setPending(true)
    try {
      const res = await createProcessingType(name.trim())
      if (!res.success) {
        setError(res.error ?? "Could not save the processing type.")
        return
      }
      onSaved(`"${name.trim()}" created.`)
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
      title="Add processing type"
      description="When this list is empty, processing type stays a free-text field."
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field id="pt-name" label="Name" required>
          <input
            id="pt-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Grading"
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
            <span>{pending ? "Saving…" : "Create processing type"}</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
