import { PageSkeleton, TitleRowSkeleton, TableCardSkeleton } from "@/components/erp-ui"

export default function SettingsLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} />
      <TableCardSkeleton rows={6} />
      <TableCardSkeleton rows={6} />
    </div>
  )
}

