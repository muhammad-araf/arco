"use client"

/**
 * Godown add + edit in one modal form (POS pattern: the same form for
 * both, trigger is an Add button or a row Edit button).
 *
 * This replaces the godown slots in Masters' generic "Add a master
 * record" form, where a godown's address lived in a field called
 * "extra" and its capacity in a field called "number 1" — shared with
 * machines and packaging types, so the labels changed meaning per kind.
 * Here every field has its real name, an example, and a plain hint:
 * code is required and never changes after creation, capacity is
 * optional (blank = no set limit on create, keep current on edit).
 */
import * as React from "react"
import { createGodown, updateGodown } from "@/app/actions/masters"
import type { Godown } from "@/lib/types/database"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function GodownFormDialog({
  open,
  onClose,
  godown,
  godowns,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** null = creating a new godown; a row = editing it. */
  godown: Godown | null
  godowns: Godown[]
  onSaved: (notice: string) => void
}) {
  const isEditing = godown !== null
  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [capacity, setCapacity] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setCode(godown?.code ?? "")
      setName(godown?.name ?? "")
      setAddress(godown?.address ?? "")
      setCapacity(
        godown?.capacity_metric_tons != null
          ? String(godown.capacity_metric_tons)
          : "",
      )
      setError("")
      setPending(false)
    }
  }, [open, godown])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!isEditing && !code.trim()) return setError("Godown code is required.")
    if (!name.trim()) return setError("Godown name is required.")
    const capacityNum = capacity.trim() === "" ? undefined : Number(capacity)
    if (capacityNum !== undefined && (!Number.isFinite(capacityNum) || capacityNum < 0))
      return setError("Capacity cannot be negative.")
    if (
      !isEditing &&
      godowns.some((g) => g.code.trim().toLowerCase() === code.trim().toLowerCase())
    )
      return setError(`A godown with code "${code.trim()}" already exists. Pick a different code.`)
    setPending(true)
    try {
      const res = isEditing
        ? await updateGodown(godown.id, {
            name: name.trim(),
            address: address.trim() || undefined,
            // Blank on edit keeps the current capacity (updateRow
            // skips undefined); blank on create means no set limit.
            capacity_metric_tons: capacityNum,
          })
        : await createGodown({
            code: code.trim(),
            name: name.trim(),
            address: address.trim() || undefined,
            capacity_metric_tons: capacityNum,
          })
      if (!res.success) {
        setError(res.error ?? "Could not save the godown.")
        return
      }
      onSaved(
        isEditing
          ? `"${name.trim()}" updated.`
          : `"${name.trim()}" created (${code.trim()}) and available in every godown list.`,
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
      title={isEditing ? `Edit ${godown.code}` : "Add godown"}
      description={
        isEditing
          ? "Change the name, address or capacity. The code never changes."
          : "A storage location for seed stock. It appears in Inward, Stock, Gate Pass and Production."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field
          id="godown-code"
          label="Godown code"
          required={!isEditing}
          hint={isEditing ? "Code never changes after creation." : "Short code, shown in lists. e.g. GD-01"}
        >
          <input
            id="godown-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. GD-01"
            className={`${inputClass} font-mono`}
            disabled={isEditing}
            required={!isEditing}
          />
        </Field>
        <Field id="godown-name" label="Godown name" required>
          <input
            id="godown-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Main Seed Godown"
            className={inputClass}
            required
          />
        </Field>
        <Field id="godown-address" label="Address / compound">
          <input
            id="godown-address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. Plot 12, Grain Market Road"
            className={inputClass}
          />
        </Field>
        <Field
          id="godown-capacity"
          label="Capacity (MT)"
          hint={
            isEditing
              ? "Leave blank to keep the current capacity."
              : "Leave blank for no set limit."
          }
        >
          <input
            id="godown-capacity"
            type="number"
            min="0"
            step="0.01"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="e.g. 500"
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
              {pending ? "Saving…" : isEditing ? "Save changes" : "Create godown"}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
