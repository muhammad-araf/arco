"use client"

/**
 * Shared form kit, borrowed from the pos-system-aiagent pattern:
 * one small set of primitives used by every modal form, so inputs stop
 * drifting page by page (hand-rolled modal shells and copy-pasted
 * input/select class strings were the main source of the mess).
 *
 * Flat styling only, matching the existing arco look: solid colors,
 * 1px borders, rounded-lg. No data-layer changes here — these
 * components only render UI state.
 */
import * as React from "react"
import type { Godown } from "@/lib/types/database"

/** The single input/select class every form field uses. */
export const inputClass =
  "w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground disabled:opacity-60"

export const primaryButtonClass =
  "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"

export const secondaryButtonClass =
  "px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer"

/**
 * One dialog shell for every modal form (replaces the per-page
 * `fixed inset-0 ... bg-black/60` copies). Closes on ✕ only — never on
 * backdrop click — so a half-filled form is never lost by a stray tap.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide,
  xl,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  wide?: boolean
  /** Extra-wide shell (max-w-5xl) for the multi-line voucher forms,
   *  which were max-w-5xl / max-w-4xl before the shared-kit move. */
  xl?: boolean
}) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex overflow-y-auto p-4 bg-black/60">
      <div
        className={`expensive-card m-auto w-full ${xl ? "max-w-5xl" : wide ? "max-w-2xl" : "max-w-md"} p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer shrink-0 ml-4"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Label + control + hint/error, so every field shows its unit, an
 * example, and — when something is wrong — exactly what to fix.
 */
export function Field({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        className="block font-medium text-foreground mb-1"
        htmlFor={id}
      >
        {label} {required && <span aria-hidden="true">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * The one godown picker used everywhere. Always starts on an explicit
 * "Select godown" empty option (never silently pre-selects the first
 * godown), shows code beside the name, and can hide one godown — used
 * by transfers so the destination can never equal the source.
 */
export function GodownSelect({
  id,
  label,
  value,
  onChange,
  godowns,
  excludeId,
  required,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  godowns: Godown[]
  excludeId?: string
  required?: boolean
  hint?: string
}) {
  const options = excludeId
    ? godowns.filter((g) => g.id !== excludeId)
    : godowns
  return (
    <Field
      id={id}
      label={label}
      required={required}
      hint={
        options.length === 0
          ? "No other godown exists — add one in Masters first."
          : hint
      }
    >
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        disabled={options.length === 0}
      >
        <option value="">Select godown</option>
        {options.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.code})
          </option>
        ))}
      </select>
    </Field>
  )
}

/** "Name (CODE)" for a godown id, for review lines and notices. */
export function godownLabel(godowns: Godown[], id: string): string {
  const g = godowns.find((x) => x.id === id)
  return g ? `${g.name} (${g.code})` : "the godown"
}
