"use client"

import * as React from "react"
import Link from "next/link"
import { getMyProfile, listProfiles, setUserRole, type AppRole } from "@/app/actions/auth"
import { AlertBanner, EmptyState } from "@/components/erp-ui"
import { PeopleSkeleton } from "@/components/route-skeletons"

const ROLE_LABELS: Record<AppRole, string> = {
  owner_admin: "Owner / Admin",
  storekeeper: "Storekeeper",
  production_operator: "Production Operator",
  gate_operator: "Gate Operator",
  accountant: "Accountant",
  hr_payroll: "HR / Payroll",
  read_only_manager: "Read-only Manager",
}

type ProfileRow = {
  id: string
  role: AppRole
  display_name?: string | null
  is_active?: boolean
  created_at?: string
}

export default function PeoplePage() {
  const [activeTab, setActiveTab] = React.useState<"employees" | "system-users">("employees")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [notice, setNotice] = React.useState("")
  const [myRole, setMyRole] = React.useState<AppRole | null>(null)
  const [profiles, setProfiles] = React.useState<ProfileRow[]>([])
  const [target, setTarget] = React.useState<ProfileRow | null>(null)
  const [newRole, setNewRole] = React.useState<AppRole>("storekeeper")
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setError("")
      const me = await getMyProfile()
      if (!me.success) {
        setError(me.error ?? "Could not load your profile.")
        setLoading(false)
        return
      }
      const actor = me.data
      setMyRole(actor?.role ?? null)
      if (!actor) {
        setError("Sign in as an operator to manage users.")
        setLoading(false)
        return
      }
      if (actor.role !== "owner_admin") {
        setLoading(false)
        return
      }
      const res = await listProfiles()
      if (!res.success) setError(res.error ?? "Could not load operator profiles.")
      else setProfiles(Array.isArray(res.data) ? (res.data as ProfileRow[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load user data.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  async function confirmRoleChange() {
    if (!target) return
    if (reason.trim().length < 3) {
      setError("A reason of at least 3 characters is required.")
      return
    }
    setPending(true)
    const res = await setUserRole(target.id, newRole, reason.trim())
    setPending(false)
    if (!res.success) {
      setError(res.error ?? "Role change failed.")
      return
    }
    setNotice(`Role for ${target.display_name ?? "this operator"} changed to ${ROLE_LABELS[newRole]}.`)
    setTarget(null)
    setReason("")
    await load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-foreground">People</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Employees and the operators who sign in to this system.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1 rounded-lg bg-muted border border-border self-start max-w-full text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("employees")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            activeTab === "employees" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Employees
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("system-users")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            activeTab === "system-users" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          System users
        </button>
      </div>

      {activeTab === "employees" && (
        <div className="expensive-card p-5 space-y-2">
          <p className="text-xs text-muted-foreground">
            Employees — their records, attendance, and pay — are managed on the Employees page.
          </p>
          <Link
            href="/employees"
            className="inline-flex items-center px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            Go to Employees
          </Link>
        </div>
      )}

      {activeTab === "system-users" && (
        <>
          {loading ? (
            <PeopleSkeleton />
          ) : (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">
                Only Owner / Admin can change roles. Every change needs a reason, and the last active
                Owner / Admin cannot be demoted. New logins are created by the operator in Supabase
                Authentication (see SETUP.md §3) — they appear here once their profile row is linked.
              </p>
              {error && (
                <AlertBanner
                  tone="error"
                  message={
                    /not configured/i.test(error)
                      ? "Supabase is not set up, or sign-in is required. See SETUP.md."
                      : error
                  }
                  onDismiss={() => setError("")}
                />
              )}
              {notice && <AlertBanner tone="success" message={notice} onDismiss={() => setNotice("")} />}
              {myRole && myRole !== "owner_admin" ? (
                <EmptyState
                  title="Requires Owner / Admin"
                  hint={`Your role is ${ROLE_LABELS[myRole]}. Only Owner / Admin can manage users.`}
                />
              ) : profiles.length === 0 && !error ? (
                <EmptyState
                  title="No operator profiles found"
                  hint="Profiles appear when an operator signs in. Seed the first Owner / Admin (see SETUP.md), then return here."
                  actionLabel="Reload"
                  onAction={load}
                />
              ) : (
                <div className="expensive-card p-5 overflow-x-auto">
                  <table className="w-full text-xs min-w-[560px]">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3 font-semibold">Operator</th>
                        <th className="py-2 pr-3 font-semibold">Role</th>
                        <th className="py-2 pr-3 font-semibold">Status</th>
                        <th className="py-2 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profiles.map((p) => (
                        <tr key={p.id} className="border-b border-border/40 last:border-0">
                          <td className="py-2.5 pr-3 font-semibold text-foreground">{p.display_name ?? "Not set"}</td>
                          <td className="py-2.5 pr-3">{ROLE_LABELS[p.role] ?? p.role}</td>
                          <td className="py-2.5 pr-3">{p.is_active === false ? "Inactive" : "Active"}</td>
                          <td className="py-2.5">
                            <button
                              type="button"
                              onClick={() => {
                                setTarget(p)
                                setNewRole(p.role)
                                setReason("")
                              }}
                              className="px-3 py-1.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border font-semibold cursor-pointer"
                            >
                              Change role
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {target && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 overflow-y-auto"
          onClick={() => {
            if (!pending) {
              setTarget(null)
              setReason("")
            }
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Change role for ${target.display_name ?? "this operator"}`}
            onClick={(e) => e.stopPropagation()}
            className="expensive-card w-full max-w-md p-4 sm:p-6 bg-card border border-border shadow-md rounded-md space-y-4 my-auto max-h-[90dvh] overflow-y-auto text-xs"
          >
            <div>
              <h3 className="text-base font-bold text-foreground">
                Change role for {target.display_name ?? "this operator"}?
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                The last active Owner / Admin cannot be demoted.
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
            <div>
              <label htmlFor="user-new-role" className="block font-medium text-foreground mb-1">New role *</label>
              <select
                id="user-new-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as AppRole)}
                className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
              >
                {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="user-role-reason" className="block font-medium text-foreground mb-1">Reason * (required, at least 3 characters)</label>
              <textarea
                id="user-role-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this role changing?"
                className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground resize-y"
              />
              {!pending && reason.trim().length < 3 && (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  Enter a reason first — confirming without one is blocked by the server and by this form.
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setTarget(null)
                  setReason("")
                }}
                disabled={pending}
                className="px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={confirmRoleChange}
                disabled={pending || reason.trim().length < 3}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending ? "Changing…" : "Change role"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
