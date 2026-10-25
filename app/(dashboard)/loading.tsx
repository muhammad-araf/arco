import { PageSkeleton } from "@/components/erp-ui"

/**
 * Instant navigation feedback for every dashboard route: without this,
 * moving between pages shows the old page until the new route's JS and
 * data arrive. With partial prefetching enabled, this skeleton is also
 * what prefetched navigations render immediately.
 */
export default function DashboardLoading() {
  return <PageSkeleton />
}
