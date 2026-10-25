import { StatCardsSkeleton, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real packing page: title row + 1 action button, 3 bag
 * stock cards, then the bardana ledger table and the packing
 * history table stacked below.
 */
export default function PackingLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <StatCardsSkeleton count={3} cols="sm:grid-cols-3" />
      <TableCardSkeleton rows={5} />
      <TableCardSkeleton rows={6} />
    </div>
  )
}
