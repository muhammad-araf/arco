import { StatCardsSkeleton, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real daybook page: title row + 1 action button, 3 cash
 * summary cards, then the cashbook table.
 */
export default function DaybookLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <StatCardsSkeleton count={3} cols="sm:grid-cols-3" />
      <TableCardSkeleton rows={8} />
    </div>
  )
}
