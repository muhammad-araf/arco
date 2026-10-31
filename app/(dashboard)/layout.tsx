import * as React from "react"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { connection } from "next/server"
import { IdleTimeoutLoader, SidebarSkeleton, SidebarWithActor } from "@/components/layout-shell-parts"
import { ThemeToggle } from "@/components/theme-toggle"
import { TodayBadge } from "@/components/today-badge"
import { createClient } from "@/lib/supabase/server"

// Authenticated shell: the layout awaits the session (cookies), so
// these routes can never be statically prerendered. `instant = false`
// is the Cache Components way to declare a blocking (dynamic) route —
// every dashboard page is per-operator data behind the sign-in guard.
// It stays false: the session guard below still blocks before any
// protected UI is returned, and only the slow display-only reads
// (sidebar identity, idle-timeout minutes) stream in behind Suspense.
// Per the Next.js 16 static-shell guide, moving request-time reads
// into focused components behind <Suspense> is what lets the shell
// paint while those reads resolve; the guard itself must NOT move
// behind a boundary, or an unauthenticated response would stream
// protected children first and only redirect afterwards.
export const instant = false

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // connection() first: it opts this route into dynamic rendering, and
  // the cookie reads below (createClient) must happen in that dynamic
  // context.
  await connection()

  // Session guard — UNCHANGED semantics, still awaited before anything
  // is rendered: no authenticated Supabase session -> /login. Fail
  // closed on any auth lookup error, the same as no session. The
  // cookie/session check is a cheap local parse, so keeping it blocking
  // costs little and guarantees an unauthenticated request never
  // renders protected children (or even the shell around them).
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null
  try {
    supabase = await createClient()
  } catch {
    supabase = null
  }
  let session = null
  try {
    if (supabase) {
      const { data } = await supabase.auth.getSession()
      session = data.session
    }
  } catch {
    session = null
  }
  if (!session) redirect("/login")

  // What used to block here — Promise.all(getCurrentActor,
  // getSettingsSnapshot) — now streams in behind Suspense boundaries
  // below. The shell (sidebar frame, header, main container) and the
  // page itself ({children}) are returned immediately and are NOT
  // suspended behind the actor/settings loads:
  //
  // - SidebarWithActor fetches the operator identity and renders
  //   AppSidebar (untouched); while it resolves, SidebarSkeleton
  //   holds the same w-64 sidebar frame so nothing shifts.
  // - IdleTimeoutLoader fetches the settings snapshot and renders
  //   SessionIdleTimeout; its fallback is null because the timer
  //   renders nothing itself. Its failure behaviour is unchanged:
  //   default 60 minutes, never disabling the timer or signing
  //   anyone out.
  // Both loaders re-read from the same per-request cached client /
  // actions, so no session, role, route, or business logic changed —
  // only when the two display-only values arrive.
  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-background relative overflow-hidden">
      <Suspense fallback={null}>
        <IdleTimeoutLoader />
      </Suspense>
      {/* Main Navigation Sidebar */}
      <Suspense fallback={<SidebarSkeleton />}>
        <SidebarWithActor />
      </Suspense>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 z-10">
        {/* Sticky Top Header */}
        <header className="h-16 px-4 md:px-6 border-b border-border bg-background sticky top-0 z-30 flex items-center justify-between transition-colors">
          <div className="flex items-center gap-3">
            <TodayBadge />
          </div>

          <div className="flex items-center gap-2.5">
            <ThemeToggle />
          </div>
        </header>

        {/* Scrollable Viewport */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
