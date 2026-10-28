"use client"

/**
 * Inter-godown transfer, POS-style: one modal form that owns its own
 * state, instead of ~15 useState fields spread across the Stock page.
 *
 * What the old modal hid, this one shows before submit:
 * - every picker starts empty — nothing is silently pre-selected;
 * - the destination list never contains the source godown;
 * - available stock, bags equivalent and stock left after the move are
 *   shown live, so "insufficient stock" is caught here, not after a
 *   confirm click;
 * - quantity, reason and both godowns are marked required.
 * The create → post sequence and the exact-once token are unchanged.
 */
import * as React from "react"
import { ArrowRightLeft, CheckCircle2 } from "lucide-react"
import { createTransfer, postTransfer } from "@/app/actions/inventory"
import { postToken } from "@/lib/idempotency"
import type { Godown, Party, Product } from "@/lib/types/database"
import { formatWeight } from "@/lib/utils"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  GodownSelect,
  Modal,
  godownLabel,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export type StockSummaryRow = {
  godown_id: string
  product_id: string
  party_id?: string | null
  balance_kg?: number
}

export function InventoryTransferDialog({
  open,
  onClose,
  godowns,
  products,
  parties,
  summary,
  onPosted,
}: {
  open: boolean
  onClose: () => void
  godowns: Godown[]
  products: Product[]
  parties: Party[]
  summary: StockSummaryRow[]
  onPosted: (notice: string) => void
}) {
  const [fromId, setFromId] = React.useState("")
  const [toId, setToId] = React.useState("")
  const [productId, setProductId] = React.useState("")
  const [ownerId, setOwnerId] = React.useState("")
  const [qty, setQty] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [reviewing, setReviewing] = React.useState(false)
  const guard = React.useRef(false)

  React.useEffect(() => {
    if (open) {
      setFromId("")
      setToId("")
      setProductId("")
      setOwnerId("")
      setQty("")
      setNotes("")
      setError("")
      setPending(false)
      setReviewing(false)
    }
  }, [open ])

  const product = products.find((p) => p.id === productId)
  const available = Number(
    summary.find(
      (r) =>
        r.product_id === productId &&
        r.godown_id === fromId &&
        (r.party_id ?? null) === (ownerId || null),
    )?.balance_kg ?? 0,
  )
  const qtyNum = Number(qty)
  const bagKg = product?.weight_per_bag || 0
  const bags = (kg: number) =>
    bagKg > 0 ? ` (≈ ${(kg / bagKg).toFixed(1)} bags of ${bagKg} kg)` : ""
  const qtyError =
    qty !== "" && (!Number.isFinite(qtyNum) || qtyNum <= 0)
      ? "Quantity must be greater than zero."
      : qty !== "" && qtyNum > available && fromId && productId
        ? `Only ${formatWeight(available)} available in the source godown. Reduce the quantity.`
        : ""

  const validate = (): string | null => {
    if (!productId || !fromId || !toId)
      return "Select a product and both godowns for the transfer."
    if (fromId === toId) return "Source and destination must be different."
    if (!Number.isFinite(qtyNum) || qtyNum <= 0)
      return "Transfer quantity must be greater than zero."
    if (qtyNum > available)
      return `Insufficient stock in the source godown: ${formatWeight(available)} available, but ${formatWeight(qtyNum)} requested. Reduce the quantity.`
    if (!notes.trim()) return "A reason is required. Write why this stock is moving."
    return null
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    const problem = validate()
    if (problem) return setError(problem)
    setError("")
    setReviewing(true)
  }

  const handleExecute = async () => {
    if (guard.current) return
    guard.current = true
    setPending(true)
    try {
      const created = await createTransfer({
        fromGodownId: fromId,
        toGodownId: toId,
        productId,
        quantityKg: qtyNum,
        reason: notes.trim(),
        notes: notes.trim(),
        partyId: ownerId || undefined,
      })
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not create the transfer draft.")
        setReviewing(false)
        return
      }
      const posted = await postTransfer(
        (created.data as any).id,
        postToken("transfer:post", (created.data as any).id),
      )
      if (!posted.success) {
        setError(posted.error ?? "Could not post the transfer.")
        setReviewing(false)
        return
      }
      onPosted(
        `Transfer posted — ${formatWeight(qtyNum)} moved from ${godownLabel(godowns, fromId)} to ${godownLabel(godowns, toId)}. Enterprise total unchanged.`,
      )
      onClose()
    } finally {
      setPending(false)
      guard.current = false
    }
  }

  if (!open) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Move stock between godowns"
      description="Stock leaves one godown and enters another. Total stock does not change."
    >
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      {reviewing ? (
        <div className="space-y-4 text-xs">
          <dl className="space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Product</dt>
              <dd className="font-bold text-foreground text-right">{product?.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">From</dt>
              <dd className="font-bold text-foreground text-right">{godownLabel(godowns, fromId)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">To</dt>
              <dd className="font-bold text-foreground text-right">{godownLabel(godowns, toId)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Stock owner</dt>
              <dd className="font-bold text-foreground text-right">
                {parties.find((p) => p.id === ownerId)?.name ?? "Company stock"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Quantity</dt>
              <dd className="font-bold text-foreground text-right">
                {formatWeight(qtyNum)}
                {bags(qtyNum)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Left in source</dt>
              <dd className="font-bold text-foreground text-right">
                {formatWeight(available - qtyNum)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Reason</dt>
              <dd className="font-bold text-foreground text-right">{notes.trim()}</dd>
            </div>
          </dl>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={() => setReviewing(false)} className={secondaryButtonClass}>
              Back
            </button>
            <button type="button" onClick={handleExecute} disabled={pending} className={primaryButtonClass}>
              {pending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{pending ? "Executing…" : "Execute Transfer"}</span>
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <Field id="transfer-product" label="Product" required>
            <select
              id="transfer-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GodownSelect
              id="transfer-from"
              label="From (source)"
              value={fromId}
              onChange={(v) => {
                setFromId(v)
                if (v === toId) setToId("")
              }}
              godowns={godowns}
              required
            />
            <GodownSelect
              id="transfer-to"
              label="To (destination)"
              value={toId}
              onChange={setToId}
              godowns={godowns}
              excludeId={fromId || undefined}
              required
              hint={fromId ? "The source godown is hidden here." : undefined}
            />
          </div>
          <Field id="transfer-owner" label="Stock owner">
            <select
              id="transfer-owner"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className={inputClass}
            >
              <option value="">Company stock</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="transfer-qty"
            label="Quantity (kg)"
            required
            error={qtyError || undefined}
            hint={
              !qtyError && fromId && productId
                ? `Available in source: ${formatWeight(available)}${bags(available)}.${qty !== "" && Number.isFinite(qtyNum) && qtyNum > 0 ? ` After transfer: ${formatWeight(available - qtyNum)} left.` : ""}`
                : !fromId || !productId
                  ? "Pick a product and source godown first to see available stock."
                  : undefined
            }
          >
            <input
              id="transfer-qty"
              type="number"
              min="0"
              step="0.01"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="e.g. 500"
              className={`${inputClass} font-mono`}
              required
            />
          </Field>
          <Field id="transfer-notes" label="Reason" required hint="Why is this stock moving?">
            <input
              id="transfer-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Moving lot to Plant A"
              className={inputClass}
              required
            />
          </Field>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={primaryButtonClass}>
              <ArrowRightLeft className="h-4 w-4" />
              <span>Review Transfer</span>
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
