"use client"

/**
 * Stock correction, POS-style: one modal form that owns its own state,
 * instead of an inline form buried on the Adjustments tab.
 *
 * Quantity-after stays blank on purpose (a careless submit must never
 * zero stock), and the form shows the current balance and the change
 * (+/− kg) live before anything posts. Create → post sequence and the
 * exact-once token are unchanged.
 */
import * as React from "react"
import { CheckCircle2 } from "lucide-react"
import { createAdjustment, postAdjustment } from "@/app/actions/inventory"
import { postToken } from "@/lib/idempotency"
import type { Godown, Party, Product } from "@/lib/types/database"
import { formatWeight } from "@/lib/utils"
import { SubmitSpinner } from "@/components/erp-ui"
import {
  Field,
  GodownSelect,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"
import type { StockSummaryRow } from "@/components/inventory-transfer-dialog"

export function InventoryAdjustmentDialog({
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
  const [godownId, setGodownId] = React.useState("")
  const [productId, setProductId] = React.useState("")
  const [ownerId, setOwnerId] = React.useState("")
  const [after, setAfter] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [approver, setApprover] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const guard = React.useRef(false)

  React.useEffect(() => {
    if (open) {
      setGodownId("")
      setProductId("")
      setOwnerId("")
      setAfter("")
      setReason("")
      setApprover("")
      setError("")
      setPending(false)
    }
  }, [open])

  const before = Number(
    summary.find(
      (r) =>
        r.product_id === productId &&
        r.godown_id === godownId &&
        (r.party_id ?? null) === (ownerId || null),
    )?.balance_kg ?? 0,
  )
  const afterNum = Number(after)
  const hasAfter = after !== "" && Number.isFinite(afterNum)
  const diff = hasAfter ? afterNum - before : 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending || guard.current) return
    if (!godownId || !productId)
      return setError("Select a godown and product for the adjustment.")
    if (!hasAfter || afterNum < 0)
      return setError("Enter the quantity after (kg) — it is left blank on purpose so a careless submit cannot zero stock.")
    if (!reason.trim()) return setError("An adjustment reason is required.")
    if (!approver.trim()) return setError("An approver is required for a stock adjustment.")
    guard.current = true
    setPending(true)
    try {
      const created = await createAdjustment({
        godownId,
        productId,
        quantityBeforeKg: before,
        quantityAfterKg: afterNum,
        reason: reason.trim(),
        approver: approver.trim(),
        partyId: ownerId || undefined,
      })
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not create the adjustment.")
        return
      }
      const posted = await postAdjustment(
        (created.data as any).id,
        postToken("adjustment:post", (created.data as any).id),
      )
      if (!posted.success) {
        setError(posted.error ?? "Could not post the adjustment.")
        return
      }
      onPosted(
        `Stock adjustment posted: ${formatWeight(before)} → ${formatWeight(afterNum)}, approved by ${approver.trim()}.`,
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
      title="Correct stock"
      description="Set the counted quantity for one godown and product. The difference is posted as an adjustment."
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <GodownSelect
          id="adj-godown"
          label="Godown"
          value={godownId}
          onChange={setGodownId}
          godowns={godowns}
          required
        />
        <Field id="adj-product" label="Product" required>
          <select
            id="adj-product"
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
        <Field id="adj-owner" label="Stock owner">
          <select
            id="adj-owner"
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
        {godownId && productId && (
          <p className="text-xs text-muted-foreground">
            Current balance: <span className="font-bold text-foreground">{formatWeight(before)}</span>
            {hasAfter && (
              <>
                {" "}→ new: <span className="font-bold text-foreground">{formatWeight(afterNum)}</span>
                {" "}({diff >= 0 ? "+" : ""}{formatWeight(diff)})
              </>
            )}
          </p>
        )}
        <Field
          id="adj-after"
          label="Quantity after (kg)"
          required
          hint="Counted quantity. Leave it blank and nothing posts."
        >
          <div className="flex gap-2">
            <input
              id="adj-after"
              type="number"
              min="0"
              step="0.01"
              value={after}
              onChange={(e) => setAfter(e.target.value)}
              placeholder="Counted kg"
              className={`${inputClass} font-mono flex-1`}
              required
            />
            <button
              type="button"
              onClick={() => setAfter(String(before))}
              className="px-2 py-2 rounded-lg bg-muted text-muted-foreground text-[11px] font-semibold cursor-pointer"
              title="Fill with the current balance"
            >
              Use current
            </button>
          </div>
        </Field>
        <Field id="adj-reason" label="Reason" required>
          <input
            id="adj-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Physical recount variance"
            className={inputClass}
            required
          />
        </Field>
        <Field id="adj-approver" label="Approver" required>
          <input
            id="adj-approver"
            type="text"
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="Approver name"
            className={inputClass}
            required
          />
        </Field>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
            <span>{pending ? "Posting…" : "Post Adjustment"}</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
