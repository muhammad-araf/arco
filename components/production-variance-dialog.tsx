"use client"

/**
 * Production variance-reason dialog on the shared Modal kit.
 *
 * Moved verbatim from the Production page's hand-rolled variance
 * modal: same field, same validation, same setBatchVarianceReason +
 * postBatch sequence. One fix: errors used to go to the page banner,
 * which sits behind this modal and was invisible while it was open —
 * they now show in the dialog's own banner, with the dialog staying
 * open so the typed reason is not lost.
 */
import * as React from "react"
import { postToken } from "@/lib/idempotency"
import { postBatch, setBatchVarianceReason } from "@/app/actions/production"
import { AlertBanner, SubmitSpinner } from "@/components/erp-ui"
import { Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/erp-form"

export function ProductionVarianceDialog({
  open,
  target,
  onClose,
  onSaved,
}: {
  open: boolean
  target: { id: string; batch_no: string } | null
  onClose: () => void
  /** Page sets the notice banner and reloads the register. */
  onSaved: (notice: string) => Promise<void> | void
}) {
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState("")
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setReason("")
    setError("")
    setPending(false)
  }, [open ])

  const handlePostWithVarianceReason = async () => {
    if (!target || pending) return
    if (!reason.trim()) {
      setError("Enter a variance reason before posting this batch.")
      return
    }
    setPending(true)
    try {
      const saved = await setBatchVarianceReason(target.id, reason.trim())
      if (!saved.success) {
        setError(saved.error ?? "Could not save the variance reason.")
        return
      }
      const res = await postBatch(target.id, postToken("batch:post", target.id))
      if (!res.success) {
        setError(res.error ?? "Could not post the batch.")
        return
      }
      await onSaved(`${target.batch_no} posted.`)
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
      title="Variance reason required"
      description={`${target.batch_no} cannot be posted: an input variance exceeds the configured tolerance. Record the reason, then post again.`}
    >
      <div className="space-y-4 text-xs">
        <AlertBanner tone="error" message={error} onDismiss={() => setError("")} />
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="draft-variance-reason">Variance reason</label>
          <input
            id="draft-variance-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why the input varied from plan"
            className={inputClass}
          />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
          <button type="button" onClick={handlePostWithVarianceReason} disabled={pending} className={primaryButtonClass}>
            {pending ? <SubmitSpinner /> : null}
            <span>{pending ? "Posting…" : "Save Reason & Post"}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
