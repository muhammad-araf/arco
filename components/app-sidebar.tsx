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
  UserCog,
  BarChart3,
  Database,
  ChevronRight,
  Sprout,
  Menu,
  X,
  FileCheck2,
  UploadCloud,
  Settings,
  BookOpen,
  Handshake,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { type AppRole } from "@/app/actions/auth"

const ROLE_LABELS: Record<AppRole, string> = {
  owner_admin: "Owner / Admin",
  storekeeper: "Storekeeper",
  production_operator: "Production Operator",
  gate_operator: "Gate Operator",
  accountant: "Accountant",
  hr_payroll: "HR / Payroll",
  read_only_manager: "Read-only Manager",
}

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
    heading: "Operations",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Inward", href: "/inward", icon: Truck },
      { title: "Stock", href: "/inventory", icon: Boxes },
      { title: "Gate Pass", href: "/gatepass", icon: FileCheck2 },
    ],
  },
  {
    heading: "Production",
    items: [
      { title: "Production", href: "/production", icon: ScrollText },
      { title: "Machinery", href: "/machinery", icon: Cog },
      { title: "Packing", href: "/packing", icon: PackageCheck },
    ],
  },
  {
    heading: "Finance",
    items: [
      { title: "Purchases", href: "/purchases", icon: ShoppingCart },
      { title: "Billing", href: "/billing", icon: Receipt },
      { title: "Parties", href: "/parties", icon: Handshake },
      { title: "Daybook", href: "/daybook", icon: Wallet },
      { title: "Ledgers", href: "/ledgers", icon: BookOpen },
    ],
  },
  {
    heading: "Manage",
    items: [
      { title: "Employees", href: "/employees", icon: Users2 },
      { title: "Attendance", href: "/employees?tab=attendance", icon: UserCheck },
      { title: "Reports", href: "/reports", icon: BarChart3 },
      { title: "Import", href: "/migration", icon: UploadCloud },
      { title: "Masters", href: "/masters", icon: Database },
      { title: "People", href: "/people", icon: UserCog },
      { title: "Audit", href: "/audit", icon: ShieldCheck },
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
]

export function AppSidebar({
  displayName,
  email,
  role,
}: {
  displayName?: string | null
  email?: string | null
  role?: AppRole | null
}) {
  const pathname = usePathname()
  const [isOpenMobile, setIsOpenMobile] = React.useState(false)
  // Identity comes from the server layout (same fallbacks the old
  // client-side getMyProfile call produced), so the name and role render
  // with the shell instead of popping in after a round trip.
  const actorLabel = displayName ?? email ?? "Operator"
  const actorRole = role ? (ROLE_LABELS[role] ?? role) : ""

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
      <div className="lg:hidden w-full flex items-center justify-between p-3 border-b border-border bg-card sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-500 border border-emerald-300 dark:border-emerald-700 flex items-center justify-center font-bold">
            <Sprout className="h-5 w-5" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-foreground block">ARCO</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Seed Godown</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsOpenMobile(!isOpenMobile)}
            className="p-2 rounded-lg border border-border bg-muted text-foreground"
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
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setIsOpenMobile(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:h-screen lg:shrink-0",
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
            <div className="h-9 w-9 rounded-md bg-primary text-white flex items-center justify-center">
              <Sprout className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-base tracking-tight text-sidebar-foreground group-hover:text-primary transition-colors">
                ARCO
              </span>
              <span className="text-[11px] text-muted-foreground font-medium truncate">
                Seed Godown
              </span>
            </div>
          </Link>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin">
          {navSections.map((section) => (
            <div key={section.heading} className="space-y-1">
              <div className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
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
                        "flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors group relative",
                        active
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            active ? "text-primary-foreground" : "text-primary"
                          )}
                        />
                        <span className="truncate">{item.title}</span>
                      </div>
                      {item.badge && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-muted text-primary">
                          {item.badge}
                        </span>
                      )}
                      {active && (
                        <ChevronRight className="h-3.5 w-3.5 text-primary-foreground shrink-0" />
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar Footer with Single-Role Operator Profile */}
        <div className="p-3 border-t border-sidebar-border bg-sidebar-accent">
          <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-card border border-border">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-300 dark:border-emerald-700">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">{actorLabel}</div>
                <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">{actorRole}</div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
