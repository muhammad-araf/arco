import { Skel } from "@/components/erp-ui"

/**
 * Mirrors the real login page: a centered card with the logo/title
 * row, two labeled fields, the submit button, and the footer line.
 */
export default function LoginLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4" aria-label="Loading page content" aria-busy="true">
      <div className="relative w-full max-w-sm rounded-md border border-border bg-card p-6 md:p-8 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Skel className="h-10 w-10 rounded-md bg-muted" />
          <div className="space-y-2">
            <Skel className="h-4 w-32 bg-muted rounded" />
            <Skel className="h-3 w-24 bg-muted rounded" />
          </div>
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skel className="h-3 w-16 bg-muted rounded" />
            <Skel className="h-10 w-full rounded-lg bg-muted" />
          </div>
        ))}
        <Skel className="h-10 w-full rounded-lg bg-muted" />
        <div className="flex justify-center pt-2">
          <Skel className="h-3 w-48 bg-muted rounded" />
        </div>
      </div>
    </div>
  )
}
