import { Skel, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real stock page: title row + 2 action buttons, the
 * tab/search filter bar, then one table (summary or ledger).
 */
export default function InventoryLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={2} />
      <div className="expensive-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted border border-border self-start">
          <Skel className="h-7 w-32 rounded-md bg-card" />
          <Skel className="h-7 w-32 rounded-md bg-card" />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Skel className="h-8 w-52 rounded-lg bg-muted" />
          <Skel className="h-8 w-32 rounded-lg bg-muted" />
        </div>
      </div>
      <TableCardSkeleton rows={8} />
    </div>
  )
}
