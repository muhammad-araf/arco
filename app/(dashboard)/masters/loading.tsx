import { TabBarSkeleton, TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real masters page: title row + 1 action button, the
 * 4-tab switcher, then one table (products, godowns, parties, or
 * machinery — same table shape).
 */
export default function MastersLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TabBarSkeleton tabs={4} />
      <TableCardSkeleton rows={8} title={false} />
    </div>
  )
}
