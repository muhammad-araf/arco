"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
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
  UserCheck,
  BarChart3,
  Database,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Sprout,
  Menu,
  X,
  FileCheck2,
  UploadCloud,
  Settings,
  BookOpen,
  Handshake,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  deleteChatSession,
  getChatSessions,
  type ChatSession,
} from "@/lib/ai/chat-storage"
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
      { title: "AI Assistant", href: "/chat", icon: MessageSquare },
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
  const router = useRouter()
  const searchParams = useSearchParams()
  // The query string does not change pathname, so /chat?session=<id>
  // still matches pathname === "/chat"; the active row comes from the
  // ?session= param alone, and no row is active on bare /chat.
  const activeSessionId = searchParams.get("session")
  const isChatRoute = pathname === "/chat"
  const [isOpenMobile, setIsOpenMobile] = React.useState(false)
  const [chatSessions, setChatSessions] = React.useState<ChatSession[]>([])

  // Freshness: load on mount and re-read whenever the route or the
  // ?session= param changes. A separate mount-only listener re-reads
  // on the 'arco-chats-changed' event that saveChatSession /
  // deleteChatSession dispatch (the same pattern chat-client uses),
  // so a save or delete from the chat page updates this list without
  // a reload. getChatSessions seeds defaults only when the storage
  // key is absent, so an empty stored list stays empty here.
  React.useEffect(() => {
    setChatSessions(getChatSessions())
  }, [pathname, activeSessionId])
  React.useEffect(() => {
    const handleSync = () => {
      setChatSessions(getChatSessions())
    }
    window.addEventListener("arco-chats-changed", handleSync)
    return () => window.removeEventListener("arco-chats-changed", handleSync)
  }, [])

  const handleSelectChat = React.useCallback(
    (id: string) => {
      router.push(`/chat?session=${id}`)
      setIsOpenMobile(false)
    },
    [router]
  )
  const handleNewChat = React.useCallback(() => {
    router.push("/chat")
    setIsOpenMobile(false)
  }, [router])
  const handleDeleteChat = React.useCallback(
    (id: string) => {
      const wasActive = id === activeSessionId
      deleteChatSession(id)
      // deleteChatSession already dispatched the sync event, so the
      // list above re-reads on its own; navigation is decided here
      // from the freshly re-read remaining sessions.
      if (!wasActive) return
      const remaining = getChatSessions()
      router.push(
        remaining.length > 0 ? `/chat?session=${remaining[0].id}` : "/chat"
      )
      setIsOpenMobile(false)
    },
    [activeSessionId, router]
  )
  // Desktop collapse state, persisted per browser. Read on mount only
  // (not in the initializer) so server and client render the same
  // expanded sidebar and hydration never mismatches; a returning
  // collapsed user sees one brief expanded frame, then it collapses.
  const [collapsed, setCollapsed] = React.useState(false)
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem("arco-sidebar-collapsed") === "1") {
        setCollapsed(true)
      }
    } catch {
      // Private mode etc: sidebar just stays expanded.
    }
  }, [])
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      try {
        window.localStorage.setItem("arco-sidebar-collapsed", prev ? "0" : "1")
      } catch {
        // Ignore storage failures; the toggle still works for the session.
      }
      return !prev
    })
  }, [])
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
      {/* NOTE: z-50 is mobile-only. On desktop this aside is a flex
          item of the layout row, and z-index on a flex item creates
          its own stacking context — so a desktop z-50 here would
          outrank the whole main-content column (z-10), capping every
          modal inside it below the sidebar no matter how high the
          modal's own z-index is. That was the real modal-clipping
          bug (raising overlays to z-[100] alone could not fix it).
          lg:z-auto keeps the drawer above content on mobile, where
          the aside is fixed, without creating a desktop context. */}
      <aside
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 lg:z-auto w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-[width,transform] duration-300 ease-in-out lg:translate-x-0 lg:static lg:h-screen lg:shrink-0",
          collapsed ? "lg:w-16" : "lg:w-64",
          isOpenMobile ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Brand Header + desktop collapse toggle. The toggle is
            desktop-only (hidden below lg): on mobile the drawer is
            opened/closed with the hamburger bar instead. When
            collapsed, only the toggle shows, centered. */}
        <div
          className={cn(
            "h-16 px-4 border-b border-sidebar-border flex items-center",
            collapsed ? "justify-center lg:px-0" : "justify-between"
          )}
        >
          <Link
            href="/dashboard"
            onClick={() => setIsOpenMobile(false)}
            className={cn("flex items-center gap-3 group", collapsed && "lg:hidden")}
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
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden lg:inline-flex p-2 rounded-lg border border-border bg-muted text-foreground hover:bg-sidebar-accent shrink-0"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Navigation Items */}
        <div
          className={cn(
            "flex-1 overflow-y-auto py-4 space-y-6 scrollbar-thin",
            collapsed ? "px-2" : "px-3"
          )}
        >
          {navSections.map((section) => (
            <div key={section.heading} className="space-y-1">
              <div
                className={cn(
                  "px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
                  collapsed && "lg:hidden"
                )}
              >
                {section.heading}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isRouteActive(item.href)
                  const Icon = item.icon
                  return (
                    <React.Fragment key={item.href}>
                    <Link
                      href={item.href}
                      title={item.title}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setIsOpenMobile(false)}
                      className={cn(
                        "flex items-center px-2.5 py-2 rounded-lg text-xs font-medium transition-colors group relative",
                        collapsed ? "lg:justify-center lg:px-0" : "justify-between",
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
                        <span className={cn("truncate", collapsed && "lg:hidden")}>
                          {item.title}
                        </span>
                      </div>
                      {item.badge && (
                        <span
                          className={cn(
                            "text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-muted text-primary",
                            collapsed && "lg:hidden"
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                      {active && (
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 text-primary-foreground shrink-0",
                            collapsed && "lg:hidden"
                          )}
                        />
                      )}
                    </Link>
                    {/* Nested chat block: only under the AI Assistant
                        entry, and only on /chat. On every other route
                        nothing extra renders and the entry stays a
                        plain link. Buttons + router.push (not Links)
                        so nothing here is prefetched. The whole block
                        uses the same lg:hidden-when-collapsed pattern
                        as the labels, so collapsed desktop stays
                        icons-only; the mobile drawer is below lg, so
                        it still shows the full block. */}
                    {item.href === "/chat" && isChatRoute && (
                      <div
                        className={cn(
                          "mt-1 ml-6 space-y-1",
                          collapsed && "lg:hidden"
                        )}
                      >
                        <button
                          type="button"
                          onClick={handleNewChat}
                          className="flex w-full items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                        >
                          <Plus className="h-4 w-4 shrink-0 text-primary" />
                          <span>New Chat</span>
                        </button>
                        <div className="px-2.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          RECENT CHATS ({chatSessions.length})
                        </div>
                        <div className="space-y-0.5">
                          {chatSessions.map((session) => {
                            const isActive = session.id === activeSessionId
                            return (
                              <div
                                key={session.id}
                                className={cn(
                                  "group flex items-center justify-between gap-1 px-2.5 py-2 rounded-lg text-xs transition-colors",
                                  isActive
                                    ? "bg-primary text-primary-foreground font-semibold"
                                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleSelectChat(session.id)}
                                  aria-current={isActive ? "true" : undefined}
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                >
                                  <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                  <span className="truncate">
                                    {session.title || "Untitled Session"}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteChat(session.id)}
                                  title="Delete chat"
                                  aria-label={`Delete ${session.title || "Untitled Session"}`}
                                  className="opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:text-red-500 p-0.5 rounded transition-opacity shrink-0"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    </React.Fragment>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar Footer with Single-Role Operator Profile */}
        <div className={cn("border-t border-sidebar-border bg-sidebar-accent", collapsed ? "p-2" : "p-3")}>
          <div
            className={cn(
              "flex items-center gap-2 p-2 rounded-lg bg-card border border-border",
              collapsed ? "lg:justify-center" : "justify-between"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-300 dark:border-emerald-700">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className={cn("min-w-0", collapsed && "lg:hidden")}>
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
