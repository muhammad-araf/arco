import { TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/** Mirrors the real purchases page: title row + 1 action button, one invoices table. */
export default function PurchasesLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={1} />
      <TableCardSkeleton rows={8} />
    </div>
  )
}
