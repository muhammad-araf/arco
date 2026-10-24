"use client"

/**
 * Tiny helper that opens the browser print dialog. The print CSS shows
 * only the `.print-document` on the page, so the page should render
 * exactly one print component alongside this button.
 */
export function PrintButton({
  label = "Print",
  className,
  title,
}: {
  label?: string
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`no-print ${className ?? ""}`.trim()}
      title={title ?? "Print this document"}
    >
      {label}
    </button>
  )
}
