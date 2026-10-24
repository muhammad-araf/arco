/**
 * Shared prop types + defensive helpers for the print components.
 *
 * Every print component takes plain data props only — no store, router,
 * or Supabase imports — so pages can wire them in with whatever data
 * source they already have. Every field is optional: a component must
 * render with empty / partial data without crashing.
 */

/** Company header details, configured in settings (spec §9.4). */
export interface CompanyDetails {
  name?: string
  address?: string
  phone?: string
  email?: string
  /** Optional logo image URL. Omit it and the header renders text-only. */
  logoUrl?: string
}

/** Fallback text for a missing string field. */
export function text(value: string | number | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined) return fallback
  const s = String(value).trim()
  return s === "" ? fallback : s
}

/** A number that is safe to add up: null / undefined / NaN become 0. */
export function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === "string" ? Number(value) : value
  return Number.isFinite(n) ? n : 0
}

/** Format a number with up to 2 decimals, trimming trailing zeros. */
export function fmtNum(value: number | string | null | undefined): string {
  const n = num(value)
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

/** Format a quantity with its unit, e.g. "1,250 kg". */
export function fmtQty(value: number | string | null | undefined, unit?: string): string {
  const u = (unit ?? "").trim()
  return u ? `${fmtNum(value)} ${u}` : fmtNum(value)
}

/**
 * Format a date / datetime prop for print. Accepts an ISO string, a
 * Date, or an already-formatted display string; unparseable input is
 * passed through untouched instead of throwing.
 */
export function fmtDate(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return "—"
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "—" : value.toLocaleDateString("en-GB")
  }
  const s = String(value).trim()
  if (s === "") return "—"
  const d = new Date(s)
  if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return d.toLocaleDateString("en-GB")
  }
  return s
}

/** Sum one numeric field across rows, tolerating missing rows/values. */
export function sum<T>(rows: T[] | null | undefined, pick: (row: T) => number | string | null | undefined): number {
  if (!Array.isArray(rows)) return 0
  return rows.reduce((acc, row) => acc + num(row ? pick(row) : 0), 0)
}
