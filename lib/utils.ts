import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: string = "PKR"): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatWeight(weight: number, unit: string = "kg"): string {
  return `${weight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}`
}

export function formatBags(count: number): string {
  return `${count.toLocaleString()} bags`
}

export function formatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return "N/A"
  // DD/MM/YYYY, zero-padded. A bare YYYY-MM-DD date is parsed as local
  // calendar parts (not UTC midnight) so the displayed day never shifts
  // with the viewer's timezone.
  if (typeof dateString === "string") {
    const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString)
    if (bare) return `${bare[3]}/${bare[2]}/${bare[1]}`
  }
  const date = typeof dateString === "string" ? new Date(dateString) : dateString
  if (Number.isNaN(date.getTime())) return "N/A"
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${day}/${month}/${date.getFullYear()}`
}

export function formatDateTime(dateString: string | Date | null | undefined): string {
  if (!dateString) return "N/A"
  const date = typeof dateString === "string" ? new Date(dateString) : dateString
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
