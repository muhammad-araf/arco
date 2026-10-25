import { TableCardSkeleton, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real users page: title row with a subtitle line and
 * no action button, then the operators table.
 */
export default function UsersLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} subtitle />
      <TableCardSkeleton rows={6} title={false} />
    </div>
  )
}
