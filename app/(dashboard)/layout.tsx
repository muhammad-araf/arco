import * as React from "react"
import { redirect } from "next/navigation"
import { connection } from "next/server"
import { AppSidebar } from "@/components/app-sidebar"
import { SessionIdleTimeout } from "@/components/session-idle-timeout"
import { getSettingsSnapshot } from "@/app/actions/settings"
import { ThemeToggle } from "@/components/theme-toggle"
import { TodayBadge } from "@/components/today-badge"
import { createClient } from "@/lib/supabase/server"
import { getCurrentActor } from "@/app/actions/auth"

// Authenticated shell: the layout awaits the session (cookies), so
// these routes can never be statically prerendered. `instant = false`
// is the Cache Components way to declare a blocking (dynamic) route —
// every dashboard page is per-operator data behind the sign-in guard.
export const instant = false

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // connection() first: it opts this route into dynamic rendering, and
  // the cookie reads below (createClient) must happen in that dynamic
  // context. Everything after it is independent work, run concurrently.
  await connection()

  // Session guard: no authenticated Supabase session -> /login.
  // Fail closed on any auth lookup error, the same as no session.
  // The session check still gates the redirect exactly as before: actor
  // and settings are only resolved once a session exists, so an
  // unauthenticated request still redirects without those lookups.
  // getCurrentActor re-reads the session itself from the same (cached)
  // client, and getSettingsSnapshot builds its own (cached) client, so
  // neither depends on the session value resolved here — only on the
  // client existing, which is why they can run in parallel with each
  // other once the guard has passed.
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

  // Operator identity for the sidebar, resolved here on the server so the
  // sidebar no longer spends a client round trip (getUser + profile) after
  // every app load just to render a name and role. Display-only: all
  // enforcement still happens inside the server actions.
  // Idle sign-out: the configured timeout (default 60 minutes; 0
  // disables it in the component). A failed settings read keeps the
  // default rather than disabling the timer or signing anyone out.
  // Previously these two awaited sequentially; they are independent
  // (different tables, different actions), so they now run together.
  const [actor, snap] = await Promise.all([
    supabase ? getCurrentActor(supabase).catch(() => null) : Promise.resolve(null),
    getSettingsSnapshot().catch(() => null),
  ])
  let timeoutMinutes = 60
  try {
    if (snap && snap.success && snap.data) timeoutMinutes = snap.data.session_timeout_minutes
  } catch {
    timeoutMinutes = 60
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-background relative overflow-hidden">
      <SessionIdleTimeout minutes={timeoutMinutes} />
      {/* Main Navigation Sidebar */}
      <AppSidebar
        displayName={actor?.displayName ?? null}
        email={actor?.email ?? null}
        role={actor?.role ?? null}
      />

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
