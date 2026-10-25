import { TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/** Mirrors the real production page: title row + 1 action button, one batch table. */
export default function ProductionLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}
