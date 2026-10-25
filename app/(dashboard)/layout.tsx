import * as React from "react"
import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { TodayBadge } from "@/components/today-badge"
import { createClient } from "@/lib/supabase/server"
import { getCurrentActor } from "@/app/actions/auth"
import { Warehouse } from "lucide-react"

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
  // Session guard: no authenticated Supabase session -> /login.
  // Fail closed on any auth lookup error, the same as no session.
  let session = null
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null
  try {
    supabase = await createClient()
    const { data } = await supabase.auth.getSession()
    session = data.session
  } catch {
    session = null
  }
  if (!session) redirect("/login")

  // Operator identity for the sidebar, resolved here on the server so the
  // sidebar no longer spends a client round trip (getUser + profile) after
  // every app load just to render a name and role. Display-only: all
  // enforcement still happens inside the server actions.
  const actor = supabase ? await getCurrentActor(supabase).catch(() => null) : null

  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
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
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border text-xs text-foreground shadow-2xs">
              <Warehouse className="h-3.5 w-3.5 text-emerald-500" />
              <span className="font-semibold">Main Seed Godown</span>
            </div>
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
