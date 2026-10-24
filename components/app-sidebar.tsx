"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Truck,
  Boxes,
  ScrollText,
  Cog,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Receipt,
  Wallet,
  Users2,
  BarChart3,
  Database,
  ChevronRight,
  Sprout,
  Menu,
  X,
  FileCheck2,
  UploadCloud,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "./theme-toggle"

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
}

interface NavSection {
  heading: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    heading: "Core Operations",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Inward Goods", href: "/inward", icon: Truck },
      { title: "Stock & Godowns", href: "/inventory", icon: Boxes },
      { title: "Gate Pass & Dispatch", href: "/gatepass", icon: FileCheck2 },
    ],
  },
  {
    heading: "Processing & Production",
    items: [
      { title: "Production Batches", href: "/production", icon: ScrollText },
      { title: "Machinery Jobs", href: "/machinery", icon: Cog },
      { title: "Packing & Bardana", href: "/packing", icon: PackageCheck },
    ],
  },
  {
    heading: "Commercials & Finance",
    items: [
      { title: "Purchases & Vendors", href: "/purchases", icon: ShoppingCart },
      { title: "Billing & Receipts", href: "/billing", icon: Receipt },
      { title: "Daybook & Expenses", href: "/daybook", icon: Wallet },
    ],
  },
  {
    heading: "Management & Intelligence",
    items: [
      { title: "Attendance & Payroll", href: "/payroll", icon: Users2 },
      { title: "Reports & P&L", href: "/reports", icon: BarChart3 },
      { title: "Excel Import & Balances", href: "/migration", icon: UploadCloud },
      { title: "Master Data", href: "/masters", icon: Database },
      { title: "Users & Roles", href: "/users", icon: Users2 },
      { title: "Audit Log", href: "/audit", icon: ShieldCheck },
    ],
  },
]

export function AppSidebar() {
  const pathname = usePathname()
  const [isOpenMobile, setIsOpenMobile] = React.useState(false)

  React.useEffect(() => {
    if (!isOpenMobile) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpenMobile(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpenMobile])

  const isRouteActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/"
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Mobile Menu Trigger Bar */}
      <div className="lg:hidden flex items-center justify-between p-3 border-b border-border/70 bg-card/80 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 flex items-center justify-center font-bold">
            <Sprout className="h-5 w-5" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-foreground block">ARCO</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Seed Godown ERP</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setIsOpenMobile(!isOpenMobile)}
            className="p-2 rounded-lg border border-border/60 bg-muted/30 text-foreground"
            aria-label="Toggle Navigation"
            aria-expanded={isOpenMobile}
          >
            {isOpenMobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 lg:hidden"
          onClick={() => setIsOpenMobile(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 w-64 bg-sidebar/95 backdrop-blur-xl border-r border-sidebar-border flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:h-screen lg:shrink-0",
          isOpenMobile ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand Header */}
        <div className="h-16 px-4 border-b border-sidebar-border flex items-center justify-between">
          <Link
            href="/dashboard"
            onClick={() => setIsOpenMobile(false)}
            className="flex items-center gap-3 group"
          >
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white flex items-center justify-center shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
              <Sprout className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-base tracking-tight text-sidebar-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                ARCO
                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 font-bold uppercase tracking-wider">
                  ERP
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground font-medium truncate">
                Seed Godown & Processing
              </span>
            </div>
          </Link>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin">
          {navSections.map((section) => (
            <div key={section.heading} className="space-y-1">
              <div className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                {section.heading}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isRouteActive(item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setIsOpenMobile(false)}
                      className={cn(
                        "flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-all group relative",
                        active
                          ? "bg-primary text-primary-foreground font-semibold shadow-xs shadow-primary/25"
                          : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0 transition-transform group-hover:scale-110",
                            active ? "text-primary-foreground" : "text-primary"
                          )}
                        />
                        <span className="truncate">{item.title}</span>
                      </div>
                      {item.badge && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">
                          {item.badge}
                        </span>
                      )}
                      {active && (
                        <ChevronRight className="h-3.5 w-3.5 text-primary-foreground/80 shrink-0" />
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar Footer with Single-Role Operator Profile */}
        <div className="p-3 border-t border-sidebar-border bg-sidebar-accent/20">
          <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-card/60 border border-border/50">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">Operator Admin</div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Single Role Mode</div>
              </div>
            </div>
            <ThemeToggle className="h-8 w-8 shrink-0" />
          </div>
        </div>
      </aside>
    </>
  )
}
