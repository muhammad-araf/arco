"use client"

/**
 * Gate pass partial-return dialog on the shared Modal kit.
 *
 * Moved verbatim from the Gate Pass page's hand-rolled return modal:
 * same lines, same validation, same returnGatePass payload. One fix:
 * validation/server errors used to go to the page banner, which sits
 * behind this modal and was invisible while it was open — they now
 * show in the dialog's own banner, with the dialog staying open so
 * nothing typed is lost.
 */
import * as React from "react"
import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"
import { returnGatePass } from "@/app/actions/gatepass"
import { AlertBanner, SubmitSpinner } from "@/components/erp-ui"
import { Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/erp-form"

export type GatePassReturnLine = {
  productId: string
  productName: string
  partyId: string | null
  ownerName: string
  remainingKg: number
  qtyKg: number
  condition: string
  restockDecision: "accepted" | "rejected"
}

export function GatePassReturnDialog({
  open,
  target,
  initialLines,
  onClose,
  onSaved,
}: {
  open: boolean
  target: { id: string; pass_no: string } | null
  initialLines: GatePassReturnLine[]
  onClose: () => void
  /** Page sets the notice banner and reloads the register. */
  onSaved: (notice: string) => Promise<void> | void
}) {
  const [lines, setLines] = React.useState<GatePassReturnLine[]>([])
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const returnTokenRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLines(initialLines)
    setReason("")
    setError("")
    setPending(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const handlePartialReturn = async () => {
    if (!target || pending) return
    if (!reason.trim()) {
      setError("A return reason is required.")
      return
    }
    const entries = lines.filter((l) => Number(l.qtyKg) > 0)
    if (!entries.length) {
      setError("Enter a return quantity greater than zero on at least one line.")
      return
    }
    for (const l of entries) {
      if (Number(l.qtyKg) > l.remainingKg) {
        setError(`Return for ${l.productName} (${l.ownerName}) exceeds the ${l.remainingKg} kg still returnable.`)
        return
      }
    }
    setPending(true)
    try {
      const res = await returnGatePass(
        target.id,
        {
          reason: reason.trim(),
          items: entries.map((l) => ({
            productId: l.productId,
            qtyKg: Number(l.qtyKg),
            partyId: l.partyId,
            condition: l.condition.trim() || undefined,
            restockDecision: l.restockDecision,
          })),
        },
        submissionToken(returnTokenRef, "gatepass-return"),
      )
      if (!res.success) {
        setError(res.error ?? "Could not return the gate pass.")
        return
      }
      const newStatus = (res.data as any)?.status
      const rejectedKg = entries.filter((l) => l.restockDecision === "rejected").reduce((s, l) => s + (Number(l.qtyKg) || 0), 0)
      await onSaved(
        `${target.pass_no} ${newStatus === "returned" ? "returned in full" : "partially returned"} — stock restored for the accepted quantities${rejectedKg > 0 ? `; ${rejectedKg} kg rejected and not returned to stock` : ""}.`,
      )
      resetSubmissionToken(returnTokenRef)
      onClose()
    } finally {
      setPending(false)
    }
  }

  if (!open || !target) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Return ${target.pass_no}`}
      description="Reduce a quantity for a partial return. The remainder stays returnable, and the pass stays reversible until it is fully returned. Only quantities marked Accepted return to stock — Rejected quantities are recorded but never restocked."
    >
      <div className="space-y-4 text-xs">
        <AlertBanner tone="error" message={error} onDismiss={() => setError("")} />
        <div className="space-y-2">
          {lines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 rounded-lg bg-muted border border-border items-start">
              <div><div className="font-bold text-foreground">{line.productName}</div><div className="text-muted-foreground">Owner: {line.ownerName}</div></div>
              <div className="text-muted-foreground">Still returnable: <strong className="text-foreground">{line.remainingKg} kg</strong></div>
              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`return-qty-kg-${idx}`}>Return qty (kg) *</label>
                <input id={`return-qty-kg-${idx}`} type="number" min="0" max={line.remainingKg} value={line.qtyKg} onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, qtyKg: Number(e.target.value) } : l)))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" />
              </div>
              <div className="text-muted-foreground">Left after return: <strong className="text-foreground">{Math.max(0, Math.round((line.remainingKg - (Number(line.qtyKg) || 0)) * 100) / 100)} kg</strong></div>
              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`return-condition-${idx}`}>Condition</label>
                <input id={`return-condition-${idx}`} type="text" value={line.condition} onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, condition: e.target.value } : l)))} placeholder="e.g. good, damaged" className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground" />
              </div>
              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`return-decision-${idx}`}>Restock decision</label>
                <select id={`return-decision-${idx}`} value={line.restockDecision} onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, restockDecision: e.target.value as "accepted" | "rejected" } : l)))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground">
                  <option value="accepted">Accepted — back to stock</option>
                  <option value="rejected">Rejected — not restocked</option>
                </select>
              </div>
            </div>
          ))}
        </div>
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="return-reason">Return reason *</label>
          <input id="return-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this stock coming back?" className={inputClass} required />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
          <button type="button" onClick={handlePartialReturn} disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>{pending ? "Returning…" : "Confirm Return"}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
