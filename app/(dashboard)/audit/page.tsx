"use client"

import * as React from "react"
import { EmptyState, AlertBanner } from "@/components/erp-ui"

/**
 * Audit log viewer — honest empty state (Phase 2 gap, reported upstream).
 *
 * Server actions write audit rows (lib/audit.ts → audit_log, INSERT-only)
 * on every post / reverse / return / permission change, but no server
 * action exists yet to READ audit_log back for display. This page therefore
 * shows the filter controls it will use (user, action, date) and states
 * plainly that no rows can be listed until a read action lands — it never
 * invents audit rows or falls back to local demo data.
 */
export default function AuditPage() {
  const [userFilter, setUserFilter] = React.useState("")
  const [actionFilter, setActionFilter] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [searched, setSearched] = React.useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-foreground">Audit Log</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Append-only trail of posts, reversals, returns and permission changes (spec §17). Audit rows are written
          by the server actions, but no audit-read action exists yet, so this viewer cannot list rows until one is added.
        </p>
      </div>
      <AlertBanner
        tone="warning"
        message="Audit viewer pending: audit rows are written on the server, but there is no read action for audit_log yet. Nothing below is real audit data — use the filters once a read action lands; do not treat this empty view as proof that nothing happened."
      />
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
          onClick={() => setSearched(true)}
          className="mt-3 inline-flex px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
        >
          Apply filters
        </button>
        {searched && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Filters kept for the future read action (user: {userFilter || "any"}, action: {actionFilter || "any"}, dates:{" "}
            {from || "—"} to {to || "—"}). No rows can be returned yet.
          </p>
        )}
      </div>
      <EmptyState
        title="No audit rows can be listed yet"
        hint="This is a missing backend read action, not an empty history: posts, reversals, returns and role changes made through the server actions do write to audit_log (INSERT-only). Once an audit-read action exists, this page will list those rows filtered by user, action and date."
      />
    </div>
  )
}
