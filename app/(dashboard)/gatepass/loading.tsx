import { TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/** Mirrors the real gate pass page: title row + 2 action buttons, one passes table. */
export default function GatepassLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={2} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}
