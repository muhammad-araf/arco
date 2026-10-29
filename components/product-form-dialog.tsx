"use client"

/**
 * Product add + edit in one modal form (POS pattern: the same form
 * for both, trigger is an Add button or a row Edit button).
 *
 * Replaces Masters' hand-rolled "Add Product Master" modal and the
 * product slot of its generic edit modal. It uses the shared Modal
 * and Field kit instead of a second copy of the modal shell.
 *
 * Two behaviours of the old forms are preserved exactly, not
 * smoothed over:
 * - Product codes are generated, never typed: on create the dialog
 *   builds the same `PRD-<NAME>-<last 4 of timestamp>` draft the
 *   old form built and hands it to the page, which still asks for
 *   confirmation before calling createProduct. The dialog stays
 *   open behind that confirmation, so cancelling it keeps the
 *   typed values (as the old modal did).
 * - Validation differs between create and edit, as it did: create
 *   requires a bag weight greater than zero and rejects a duplicate
 *   product name; edit allows a zero bag weight and has no
 *   duplicate-name check (the old edit modal had neither).
 * On edit the code is shown read-only (the old edit modal showed
 * no code at all); it is never sent to updateProduct.
 */
import * as React from "react"
import { updateProduct } from "@/app/actions/masters"
import type { Product } from "@/lib/types/database"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

const CATEGORIES = [
  { value: "raw_seed", label: "Raw Seed" },
  { value: "finished_seed", label: "Finished Seed" },
  { value: "intermediate", label: "Intermediate / Grading" },
  { value: "by_product", label: "By-Product (Phok/Chhilka)" },
] as const

export function ProductFormDialog({
  open,
  onClose,
  product,
  products,
  onSaved,
  onCreateDraft,
}: {
  open: boolean
  onClose: () => void
  /** null = creating a new product; a row = editing it. */
  product: Product | null
  products: Product[]
  onSaved: (notice: string) => void
  /** Create only: receives the generated-code draft for confirmation. */
  onCreateDraft: (draft: Product) => void
}) {
  const isEditing = product !== null
  const [name, setName] = React.useState("")
  const [category, setCategory] = React.useState<string>("raw_seed")
  const [weightPerBag, setWeightPerBag] = React.useState("")
  const [minStock, setMinStock] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName(product?.name ?? "")
      setCategory(product?.category ?? "raw_seed")
      setWeightPerBag(
        product?.weight_per_bag != null ? String(product.weight_per_bag) : "50",
      )
      setMinStock(
        product?.min_stock != null ? String(product.min_stock) : "2000",
      )
      setError("")
      setPending(false)
    }
  }, [open, product])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    if (!name.trim()) return setError("Product name is required.")
    // Blank means 0 on edit (as the old form's number state did) and
    // is rejected on create, where the bag weight must be positive.
    const weight = weightPerBag.trim() === ""
      ? (isEditing ? 0 : NaN)
      : Number(weightPerBag)
    const min = minStock.trim() === "" ? 0 : Number(minStock)
    if (!Number.isFinite(weight) || weight < 0)
      return setError("Standard bag weight cannot be negative.")
    if (!isEditing && weight <= 0)
      return setError("Standard bag weight must be greater than zero.")
    if (!Number.isFinite(min) || min < 0)
      return setError("Minimum safety stock cannot be negative.")
    if (
      !isEditing &&
      products.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())
    )
      return setError(`A product named "${name.trim()}" already exists. Pick a different name instead of duplicating the master.`)
    if (!isEditing) {
      // Same generated code as the old form; the page confirms
      // before creating, and this dialog stays open meanwhile.
      onCreateDraft({
        id: `prod-${Date.now()}`,
        code: `PRD-${name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 12)}-${Date.now().toString().slice(-4)}`,
        name: name.trim(),
        category: category as Product["category"],
        default_unit: "kg",
        weight_per_bag: weight,
        min_stock: min,
        is_active: true,
        created_at: new Date().toISOString(),
      })
      return
    }
    setPending(true)
    try {
      const res = await updateProduct(product.id, {
        name: name.trim(),
        category: category,
        weight_per_bag: weight,
        min_stock: min,
      })
      if (!res.success) {
        setError(res.error ?? "Could not save the product.")
        return
      }
      onSaved(`"${name.trim()}" updated.`)
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
      title={isEditing ? `Edit ${product.code}` : "Add Product Master"}
      description={
        isEditing
          ? "Change the details below. The code never changes."
          : "A seed product. It appears in Inward, Production, Gate Pass and Purchases."
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        {isEditing && (
          <Field
            id="prod-code"
            label="Code"
            hint="Code never changes after creation."
          >
            <input
              id="prod-code"
              type="text"
              value={product.code}
              className={`${inputClass} font-mono`}
              disabled
              readOnly
            />
          </Field>
        )}
        <Field id="prod-name" label="Product title" required>
          <input
            id="prod-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Graded Hybrid Corn (DK-6789)"
            className={inputClass}
            required
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="prod-category" label="Category">
            <select
              id="prod-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="prod-bag" label="Standard bag (kg)" required={!isEditing}>
            <input
              id="prod-bag"
              type="number"
              min="0"
              value={weightPerBag}
              onChange={(e) => setWeightPerBag(e.target.value)}
              placeholder="e.g. 50"
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>
        <Field id="prod-min-stock" label="Minimum safety stock (kg)">
          <input
            id="prod-min-stock"
            type="number"
            min="0"
            value={minStock}
            onChange={(e) => setMinStock(e.target.value)}
            placeholder="e.g. 2000"
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
              {pending ? "Saving…" : isEditing ? "Save changes" : "Create Product"}
            </span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
