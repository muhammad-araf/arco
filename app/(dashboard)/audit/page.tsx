"use client"

import * as React from "react"
import { EmptyState, AlertBanner } from "@/components/erp-ui"
import { AuditSkeleton } from "@/components/route-skeletons"
import { listAudit } from "@/app/actions/audit"

/**
 * Audit log viewer — reads audit_log through the owner_admin/accountant
 * gated listAudit action. The empty state below is shown only when the
 * read genuinely returns no rows, or when the read itself fails (the
 * failure is shown as an error, not as an empty list).
 */
export default function AuditPage() {
  const [userFilter, setUserFilter] = React.useState("")
  const [actionFilter, setActionFilter] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [rows, setRows] = React.useState<any[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [searched, setSearched] = React.useState(false)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await listAudit({
        userEmail: userFilter.trim() || undefined,
        action: actionFilter || undefined,
        from: from || undefined,
        to: to || undefined,
      })
      if (!res.success) {
        setFormError(res.error ?? "Could not load audit rows.")
        setRows([])
      } else {
        setRows(Array.isArray(res.data) ? res.data : [])
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load audit rows.")
      setRows([])
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleSearch = async () => {
    setSearched(true)
    setFormError("")
    setIsLoading(true)
    try {
      const res = await listAudit({
        userEmail: userFilter.trim() || undefined,
        action: actionFilter || undefined,
        from: from || undefined,
        to: to || undefined,
      })
      if (!res.success) {
        setFormError(res.error ?? "Could not load audit rows.")
        setRows([])
      } else {
        setRows(Array.isArray(res.data) ? res.data : [])
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load audit rows.")
      setRows([])
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading && !searched) return <AuditSkeleton />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-foreground">Audit Log</h1>
        <p className="text-xs text-muted-foreground mt-1">Owner/Admin and Accountant only. Newest first, up to 100 rows.</p>
      </div>
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <div className="expensive-card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block font-medium text-foreground mb-1">User (email)</label>
            <input
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder="operator@example.com"
              className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
            />
          </div>
          <div>
            <label className="block font-medium text-foreground mb-1">Action</label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
            >
              <option value="">All actions</option>
              <option value="post">post</option>
              <option value="reverse">reverse</option>
              <option value="return">return</option>
              <option value="permission_change">permission_change</option>
              <option value="attendance_correction">attendance_correction</option>
              <option value="create">create</option>
              <option value="update">update</option>
              <option value="deactivate">deactivate</option>
              <option value="reactivate">reactivate</option>
              <option value="approve">approve</option>
              <option value="pay">pay</option>
              <option value="payroll_adjustment">payroll_adjustment</option>
            </select>
          </div>
          <div>
            <label className="block font-medium text-foreground mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
            />
          </div>
          <div>
            <label className="block font-medium text-foreground mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleSearch}
          className="mt-3 inline-flex px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
        >
          Apply filters
        </button>
      </div>
      {rows.length === 0 && !formError ? (
        <EmptyState
          title="No audit rows match these filters"
          hint="The audit log is empty for this filter, or nothing has been recorded yet."
        />
      ) : (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">When</th>
                  <th className="pb-3 font-bold">User</th>
                  <th className="pb-3 font-bold">Action</th>
                  <th className="pb-3 font-bold">Entity</th>
                  <th className="pb-3 font-bold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-muted transition-colors">
                    <td className="py-2 font-mono text-muted-foreground">{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</td>
                    <td className="py-2">{r.user_email || r.user_id || "—"}</td>
                    <td className="py-2 font-bold">{r.action}</td>
                    <td className="py-2 font-mono">{r.entity_type}{r.entity_id ? ` / ${String(r.entity_id).slice(0, 8)}` : ""}</td>
                    <td className="py-2 text-muted-foreground">{r.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
