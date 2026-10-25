import { ListCardSkeleton, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real billing page: title row + 1 action button, then a
 * 3-column grid — customers table on the left, receipts feed on the
 * right.
 */
export default function BillingLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <TableCardSkeleton rows={8} />
        </div>
        <ListCardSkeleton rows={4} />
      </div>
    </div>
  )
}
