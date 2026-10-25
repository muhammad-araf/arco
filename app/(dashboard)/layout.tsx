import * as React from "react"
import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { TodayBadge } from "@/components/today-badge"
import { createClient } from "@/lib/supabase/server"
import { ShieldCheck, Warehouse } from "lucide-react"

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
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getSession()
    session = data.session
  } catch {
    session = null
  }
  if (!session) redirect("/login")

  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      {/* Main Navigation Sidebar */}
      <AppSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 z-10">
        {/* Sticky Top Header */}
        <header className="h-16 px-4 md:px-6 border-b border-border bg-background sticky top-0 z-30 flex items-center justify-between transition-colors">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border text-xs text-foreground shadow-2xs">
              <Warehouse className="h-3.5 w-3.5 text-emerald-500" />
              <span className="font-semibold">Main Seed Godown</span>
              <span className="text-[10px] text-muted-foreground font-mono">(GDN-01)</span>
            </div>
            <TodayBadge />
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-100 dark:bg-emerald-900 border border-emerald-300 dark:border-emerald-700 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>All Ledgers Reconciled</span>
            </div>

            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted border border-border text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              <span>Role-based access</span>
            </div>

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
