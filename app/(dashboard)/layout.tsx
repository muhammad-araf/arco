import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { ExpensiveAmbientMesh } from "@/components/expensive-ambient-mesh"
import { ThemeToggle } from "@/components/theme-toggle"
import { ShieldCheck, Warehouse, Calendar } from "lucide-react"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const todayFormatted = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date())

  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      {/* Aurora Ambient Mesh Background */}
      <ExpensiveAmbientMesh />

      {/* Single-Role Main Navigation Sidebar */}
      <AppSidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 z-10">
        {/* Frosted Glass Sticky Top Header */}
        <header className="h-16 px-4 md:px-6 border-b border-border/60 bg-background/70 backdrop-blur-xl sticky top-0 z-30 flex items-center justify-between transition-colors">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/80 border border-border/70 text-xs text-foreground shadow-2xs">
              <Warehouse className="h-3.5 w-3.5 text-emerald-500" />
              <span className="font-semibold">Main Seed Godown</span>
              <span className="text-[10px] text-muted-foreground font-mono">(GDN-01)</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Calendar className="h-3.5 w-3.5" />
              <span>{todayFormatted}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>All Ledgers Reconciled</span>
            </div>

            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/40 border border-border/60 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              <span>Single Role: <strong className="text-foreground">Full Authority</strong></span>
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
