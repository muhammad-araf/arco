"use client"

import * as React from "react"
import { getMyProfile, listProfiles, setUserRole, type AppRole } from "@/app/actions/auth"
import { PageSkeleton, AlertBanner, EmptyState, ConfirmDialog } from "@/components/erp-ui"

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

export default function UsersPage() {
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
    setNotice(`Role for ${target.display_name ?? target.id} changed to ${ROLE_LABELS[newRole]}.`)
    setTarget(null)
    setReason("")
    await load()
  }

  if (loading) return <PageSkeleton />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-foreground">Users</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Only Owner / Admin can change roles. Every change needs a reason, and the last active Owner / Admin cannot be demoted.
        </p>
      </div>
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
                  <td className="py-2.5 pr-3 font-semibold text-foreground">{p.display_name ?? p.id}</td>
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
      <ConfirmDialog
        open={target !== null}
        title={`Change role for ${target?.display_name ?? ""}?`}
        description="The last active Owner / Admin cannot be demoted."
        confirmLabel="Change role"
        pending={pending}
        onCancel={() => setTarget(null)}
        onConfirm={confirmRoleChange}
      />
      {target && (
        <div className="expensive-card p-4 space-y-3 text-xs">
          <div>
            <label className="block font-medium text-foreground mb-1">New role *</label>
            <select
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
            <label className="block font-medium text-foreground mb-1">Reason * (required, at least 3 characters)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why is this role changing?"
              className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground resize-y"
            />
            {!pending && reason.trim().length < 3 && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                Enter a reason first — confirming without one is blocked by the server and by this form.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
