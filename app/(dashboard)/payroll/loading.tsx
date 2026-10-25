import { Skel, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real payroll page: title row + 1 action button, then
 * three stacked cards — attendance table, payroll estimate table,
 * and the finalized payroll card (filter row + table).
 */
export default function PayrollLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TableCardSkeleton rows={8} />
      <TableCardSkeleton rows={6} />
      <div className="expensive-card p-5 space-y-4">
        <Skel className="h-4 w-32 bg-muted rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skel key={i} className="h-9 w-full rounded-lg bg-muted" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skel key={i} className="h-9 w-full rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}
