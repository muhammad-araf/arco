import { FilterFieldsSkeleton, Skel, TitleRowSkeleton } from "@/components/erp-ui"

/**
 * Mirrors the real audit page: title row with no action button, the
 * 4-field filter card with its button, then the empty-state block.
 * The page itself has no data-loading state (it is an honest empty
 * state), so this only covers route navigation.
 */
export default function AuditLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page content" aria-busy="true">
      <TitleRowSkeleton buttons={0} />
      <FilterFieldsSkeleton fields={4} button />
      <div className="flex flex-col items-center py-8 space-y-2">
        <Skel className="h-4 w-56 bg-muted rounded" />
        <Skel className="h-3 w-80 max-w-full bg-muted rounded" />
      </div>
    </div>
  )
}
