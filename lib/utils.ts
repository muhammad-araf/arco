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
  const date = typeof dateString === "string" ? new Date(dateString) : dateString
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
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
