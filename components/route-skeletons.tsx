import { DetailRowsSkeleton, FilterFieldsSkeleton, ListCardSkeleton, Skel, StatCardsSkeleton, TabBarSkeleton, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/* Shared route skeletons: each route's loading.tsx and the page's own
   in-page loading state render the SAME component, so the shape never
   shifts between navigation skeleton and mount skeleton. */

export function AuditSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} subtitle />
      <FilterFieldsSkeleton fields={4} button />
      {/* Real audit table: When, User, Action, Entity, Voucher, Reason,
          Before / After. The old centred text blocks matched no section
          on the page, so they are replaced by this table. */}
      <TableCardSkeleton rows={8} columns={[2, 2, 1, 2, 1, 2, 2]} />
    </div>
  )
}

export function BillingSkeleton() {
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

export function DashboardSkeleton() {
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

export function DaybookSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <StatCardsSkeleton count={3} cols="sm:grid-cols-3" />
      <TableCardSkeleton rows={8} />
    </div>
  )
}

export function GatepassSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={2} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}

export function InventorySkeleton() {
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

export function InwardSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}

export function MachinerySkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}

export function MastersSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TabBarSkeleton tabs={4} />
      <TableCardSkeleton rows={8} title={false} />
    </div>
  )
}

export function MigrationSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} />
      <TabBarSkeleton tabs={3} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}

export function PackingSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <StatCardsSkeleton count={3} cols="sm:grid-cols-3" />
      <TableCardSkeleton rows={5} />
      <TableCardSkeleton rows={6} />
    </div>
  )
}

export function PayrollSkeleton() {
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

export function ProductionSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}

export function PurchasesSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}

export function ReportsSkeleton() {
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

export function UsersSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} subtitle />
      <TableCardSkeleton rows={6} title={false} />
    </div>
  )
}
