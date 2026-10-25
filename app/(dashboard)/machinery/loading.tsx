import { TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/** Mirrors the real machinery page: title row + 1 action button, one jobs table. */
export default function MachineryLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}
