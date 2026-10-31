import { AppSidebar } from "@/components/app-sidebar"
import { Skel } from "@/components/erp-ui"
import { SessionIdleTimeout } from "@/components/session-idle-timeout"
import { getCurrentActor } from "@/app/actions/auth"
import { getSettingsSnapshot } from "@/app/actions/settings"
import { createClient } from "@/lib/supabase/server"

/**
 * Streaming dashboard shell parts (server components).
 *
 * The dashboard layout awaits only the cheap session guard before it
 * returns its JSX; the two slow reads that used to block the whole
 * shell live here, each behind its own <Suspense> boundary in the
 * layout, so they stream in after the shell (and the page) paints:
 *
 * - SidebarWithActor: operator identity for AppSidebar. app-sidebar.tsx
 *   itself is untouched — this component owns the fetch and renders it.
 * - IdleTimeoutLoader: the session-timeout minutes for
 *   SessionIdleTimeout, with the layout's old failure behaviour intact
 *   (default 60 minutes on any failure; never disabling the timer or
 *   signing anyone out).
 *
 * No figures, balances, roles, routes, or business logic are cached or
 * changed here. getCurrentActor / getSettingsSnapshot keep their own
 * existing in-request caches; nothing new is introduced.
 */

/** Operator identity for the sidebar, resolved after the shell paints. */
export async function SidebarWithActor() {
  // createClient is React cache()d per request, so this is the same
  // (cached) client the layout's session guard already built — no new
  // session, and the actor lookup re-reads the session from it exactly
  // as the layout's old Promise.all call did.
  let actor: Awaited<ReturnType<typeof getCurrentActor>> | null = null
  try {
    const supabase = await createClient()
    actor = await getCurrentActor(supabase).catch(() => null)
  } catch {
    actor = null
  }
  return (
    <AppSidebar
      displayName={actor?.displayName ?? null}
      email={actor?.email ?? null}
      role={actor?.role ?? null}
    />
  )
}

/** Session-timeout minutes for the idle sign-out timer. */
export async function IdleTimeoutLoader() {
  const snap = await getSettingsSnapshot().catch(() => null)
  // Same failure behaviour as the old layout: default 60 minutes on a
  // failed read, never 0 (which would disable the timer).
  let timeoutMinutes = 60
  try {
    if (snap && snap.success && snap.data) timeoutMinutes = snap.data.session_timeout_minutes
  } catch {
    timeoutMinutes = 60
  }
  return <SessionIdleTimeout minutes={timeoutMinutes} />
}

/**
 * Fallback while the sidebar identity streams in: the same sidebar
 * frame AppSidebar renders — mobile trigger bar, w-64 aside, brand
 * header, the 4 nav sections with their real row counts (Operations 4,
 * Production 3, Finance 5, Manage 8), and the footer profile block —
 * with the identity area (and nav rows) as solid muted animate-pulse
 * blocks in the existing skeleton language: no gradients, no fake
 * progress, no text. Dimensions mirror the real rows (py-2 rows with a
 * 16px icon block and a text-height label block) so the swap to the
 * real sidebar does not shift the page. Nav links are not clickable
 * during this brief window; the page content beside it already is.
 */
const SIDEBAR_SECTIONS: number[] = [4, 3, 5, 8]

export function SidebarSkeleton() {
  return (
    <>
      {/* Mobile Menu Trigger Bar — mirrors AppSidebar's bar. */}
      <div
        className="lg:hidden w-full flex items-center justify-between p-3 border-b border-border bg-card sticky top-0 z-40"
        aria-label="Loading navigation"
        aria-busy="true"
      >
        <div className="flex items-center gap-2.5">
          <Skel className="h-8 w-8 rounded-lg bg-muted" />
          <div className="space-y-1.5">
            <Skel className="h-3 w-12 bg-muted rounded" />
            <Skel className="h-2.5 w-20 bg-muted rounded" />
          </div>
        </div>
        <Skel className="h-9 w-9 rounded-lg bg-muted" />
      </div>

      {/* Sidebar Container — same frame classes as AppSidebar's aside,
          closed on mobile (the real sidebar also starts closed). */}
      <aside className="fixed top-0 bottom-0 left-0 z-50 lg:z-auto w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:h-screen lg:shrink-0 -translate-x-full">
        {/* Brand Header */}
        <div className="h-16 px-4 border-b border-sidebar-border flex items-center gap-3">
          <Skel className="h-9 w-9 rounded-md bg-muted" />
          <div className="space-y-1.5">
            <Skel className="h-4 w-14 bg-muted rounded" />
            <Skel className="h-3 w-20 bg-muted rounded" />
          </div>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {SIDEBAR_SECTIONS.map((rows, section) => (
            <div key={section} className="space-y-1">
              <div className="px-2 pb-1.5">
                <Skel className="h-3 w-20 bg-muted rounded" />
              </div>
              <div className="space-y-0.5">
                {Array.from({ length: rows }).map((_, row) => (
                  <div key={row} className="flex items-center gap-2.5 px-2.5 py-2">
                    <Skel className="h-4 w-4 shrink-0 rounded bg-muted" />
                    <Skel
                      className="h-3 rounded bg-muted"
                      style={{ width: `${[56, 72, 64, 80, 60, 68, 76, 52][row % 8]}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar Footer — profile block without identity. */}
        <div className="p-3 border-t border-sidebar-border bg-sidebar-accent">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border">
            <Skel className="h-7 w-7 shrink-0 rounded-lg bg-muted" />
            <div className="space-y-1.5 min-w-0">
              <Skel className="h-3 w-24 bg-muted rounded" />
              <Skel className="h-2.5 w-16 bg-muted rounded" />
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
