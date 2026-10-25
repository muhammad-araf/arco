import { Skel, TabBarSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real reports page (default P&L tab): title row with
 * date filters + 2 action buttons, the 6-tab report switcher, then
 * the P&L document card — header, two columns of line rows, and the
 * net-profit banner.
 */
export default function ReportsLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Skel className="h-7 w-56 max-w-full bg-muted rounded" />
        <div className="flex flex-wrap items-center gap-2">
          <Skel className="h-8 w-32 rounded-lg bg-muted" />
          <Skel className="h-8 w-32 rounded-lg bg-muted" />
          <Skel className="h-10 w-28 rounded-lg bg-muted" />
          <Skel className="h-10 w-40 rounded-lg bg-muted" />
        </div>
      </div>
      <TabBarSkeleton tabs={6} />
      <div className="expensive-card p-6 space-y-6">
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div className="space-y-2">
            <Skel className="h-5 w-72 max-w-full bg-muted rounded" />
            <Skel className="h-3 w-56 max-w-full bg-muted rounded" />
          </div>
          <Skel className="h-6 w-24 rounded bg-muted" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {Array.from({ length: 2 }).map((_, col) => (
            <div key={col} className="space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <Skel className="h-3 w-32 bg-muted rounded" />
                <Skel className="h-3 w-20 bg-muted rounded" />
              </div>
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skel key={i} className="h-9 w-full rounded bg-muted" />
                ))}
              </div>
            </div>
          ))}
        </div>
        <Skel className="h-14 w-full rounded-md bg-muted" />
      </div>
    </div>
  )
}
