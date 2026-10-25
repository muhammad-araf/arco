import { ListCardSkeleton, Skel, StatCardsSkeleton, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real dashboard: title row + 3 action buttons, 4 stat
 * cards, then a 3-column grid — stock table + movements list on the
 * left, money and godown cards on the right.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={3} />
      <StatCardsSkeleton count={4} cols="sm:grid-cols-2 lg:grid-cols-4" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <TableCardSkeleton rows={6} />
          <ListCardSkeleton rows={4} />
        </div>
        <div className="space-y-6">
          <div className="expensive-card p-5 space-y-3">
            <Skel className="h-4 w-28 bg-muted rounded" />
            <Skel className="h-16 w-full rounded-lg bg-muted" />
            <Skel className="h-16 w-full rounded-lg bg-muted" />
            <Skel className="h-10 w-full rounded-lg bg-muted" />
          </div>
          <div className="expensive-card p-5 space-y-4">
            <Skel className="h-4 w-28 bg-muted rounded" />
            <Skel className="h-2 w-full rounded bg-muted" />
            <Skel className="h-2 w-full rounded bg-muted" />
            <Skel className="h-2 w-full rounded bg-muted" />
          </div>
        </div>
      </div>
    </div>
  )
}
