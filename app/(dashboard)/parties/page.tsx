"use client"

/**
 * Parties — one page for a party's whole lifecycle.
 *
 * Tabs (deep-linkable with ?tab=, see TAB_PARAM below):
 * - Directory: create / edit / deactivate / reactivate parties. Uses the
 *   existing party actions in app/actions/masters — the same fields as
 *   the Masters parties tab (code, name, type, contact, phone, address,
 *   notes, opening balance + balance type, tax ID, registration no.).
 * - Statement: one statement tab for customers and vendors alike
 *   (filter by party type), using getPartyStatement from
 *   app/actions/finance — the same read action the Reports party/vendor
 *   tabs use. getVendorStatement is an alias for it, so one call serves
 *   both. Print via CustomerStatementPrint, export CSV / Excel / PDF.
 * - Adjustments: the single home for party adjustments. Wires the
 *   previously orphaned createPartyAdjustment action (app/actions/finance)
 *   into a UI: party, amount, direction, mandatory reason, date. The
 *   action itself is untouched — it writes one party_ledger row
 *   (entry_type 'adjustment', voucher ADJ-…) and an audit-log row.
 * - Openings: party opening balances — the Masters party-form opening
 *   field (edited on the Directory tab) plus the Migration
 *   opening_balances evidence rows (kind 'party'), read via
 *   listOpeningBalances. No new openings model is invented here.
 *
 * Nothing on this page changes what an adjustment or an opening means;
 * it only exposes existing server operations in one place. The old
 * party surfaces on Masters / Billing / Reports / Migration stay in
 * place for now — a later trim team removes them.
 */

import * as React from "react"
import { Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  listParties, createParty, updateParty, deactivateParty, reactivateParty,
} from "@/app/actions/masters"
import {
  getPartyStatement, createPartyAdjustment, listOpeningBalances,
} from "@/app/actions/finance"
import { logExport } from "@/app/actions/audit-log"
import { CustomerStatementPrint } from "@/components/print/customer-statement-print"
import { PrintButton } from "@/components/print/print-button"
import { formatCurrency } from "@/lib/utils"
import { exportReportToCsv, exportToExcel, exportToPdf } from "@/lib/export-utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
} from "@/components/erp-ui"

type Tab = "directory" | "statement" | "adjustments" | "openings"

/** ?tab= contract: directory | statement | adjustments | openings.
 *  Aliases accepted: "adjustment" -> adjustments, "opening" -> openings.
 *  Anything else (or absent) falls back to "directory". An optional
 *  ?party=<party id> preselects that party on the Statement and
 *  Adjustments tabs. */
const TABS: { key: Tab; label: string }[] = [
  { key: "directory", label: "Directory" },
  { key: "statement", label: "Statement" },
  { key: "adjustments", label: "Adjustments" },
  { key: "openings", label: "Openings" },
]

function tabFromParam(raw: string | null): Tab {
  switch ((raw ?? "").toLowerCase()) {
    case "statement": return "statement"
    case "adjustments":
    case "adjustment": return "adjustments"
    case "openings":
    case "opening": return "openings"
    case "directory":
    case "dir":
    default: return "directory"
  }
}

type PartyRow = {
  id: string; code: string; name: string; type?: string | null
  contact_person?: string | null; phone?: string | null; address?: string | null
  opening_balance?: number | null; balance_type?: string | null
  notes?: string | null; tax_id?: string | null; registration_no?: string | null
  is_active?: boolean
}

/** Signed opening, mirroring the statement reader: receivable is +,
 *  payable is −. Display only — the server action owns the real math. */
function signedOpening(amount: number, balanceType?: string | null): number {
  return balanceType === "payable" ? -Math.abs(amount) : Math.abs(amount)
}

const inputCls = "w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
const btnPrimary = "px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
const btnMuted = "px-3 py-1.5 rounded-md bg-muted cursor-pointer disabled:opacity-50 text-xs font-semibold"
const tabBtn = (active: boolean) =>
  `px-3 py-1.5 rounded-md transition-all cursor-pointer text-xs ${active ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function monthStart(): string {
  return new Date().toISOString().slice(0, 8) + "01"
}

function PartiesPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = React.useState<Tab>(() => tabFromParam(searchParams.get("tab")))
  const [parties, setParties] = React.useState<PartyRow[]>([])
  const [openings, setOpenings] = React.useState<any[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [notice, setNotice] = React.useState("")
  const [pending, setPending] = React.useState(false)

  const goTab = (t: Tab) => {
    setTab(t)
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", t)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [pa, ob] = await Promise.all([listParties(true), listOpeningBalances()])
      if (!pa.success) setError(pa.error ?? "Could not load parties.")
      else setParties(Array.isArray(pa.data) ? pa.data : [])
      if (ob.success) setOpenings(Array.isArray(ob.data) ? ob.data : [])
      // listOpeningBalances failing must not hide the directory: the
      // Openings tab reports its own error instead.
      else setOpeningsError(ob.error ?? "Could not load opening balances.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load parties.")
    } finally {
      setIsLoading(false)
    }
  }, [])
  const [openingsError, setOpeningsError] = React.useState("")

  React.useEffect(() => { loadData() }, [loadData])

  const partyName = (id: string) => parties.find((p) => p.id === id)?.name ?? id

  // ---------------- Directory ----------------
  const [dirType, setDirType] = React.useState("all")
  const [dirSearch, setDirSearch] = React.useState("")
  const [dirShowInactive, setDirShowInactive] = React.useState(true)
  const [showNew, setShowNew] = React.useState(false)
  const [deactTarget, setDeactTarget] = React.useState<PartyRow | null>(null)
  const [deactPending, setDeactPending] = React.useState(false)
  const emptyForm = {
    code: "", name: "", type: "customer", contact: "", phone: "",
    address: "", notes: "", opening: 0, balanceType: "receivable",
    taxId: "", regNo: "",
  }
  const [form, setForm] = React.useState(emptyForm)
  const [editTarget, setEditTarget] = React.useState<PartyRow | null>(null)
  const [editForm, setEditForm] = React.useState(emptyForm)

  const dirRows = parties.filter((p) => {
    if (!dirShowInactive && p.is_active === false) return false
    if (dirType !== "all" && (p.type ?? "customer") !== dirType) return false
    if (dirSearch) {
      const hay = `${p.code} ${p.name} ${p.phone ?? ""} ${p.contact_person ?? ""}`.toLowerCase()
      if (!hay.includes(dirSearch.toLowerCase())) return false
    }
    return true
  })

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(""); setNotice("")
    if (!form.code.trim() || !form.name.trim()) { setError("Party code and name are required."); return }
    setPending(true)
    try {
      const res = await createParty({
        code: form.code.trim(), name: form.name.trim(), type: form.type,
        contact_person: form.contact.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        notes: form.notes.trim() || undefined,
        opening_balance: form.opening, balance_type: form.balanceType,
        tax_id: form.taxId.trim() || undefined,
        registration_no: form.regNo.trim() || undefined,
      })
      if (!res.success) { setError(res.error ?? "Could not create party."); return }
      setNotice(`Party ${form.name.trim()} created.`)
      setForm(emptyForm); setShowNew(false); await loadData()
    } finally { setPending(false) }
  }

  function openEdit(p: PartyRow) {
    setEditTarget(p)
    setEditForm({
      code: p.code, name: p.name, type: p.type ?? "customer",
      contact: p.contact_person ?? "", phone: p.phone ?? "",
      address: p.address ?? "", notes: p.notes ?? "",
      opening: Number(p.opening_balance || 0), balanceType: p.balance_type ?? "receivable",
      taxId: p.tax_id ?? "", regNo: p.registration_no ?? "",
    })
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setError(""); setNotice("")
    if (!editForm.name.trim()) { setError("Party name is required."); return }
    setPending(true)
    try {
      const res = await updateParty(editTarget.id, {
        name: editForm.name.trim(), type: editForm.type,
        contact_person: editForm.contact, phone: editForm.phone,
        address: editForm.address, notes: editForm.notes,
        opening_balance: editForm.opening, balance_type: editForm.balanceType,
        tax_id: editForm.taxId.trim() || null,
        registration_no: editForm.regNo.trim() || null,
      })
      if (!res.success) { setError(res.error ?? "Could not update party."); return }
      setNotice(`Party ${editForm.name.trim()} updated.`)
      setEditTarget(null); await loadData()
    } finally { setPending(false) }
  }

  async function handleToggleActive(p: PartyRow, reactivate: boolean) {
    setDeactPending(true)
    try {
      const res = reactivate ? await reactivateParty(p.id) : await deactivateParty(p.id)
      if (!res.success) { setError(res.error ?? "Could not change party status."); return }
      setNotice(`Party ${p.name} ${reactivate ? "reactivated" : "deactivated"}.`)
      setDeactTarget(null); await loadData()
    } finally { setDeactPending(false) }
  }

  // ---------------- Statement ----------------
  const [stmtType, setStmtType] = React.useState("all")
  const [stmtPartyId, setStmtPartyId] = React.useState(() => searchParams.get("party") ?? "")
  const [stmtFrom, setStmtFrom] = React.useState(monthStart())
  const [stmtTo, setStmtTo] = React.useState(today())
  const [stmt, setStmt] = React.useState<any | null>(null)
  const [stmtError, setStmtError] = React.useState("")
  const [stmtLoading, setStmtLoading] = React.useState(false)

  const stmtParties = parties.filter((p) => {
    if (stmtType === "customer") return p.type === "customer" || p.type === "both"
    if (stmtType === "vendor") return p.type === "supplier" || p.type === "both"
    return true
  })

  React.useEffect(() => {
    if (!stmtPartyId || !stmtFrom || !stmtTo) { setStmt(null); return }
    setStmtLoading(true)
    getPartyStatement({ partyId: stmtPartyId, from: stmtFrom, to: stmtTo }).then((res: any) => {
      if (!res.success) { setStmtError(res.error ?? "Could not load statement."); setStmt(null) }
      else { setStmtError(""); setStmt(res.data) }
    }).catch((err) => { setStmtError(err instanceof Error ? err.message : "Could not load statement."); setStmt(null) })
      .finally(() => setStmtLoading(false))
  }, [stmtPartyId, stmtFrom, stmtTo])

  const stmtRows = (stmt?.entries ?? []).map((e: any) => ({
    date: e.date?.slice(0, 10), voucher_no: e.voucher_no,
    debit: Number(e.debit || 0), credit: Number(e.credit || 0),
    balance: Number(e.running_balance || 0),
  }))
  const stmtColumns = [
    { key: "date", label: "Date" }, { key: "voucher_no", label: "Voucher" },
    { key: "debit", label: "Debit" }, { key: "credit", label: "Credit" },
    { key: "balance", label: "Balance" },
  ]

  async function handleStmtExport(format: "csv" | "xlsx" | "pdf") {
    if (!stmt) return
    const opts = {
      title: "Party Statement", dateRange: `${stmtFrom} to ${stmtTo}`,
      totals: { debit: Number(stmt.charges || 0), credit: Number(stmt.settlements || 0) },
    }
    const ok = format === "csv"
      ? exportReportToCsv(stmtRows, "party_statement", stmtColumns as any, opts as any)
      : format === "xlsx"
        ? await exportToExcel(stmtRows, "party_statement", stmtColumns as any, opts as any)
        : await exportToPdf(stmtRows, "party_statement", stmtColumns as any, opts as any)
    if (ok) void logExport({ report: "party_statement", format, filters: { dateRange: `${stmtFrom} to ${stmtTo}` } })
  }

  // ---------------- Adjustments ----------------
  const [adjPartyId, setAdjPartyId] = React.useState(() => searchParams.get("party") ?? "")
  const [adjAmount, setAdjAmount] = React.useState<number>(0)
  const [adjDirection, setAdjDirection] = React.useState<"debit" | "credit">("debit")
  const [adjReason, setAdjReason] = React.useState("")
  const [adjDate, setAdjDate] = React.useState(today())
  const [adjResult, setAdjResult] = React.useState<any | null>(null)
  const [adjError, setAdjError] = React.useState("")

  async function handleAdjustment(e: React.FormEvent) {
    e.preventDefault()
    setAdjError(""); setAdjResult(null)
    if (!adjPartyId) { setAdjError("Select a party."); return }
    if (!(adjAmount > 0)) { setAdjError("Amount must be greater than 0."); return }
    if (!adjReason.trim()) { setAdjError("A reason is mandatory for a party adjustment."); return }
    setPending(true)
    try {
      const res = await createPartyAdjustment({
        partyId: adjPartyId, amount: adjAmount, direction: adjDirection,
        reason: adjReason.trim(), date: adjDate,
      })
      if (!res.success) { setAdjError(res.error ?? "Could not post adjustment."); return }
      setAdjResult(res.data)
      setAdjAmount(0); setAdjReason("")
      // Refresh the statement if it is showing this party, so the new
      // ADJ row appears without leaving the page.
      if (stmtPartyId === adjPartyId) {
        getPartyStatement({ partyId: adjPartyId, from: stmtFrom, to: stmtTo }).then((r: any) => {
          if (r.success) setStmt(r.data)
        })
      }
    } finally { setPending(false) }
  }

  // ---------------- Openings ----------------
  const partyEvidence = openings.filter((o: any) => o.balance_kind === "party")
  const evidenceByParty = new Map<string, number>()
  for (const o of partyEvidence) {
    const pid = String(o.party_id ?? "")
    if (pid) evidenceByParty.set(pid, (evidenceByParty.get(pid) ?? 0) + (Number(o.amount) || 0))
  }

  const typeOptions = ["customer", "supplier", "both", "source"]

  function partyFormFields(f: typeof emptyForm, setF: (v: typeof emptyForm) => void, prefix: string) {
    return (<>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-code`}>Code *</label>
        <input id={`${prefix}-code`} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className={inputCls} required disabled={prefix === "edit"} /></div>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-name`}>Name *</label>
        <input id={`${prefix}-name`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} required /></div>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-type`}>Type</label>
        <select id={`${prefix}-type`} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={inputCls}>
          {typeOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select></div>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-contact`}>Contact person</label>
        <input id={`${prefix}-contact`} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} className={inputCls} /></div>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-phone`}>Phone</label>
        <input id={`${prefix}-phone`} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={inputCls} /></div>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-address`}>Address</label>
        <input id={`${prefix}-address`} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} className={inputCls} /></div>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-opening`}>Opening balance</label>
        <input id={`${prefix}-opening`} type="number" min="0" value={f.opening} onChange={(e) => setF({ ...f, opening: Math.max(0, Number(e.target.value) || 0) })} className={`${inputCls} font-mono`} /></div>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-balance-type`}>Balance type</label>
        <select id={`${prefix}-balance-type`} value={f.balanceType} onChange={(e) => setF({ ...f, balanceType: e.target.value })} className={inputCls}>
          <option value="receivable">Receivable (they owe us)</option>
          <option value="payable">Payable (we owe them)</option>
        </select></div>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-tax`}>Tax ID (NTN)</label>
        <input id={`${prefix}-tax`} value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} placeholder="Optional" className={inputCls} /></div>
      <div><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-reg`}>Registration no. (STRN)</label>
        <input id={`${prefix}-reg`} value={f.regNo} onChange={(e) => setF({ ...f, regNo: e.target.value })} placeholder="Optional" className={inputCls} /></div>
      <div className="sm:col-span-2"><label className="block font-medium text-foreground mb-1" htmlFor={`${prefix}-notes`}>Notes</label>
        <input id={`${prefix}-notes`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={inputCls} /></div>
    </>)
  }

  if (isLoading) return (<div className="space-y-6"><div className="h-7 w-56 bg-muted rounded animate-pulse" /><div className="h-64 bg-muted rounded animate-pulse" /></div>)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Parties</h1>
          <p className="text-xs text-muted-foreground mt-1">Directory, statements, adjustments and opening balances for every party — customers and vendors in one place.</p>
        </div>
        {tab === "directory" && (
          <button type="button" onClick={() => setShowNew((v) => !v)} className={btnPrimary}>{showNew ? "Close form" : "New party"}</button>
        )}
      </div>

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError("")} />}
      {notice && <AlertBanner tone="success" message={notice} onDismiss={() => setNotice("")} />}

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => goTab(t.key)} className={tabBtn(tab === t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === "directory" && (
        <div className="space-y-4">
          {showNew && (
            <form onSubmit={handleCreate} className="expensive-card p-5 space-y-4 text-xs">
              <h2 className="text-sm font-bold text-foreground">New party</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{partyFormFields(form, setForm, "new")}</div>
              <button type="submit" disabled={pending} className={btnPrimary}>{pending ? "Saving…" : "Create party"}</button>
            </form>
          )}
          <div className="expensive-card p-5">
            <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
              <select value={dirType} onChange={(e) => setDirType(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
                <option value="all">All types</option>{typeOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
              </select>
              <input value={dirSearch} onChange={(e) => setDirSearch(e.target.value)} placeholder="Search code, name, phone…" className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
              <label className="flex items-center gap-1.5 text-muted-foreground"><input type="checkbox" checked={dirShowInactive} onChange={(e) => setDirShowInactive(e.target.checked)} /> Show inactive</label>
              <span className="text-muted-foreground">{dirRows.length} parties</span>
            </div>
            {dirRows.length === 0 && <EmptyState title="No parties match these filters" hint="Create a party with the New party button, or clear the search." />}
            {dirRows.length > 0 && (
              <div className="overflow-x-auto"><table className="w-full text-left border-collapse text-xs min-w-[720px]">
                <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Code</th><th className="pb-3 font-bold">Name</th><th className="pb-3 font-bold">Type</th>
                  <th className="pb-3 font-bold">Phone</th><th className="pb-3 font-bold text-right">Opening balance</th><th className="pb-3 font-bold text-center">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {dirRows.map((pty) => (
                    <tr key={pty.id} className="hover:bg-muted transition-colors">
                      <td className="py-3 font-mono font-bold text-muted-foreground">{pty.code}</td>
                      <td className="py-3 font-bold text-foreground">
                        <div>{pty.name}</div>
                        {pty.contact_person && <div className="text-[10px] text-muted-foreground">Attn: {pty.contact_person}</div>}
                        {(pty.tax_id || pty.registration_no) && <div className="text-[10px] text-muted-foreground font-mono">{[pty.tax_id, pty.registration_no].filter(Boolean).join(" · ")}</div>}
                      </td>
                      <td className="py-3 text-muted-foreground capitalize"><span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-bold uppercase">{pty.type}</span></td>
                      <td className="py-3 font-mono text-muted-foreground">{pty.phone || "—"}</td>
                      <td className="py-3 text-right font-mono font-bold text-foreground">{formatCurrency(Number(pty.opening_balance || 0))} ({pty.balance_type})</td>
                      <td className="py-3 text-center">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase">{pty.is_active === false ? "Inactive" : "Active"}</span>
                        <button type="button" onClick={() => openEdit(pty)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Edit</button>
                        {pty.is_active !== false
                          ? (<button type="button" onClick={() => setDeactTarget(pty)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Deactivate</button>)
                          : (<button type="button" onClick={() => handleToggleActive(pty, true)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Reactivate</button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {tab === "statement" && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
            <select value={stmtType} onChange={(e) => { setStmtType(e.target.value); setStmtPartyId("") }} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
              <option value="all">All parties</option><option value="customer">Customers</option><option value="vendor">Vendors</option>
            </select>
            <select value={stmtPartyId} onChange={(e) => setStmtPartyId(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
              <option value="">Select a party</option>{stmtParties.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.code})</option>))}
            </select>
            <label className="font-medium text-foreground" htmlFor="stmt-from">From</label>
            <input id="stmt-from" type="date" value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
            <label className="font-medium text-foreground" htmlFor="stmt-to">To</label>
            <input id="stmt-to" type="date" value={stmtTo} onChange={(e) => setStmtTo(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
            {stmtError && <span className="text-red-600 dark:text-red-400 font-medium">{stmtError}</span>}
          </div>
          {!stmtPartyId && <EmptyState title="Select a party to view its statement" hint="Shows opening balance, charges, settlements and closing. A positive balance means the party owes you." />}
          {stmtLoading && stmtPartyId && <p className="text-xs text-muted-foreground">Loading statement…</p>}
          {stmt && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">Opening: {formatCurrency(Number(stmt.opening || 0))} (master {formatCurrency(Number(stmt.masterOpening || 0))}, migration evidence {formatCurrency(Number(stmt.evidenceOpening || 0))}) · Charges: {formatCurrency(Number(stmt.charges || 0))} · Settlements: {formatCurrency(Number(stmt.settlements || 0))} · Closing: {formatCurrency(Number(stmt.closing || 0))} ({stmt.closingKind})</p>
              <div className="flex flex-wrap justify-end gap-2 mb-3">
                <button type="button" onClick={() => handleStmtExport("csv")} className={btnMuted}>Export CSV</button>
                <button type="button" onClick={() => handleStmtExport("xlsx")} className={btnMuted}>Export Excel</button>
                <button type="button" onClick={() => handleStmtExport("pdf")} className={btnMuted}>Export PDF</button>
                <PrintButton label="Print statement" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
              </div>
              <div className="hidden print:block">
                <CustomerStatementPrint
                  customerName={stmt.party?.name} customerPhone={stmt.party?.phone} customerAddress={stmt.party?.address}
                  dateFrom={stmtFrom} dateTo={stmtTo}
                  openingBalance={Number(stmt.opening || 0)} closingBalance={Number(stmt.closing || 0)}
                  rows={(stmt.entries ?? []).map((e: any) => ({ date: e.date?.slice(0, 10), voucherNo: e.voucher_no, type: e.entry_type, description: e.notes ?? "", debit: Number(e.debit || 0), credit: Number(e.credit || 0), balance: Number(e.running_balance || 0) }))}
                />
              </div>
              <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]">
                <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Voucher</th><th className="pb-3">Type</th><th className="pb-3 text-right">Debit</th><th className="pb-3 text-right">Credit</th><th className="pb-3 text-right">Balance</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {(stmt.entries ?? []).map((e: any) => (<tr key={e.id}><td className="py-2">{e.date?.slice(0, 10)}</td><td className="py-2 font-mono">{e.voucher_no}</td><td className="py-2">{e.entry_type}</td><td className="py-2 text-right">{formatCurrency(Number(e.debit || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(e.credit || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(e.running_balance || 0))}</td></tr>))}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      )}

      {tab === "adjustments" && (
        <div className="space-y-4">
          <form onSubmit={handleAdjustment} className="expensive-card p-5 space-y-4 text-xs">
            <h2 className="text-sm font-bold text-foreground">Post a party adjustment</h2>
            <p className="text-muted-foreground">A manual, audited correction to one party&apos;s ledger. It writes one ledger row (ADJ voucher) and an audit-log row — no cash, stock, invoice or purchase row is created or changed. Debit increases the receivable balance (the party owes more, or a vendor payable falls); credit decreases it.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="block font-medium text-foreground mb-1" htmlFor="adj-party">Party *</label>
                <select id="adj-party" value={adjPartyId} onChange={(e) => setAdjPartyId(e.target.value)} className={inputCls} required>
                  <option value="">Select a party</option>{parties.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.code})</option>))}
                </select></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="adj-amount">Amount *</label>
                <input id="adj-amount" type="number" min="0" step="0.01" value={adjAmount || ""} onChange={(e) => setAdjAmount(Number(e.target.value) || 0)} className={`${inputCls} font-mono`} required /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="adj-direction">Direction *</label>
                <select id="adj-direction" value={adjDirection} onChange={(e) => setAdjDirection(e.target.value as "debit" | "credit")} className={inputCls}>
                  <option value="debit">Debit — party owes more / payable falls</option>
                  <option value="credit">Credit — party owes less / payable rises</option>
                </select></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="adj-date">Date</label>
                <input id="adj-date" type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} className={inputCls} /></div>
              <div className="sm:col-span-2"><label className="block font-medium text-foreground mb-1" htmlFor="adj-reason">Reason *</label>
                <input id="adj-reason" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="Why this correction is needed — stored on the ledger row and in the audit log" className={inputCls} required /></div>
            </div>
            {adjError && <AlertBanner tone="error" message={adjError} onDismiss={() => setAdjError("")} />}
            <button type="submit" disabled={pending} className={btnPrimary}>{pending ? "Posting…" : "Post adjustment"}</button>
            {adjResult && (
              <p className="text-emerald-600 dark:text-emerald-400 font-medium">Posted: voucher {adjResult.voucherNo} — {adjResult.direction} {formatCurrency(Number(adjResult.amount || 0))} for {partyName(adjResult.partyId)}. Reason: {adjResult.reason}</p>
            )}
          </form>
          <div className="expensive-card p-5 text-xs">
            <p className="text-muted-foreground">Adjustments already posted appear on the Statement tab as rows of type “adjustment”. This form is the only place adjustments are posted — the Ledgers page links here instead of having its own form.</p>
          </div>
        </div>
      )}

      {tab === "openings" && (
        <div className="space-y-4">
          {openingsError && <AlertBanner tone="error" message={openingsError} />}
          <div className="expensive-card p-5">
            <h2 className="text-sm font-bold text-foreground mb-1">Master opening balances</h2>
            <p className="text-xs text-muted-foreground mb-3">The opening-balance field from the party form. Edit it on the Directory tab. A payable opening counts as negative in statements; receivable counts as positive.</p>
            <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]">
              <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Party</th><th className="pb-3">Type</th><th className="pb-3 text-right">Opening</th><th className="pb-3 text-right">Migration evidence</th><th className="pb-3 text-right">Combined opening</th></tr></thead>
              <tbody className="divide-y divide-border">
                {parties.map((p) => {
                  const master = Number(p.opening_balance || 0)
                  const evidenceRaw = evidenceByParty.get(p.id) ?? 0
                  const evidence = signedOpening(evidenceRaw, p.balance_type)
                  return (<tr key={p.id}>
                    <td className="py-2 font-bold">{p.name} <span className="text-muted-foreground font-mono">({p.code})</span></td>
                    <td className="py-2 capitalize">{p.type}</td>
                    <td className="py-2 text-right font-mono">{formatCurrency(signedOpening(master, p.balance_type))} ({p.balance_type})</td>
                    <td className="py-2 text-right font-mono">{formatCurrency(evidence)}</td>
                    <td className="py-2 text-right font-mono font-bold">{formatCurrency(signedOpening(master, p.balance_type) + evidence)}</td>
                  </tr>)
                })}
              </tbody>
            </table></div>
          </div>
          <div className="expensive-card p-5">
            <h2 className="text-sm font-bold text-foreground mb-1">Migration evidence rows ({partyEvidence.length})</h2>
            <p className="text-xs text-muted-foreground mb-3">Evidence rows recorded on the Migration page (opening_balances, kind “party”). These are additional opening on top of the master field — they do not change the master field, and the statement breaks the two apart so a double-count is visible. New evidence rows are still recorded on the Migration page; this tab only displays them.</p>
            {partyEvidence.length === 0 && <EmptyState title="No party opening evidence rows" hint="Migration evidence rows for parties will appear here once recorded." />}
            {partyEvidence.length > 0 && (
              <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]">
                <thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Party</th><th className="pb-3 text-right">Amount</th><th className="pb-3">As of</th><th className="pb-3">Note</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {partyEvidence.map((o: any) => (<tr key={o.id}>
                    <td className="py-2 font-bold">{o.party_id ? partyName(String(o.party_id)) : o.entity_key}</td>
                    <td className="py-2 text-right font-mono">{formatCurrency(Number(o.amount || 0))}</td>
                    <td className="py-2">{String(o.as_of ?? "").slice(0, 10)}</td>
                    <td className="py-2 text-muted-foreground">{o.source_note ?? "—"}</td>
                  </tr>))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">Edit party</h3>
              <button type="button" onClick={() => setEditTarget(null)} className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer">✕</button>
            </div>
            <form onSubmit={handleEdit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-3">{partyFormFields(editForm, setEditForm, "edit")}</div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditTarget(null)} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Cancel</button>
                <button type="submit" disabled={pending} className={btnPrimary}>{pending ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deactTarget !== null}
        title={`Deactivate ${deactTarget?.name ?? ""}?`}
        description="The party stays in history and ledgers. It can be reactivated from this page."
        confirmLabel="Deactivate"
        pending={deactPending}
        destructive
        onConfirm={() => deactTarget && handleToggleActive(deactTarget, false)}
        onCancel={() => setDeactTarget(null)}
      />
    </div>
  )
}

export default function PartiesPage() {
  return (
    <Suspense fallback={<div className="space-y-6"><div className="h-7 w-56 bg-muted rounded animate-pulse" /><div className="h-64 bg-muted rounded animate-pulse" /></div>}>
      <PartiesPageInner />
    </Suspense>
  )
}
