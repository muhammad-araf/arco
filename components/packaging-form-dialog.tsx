"use client"

/**
 * Packaging type add + edit in one modal form (POS pattern: the same
 * form for both, trigger is an Add button or a row Edit button).
 *
 * Replaces the packaging slots in Masters' generic "Add a master
 * record" form and its generic edit modal, where capacity lived in
 * "number 1" and cost per bag in "number 2". Here every field has
 * its real name. Payloads are unchanged: on create a blank/zero
 * capacity or cost becomes undefined (as the old form's
 * `|| undefined` did); on edit a blank value submits 0 (as the old
 * form's number state did). Stock is deliberately not editable here
 * — the old forms never exposed it either; it moves through packing
 * records and purchases.
 */
import * as React from "react"
import { createPackagingType, updatePackagingType } from "@/app/actions/masters"
import type { PackagingType } from "@/lib/types/database"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export function PackagingFormDialog({
  open,
  onClose,
  packagingType,
  packagingTypes,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** null = creating a new packaging type; a row = editing it. */
  packagingType: PackagingType | null
  packagingTypes: PackagingType[]
  onSaved: (notice: string) => void
}) {
  const isEditing = packagingType !== null
  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [capacity, setCapacity] = React.useState("")
  const [costPerBag, setCostPerBag] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setCode(packagingType?.code ?? "")
      setName(packagingType?.name ?? "")
      setCapacity(
        packagingType?.capacity_kg != null ? String(packagingType.capacity_kg) : "",
      )
      setCostPerBag(
        packagingType?.cost_per_bag != null ? String(packagingType.cost_per_bag) : "",
      )
      setError("")
      setPending(false)
    }
  }, [open, packagingType])

  const parseNonNegative = (raw: string): number | null => {
    if (raw.trim() === "") return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : NaN
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!isEditing && !code.trim()) return setError("Packaging code is required.")
    if (!name.trim()) return setError("Packaging name is required.")
    const capacityNum = parseNonNegative(capacity)
    const costNum = parseNonNegative(costPerBag)
    if (Number.isNaN(capacityNum) || Number.isNaN(costNum))
      return setError("Numbers cannot be negative.")
    if (
      !isEditing &&
      packagingTypes.some((p) => p.code.trim().toLowerCase() === code.trim().toLowerCase())
    )
      return setError(`A packaging type with code "${code.trim()}" already exists. Pick a different code.`)
    setPending(true)
    try {
      const res = isEditing
        ? await updatePackagingType(packagingType.id, {
            name: name.trim(),
            capacity_kg: capacityNum ?? 0,
            cost_per_bag: costNum ?? 0,
          })
        : await createPackagingType({
            code: code.trim(),
            name: name.trim(),
            capacity_kg: capacityNum || undefined,
            cost_per_bag: costNum || undefined,
          })
      if (!res.success) {
        setError(res.error ?? "Could not save the packaging type.")
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
      title={isEditing ? `Edit ${packagingType.code}` : "Add packaging type"}
      description={
        isEditing
          ? "Change the details below. The code never changes."
          : "A bag or pack used when seed is packed. It appears in Packing."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field
          id="pkg-code"
          label="Code"
          required={!isEditing}
          hint={isEditing ? "Code never changes after creation." : "e.g. BAG-50PP"}
        >
          <input
            id="pkg-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. BAG-50PP"
            className={`${inputClass} font-mono`}
            disabled={isEditing}
            required={!isEditing}
          />
        </Field>
        <Field id="pkg-name" label="Name" required>
          <input
            id="pkg-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 50kg PP Bag"
            className={inputClass}
            required
          />
        </Field>
        <Field
          id="pkg-capacity"
          label="Capacity (kg)"
          hint={isEditing ? "Leave blank to set 0." : "Leave blank for no set capacity."}
        >
          <input
            id="pkg-capacity"
            type="number"
            min="0"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="e.g. 50"
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field
          id="pkg-cost"
          label="Cost per bag"
          hint={isEditing ? "Leave blank to set 0." : "Leave blank for no set cost."}
        >
          <input
            id="pkg-cost"
            type="number"
            min="0"
            step="0.01"
            value={costPerBag}
            onChange={(e) => setCostPerBag(e.target.value)}
            placeholder="e.g. 45"
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
              {pending ? "Saving…" : isEditing ? "Save changes" : "Create packaging type"}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
