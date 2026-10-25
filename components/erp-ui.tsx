"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle, Inbox } from "lucide-react"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/* Shared Phase-1 UI primitives for the Seed Godown ERP.               */
/* Design language kept: Deep Forest Emerald #0B2F24, Golden Harvest   */
/* Amber #D99726, flat solid colors, 1px borders, 6px radius. No data  */
/* layer changes here — these components only render UI state.        */
/* ------------------------------------------------------------------ */

/** Read the dashboard drill-down `?filter=` param on the client. Safe
 *  to call during render: returns null on the server / when absent. */
export function getUrlFilter(): string | null {
  if (typeof window === "undefined") return null
  try {
    return new URLSearchParams(window.location.search).get("filter")
  } catch {
    return null
  }
}

/** True when an ISO date string falls on the local "today". */
export function isTodayISO(dateStr: string): boolean {
  if (!dateStr) return false
  return dateStr.slice(0, 10) === new Date().toISOString().slice(0, 10)
}

/** Positive-number guard used by every posting form (spec §1.2:
 *  negative / zero quantities are blocked, never silently accepted). */
export function isPositive(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/* ------------------------------ Skeleton --------------------------- */

export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-64 max-w-full rounded-lg bg-muted/70 animate-pulse" />
          <div className="h-3 w-96 max-w-full rounded bg-muted/50 animate-pulse" />
        </div>
        <div className="h-10 w-44 rounded-lg bg-emerald-500/20 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="expensive-card p-4 space-y-3">
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
            <div className="h-7 w-32 rounded bg-muted/70 animate-pulse" />
            <div className="h-3 w-20 rounded bg-muted/50 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="expensive-card p-5 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-9 w-full rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}

export function SubmitSpinner() {
  return <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
}

/* ------------------------------ Banners ---------------------------- */

type BannerTone = "error" | "success" | "warning" | "info"

const bannerStyles: Record<BannerTone, string> = {
  error: "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400",
  success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400",
  info: "bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-400",
}

const bannerIcons: Record<BannerTone, React.ComponentType<{ className?: string }>> = {
  error: XCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
}

export function AlertBanner({
  tone,
  message,
  onDismiss,
}: {
  tone: BannerTone
  message: string
  onDismiss?: () => void
}) {
  if (!message) return null
  const Icon = bannerIcons[tone]
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3.5 py-3 text-xs font-medium",
        bannerStyles[tone]
      )}
    >
      <Icon className="h-4 w-4 shrink-0 mt-px" />
      <p className="flex-1 min-w-0 break-words">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="shrink-0 opacity-70 hover:opacity-100 cursor-pointer font-bold"
        >
          ✕
        </button>
      )}
    </div>
  )
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">
      {message}
    </p>
  )
}

/* --------------------------- Empty state --------------------------- */

export function EmptyState({
  title,
  hint,
  actionLabel,
  onAction,
}: {
  title: string
  hint: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 rounded-md border border-dashed border-border bg-muted/20">
      <div className="h-11 w-11 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center mb-3">
        <Inbox className="h-5 w-5" />
      </div>
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">{hint}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/* ------------------------- Drill-down banner ------------------------ */

export const FILTER_LABELS: Record<string, string> = {
  today: "Today only",
  posted: "Posted only",
  low: "Low stock only",
  receivable: "Unpaid customers",
  payable: "Unpaid vendors",
  unpaid: "Unpaid only",
  pending: "Pending only",
}

export function FilterBanner({ filter, onClear }: { filter: string | null; onClear: () => void }) {
  if (!filter) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">
      <span>
        <strong>{FILTER_LABELS[filter] ?? `Filter “${filter}”`}</strong>
      </span>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-card border border-border text-foreground font-semibold cursor-pointer hover:bg-muted/50"
      >
        Clear filter ✕
      </button>
    </div>
  )
}

/* --------------------------- Dialog shell --------------------------- */

function DialogShell({
  onClose,
  children,
  wide,
}: {
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  // Escape closes; backdrop click closes. Content scrolls inside 90dvh
  // so dialogs fit phones and 200% browser zoom without clipping.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 overflow-y-auto"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "expensive-card w-full p-4 sm:p-6 bg-card border border-border shadow-md rounded-md space-y-4 my-auto max-h-[90dvh] overflow-y-auto",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        {children}
      </div>
    </div>
  )
}

/* ------------------------- Confirm dialog --------------------------- */

/** Confirmation for every posting / cancellation. The confirm button is
 *  disabled while pending so a double-click can never post twice. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  pending?: boolean
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <DialogShell onClose={pending ? () => {} : onCancel}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "h-10 w-10 shrink-0 rounded-md flex items-center justify-center border",
            destructive
              ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
          )}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          Go back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={cn(
            "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed",
            destructive ? "bg-red-600 hover:bg-red-500" : "bg-emerald-600 hover:bg-emerald-500"
          )}
        >
          {pending && <SubmitSpinner />}
          {pending ? "Posting…" : confirmLabel}
        </button>
      </div>
    </DialogShell>
  )
}

/* ------------------------- Reversal dialog -------------------------- */

/** Spec §1.1 / §22: a posted voucher is never silently deleted. A
 *  reversal needs a reason code AND a mandatory written reason; the
 *  confirm button stays disabled until a reason is typed. */
export const REVERSAL_REASONS = [
  "Wrong quantity / weight",
  "Wrong product / godown",
  "Duplicate entry",
  "Customer return",
  "Data entry error",
  "Cancelled by customer",
  "Other",
] as const

export function ReversalDialog({
  open,
  voucherLabel,
  note,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean
  voucherLabel: string
  note?: string
  pending?: boolean
  onConfirm: (reasonCode: string, reason: string) => void
  onCancel: () => void
}) {
  const [reasonCode, setReasonCode] = React.useState<string>(REVERSAL_REASONS[0])
  const [reason, setReason] = React.useState("")
  const valid = reason.trim().length >= 3
  if (!open) return null
  return (
    <DialogShell onClose={pending ? () => {} : onCancel}>
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/25 flex items-center justify-center">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground">Reverse {voucherLabel}?</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            This will <strong className="text-foreground">not delete</strong> the record. It stays
            in the register, marked “Reversed”, with this reason saved.
            {note ? ` ${note}` : ""}
          </p>
        </div>
      </div>
      <div className="space-y-3 text-xs">
        <div>
          <label className="block font-medium text-foreground mb-1">Reason code *</label>
          <select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
            className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
          >
            {REVERSAL_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-medium text-foreground mb-1">
            Reason for reversal *
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this being reversed?"
            className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground resize-y"
          />
          {!valid && reason.length > 0 && (
            <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
              Write at least 3 characters.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          Keep voucher
        </button>
        <button
          type="button"
          disabled={!valid || pending}
          onClick={() => onConfirm(reasonCode, reason.trim())}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending && <SubmitSpinner />}
          {pending ? "Reversing…" : "Confirm reversal"}
        </button>
      </div>
    </DialogShell>
  )
}
