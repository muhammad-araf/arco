"use client"

/**
 * Gate pass rejection dialog on the shared Modal kit.
 *
 * Moved verbatim from the Gate Pass page's hand-rolled reject modal:
 * same field, same validation, same rejectGatePass call. One fix:
 * validation/server errors used to go to the page banner, which sits
 * behind this modal and was invisible while it was open — they now
 * show in the dialog's own banner, with the dialog staying open so
 * the typed reason is not lost.
 */
import * as React from "react"
import { postToken } from "@/lib/idempotency"
import { rejectGatePass } from "@/app/actions/gatepass"
import { AlertBanner, SubmitSpinner } from "@/components/erp-ui"
import { Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/erp-form"

export function GatePassRejectDialog({
  open,
  target,
  onClose,
  onSaved,
}: {
  open: boolean
  target: { id: string; pass_no: string } | null
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

  const handleConfirmReject = async () => {
    if (!target || pending) return
    if (!reason.trim()) {
      setError("A rejection reason is required.")
      return
    }
    setPending(true)
    try {
      const res = await rejectGatePass(target.id, reason.trim(), postToken("gatepass:reject", target.id))
      if (!res.success) {
        setError(res.error ?? "Could not reject the gate pass.")
        return
      }
      await onSaved(`${target.pass_no} rejected back to draft — no stock was deducted for it.`)
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
      title={`Reject ${target.pass_no}?`}
      description="The pass returns to draft with no stock deducted, so it can be corrected and re-submitted. Approval is owner_admin-only on the server."
    >
      <div className="space-y-4 text-xs">
        <AlertBanner tone="error" message={error} onDismiss={() => setError("")} />
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="reject-reason">Rejection reason *</label>
          <input id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this pass rejected?" className={inputClass} required />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
          <button type="button" onClick={() => void handleConfirmReject()} disabled={pending} className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60">
            {pending ? <SubmitSpinner /> : null}
            <span>{pending ? "Rejecting…" : "Reject to Draft"}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
