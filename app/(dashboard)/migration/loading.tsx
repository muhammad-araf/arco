import { TabBarSkeleton, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real import page (default sheet-map tab): title row
 * with no action button, the 3-tab switcher, then the sheet-map
 * table.
 */
export default function MigrationLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} />
      <TabBarSkeleton tabs={3} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}
