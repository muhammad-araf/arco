"use client"

import { postToken } from "@/lib/idempotency"

import * as React from "react"
import {
  FileCheck2,
  Plus,
  Printer,
  ShieldCheck,
  Download,
} from "lucide-react"
import { listGatePasses, getGatePass, postGatePass, reverseGatePass, approveGatePass, getGatePassInitData } from "@/app/actions/gatepass"
import { getStockSummary } from "@/app/actions/inventory"
import { listGodowns, listProducts, listParties, listPackagingTypes } from "@/app/actions/masters"
import { getCompanySettings, getAppSetting } from "@/app/actions/settings"
import { GatePassPrint } from "@/components/print/gate-pass-print"
import { PrintButton } from "@/components/print/print-button"
import { GatePass, GatePassItem, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatDate, formatDateTime } from "@/lib/utils"
import { exportReportToCsv, exportToExcel, exportToPdf } from "@/lib/export-utils"
import { logExport } from "@/app/actions/audit-log"
import {
  AlertBanner,
  EmptyState,
  FilterBanner,
  ReversalDialog,
  getUrlFilter,
  isTodayISO,
} from "@/components/erp-ui"
import { GatePassDialog } from "@/components/gate-pass-dialog"
import { GatePassReturnDialog } from "@/components/gate-pass-return-dialog"
import { GatePassRejectDialog } from "@/components/gate-pass-reject-dialog"
import { GatepassSkeleton } from "@/components/route-skeletons"

/** A gate pass row plus the spec §9 columns (kept local so this page
 *  does not depend on shared-type edits owned by other teams). */
type GatePassRow = GatePass & {
  receiver_name?: string | null
  receiver_contact?: string | null
  dispatch_mode?: string | null
  prepared_by?: string | null
  approved_by?: string | null
  rejection_reason?: string | null
  reversal_reason?: string | null
  return_reason?: string | null
  returned_at?: string | null
  reversed_at?: string | null
  items: (GatePassItem & { packaging_type_id?: string | null; party_id?: string | null })[]
}

/** Time-of-day from an ISO date, e.g. "10:35 AM", for the print header. */
function formatTime(dateString: string | null | undefined): string {
  if (!dateString) return ""
  const d = new Date(dateString)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

export default function GatePassPage() {
  const [gatePasses, setGatePasses] = React.useState<GatePassRow[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])
  const [owners, setOwners] = React.useState<Party[]>([])
  const [packagingTypes, setPackagingTypes] = React.useState<any[]>([])
  const [approvalRequired, setApprovalRequired] = React.useState(false)
  const [company, setCompany] = React.useState<{ name?: string; address?: string; phone?: string; email?: string; logoUrl?: string } | undefined>(undefined)
  const [summaryRows, setSummaryRows] = React.useState<any[]>([])
  const [returnTarget, setReturnTarget] = React.useState<any | null>(null)
  const [returnLines, setReturnLines] = React.useState<{
    productId: string; productName: string; partyId: string | null; ownerName: string; remainingKg: number; qtyKg: number
    condition: string; restockDecision: "accepted" | "rejected"
  }[]>([])

  // Modal / Print State
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [selectedPassForPrint, setSelectedPassForPrint] = React.useState<GatePassRow | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [reversalTarget, setReversalTarget] = React.useState<GatePassRow | null>(null)
  const [rejectTarget, setRejectTarget] = React.useState<GatePassRow | null>(null)
  const [isApproving, setIsApproving] = React.useState(false)
  const [isReversing, setIsReversing] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)

  // Register filters (combined with the dashboard drill-down filter).
  const [filterStatus, setFilterStatus] = React.useState("")
  const [filterCustomer, setFilterCustomer] = React.useState("")
  const [filterVehicle, setFilterVehicle] = React.useState("")
  const [filterFrom, setFilterFrom] = React.useState("")
  const [filterTo, setFilterTo] = React.useState("")

  // "Today" for the today-only filter, from client-side effect state (see
  // isTodayISO): never read new Date() during render.
  const [todayStr, setTodayStr] = React.useState<string | null>(null)
  React.useEffect(() => { setTodayStr(new Date().toISOString().slice(0, 10)) }, [])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const initRes = await getGatePassInitData()
      if (!initRes.success) {
        setFormError(initRes.error ?? "Could not load gate pass data.")
        return
      }
      const data = initRes.data as any
      const godownList = (Array.isArray(data.godowns) ? data.godowns : []) as Godown[]
      const productList = (Array.isArray(data.products) ? data.products : []) as Product[]
      const partyList = (Array.isArray(data.parties) ? data.parties : []) as Party[]
      const packagingList = (Array.isArray(data.packagingTypes) ? data.packagingTypes : []) as any[]
      setGodowns(godownList); setProducts(productList); setCustomers(partyList.filter((x) => x.type === "customer" || x.type === "both")); setOwners(partyList)
      setPackagingTypes(packagingList)
      if (data.company) {
        const c = data.company as any
        setCompany({ name: c.name ?? undefined, address: c.address ?? undefined, phone: c.phone ?? undefined, email: c.email ?? undefined, logoUrl: c.logo_url ?? undefined })
      }
      // Approval gate display only: the server re-reads the setting on
      // every post, so a stale or missing value here only affects the
      // confirm-dialog wording, never the enforced behaviour.
      try {
        const ap = await getAppSetting("gatepass_approval_required")
        const v = (ap as any)?.data
        setApprovalRequired(v === true || v === "true" || (v && typeof v === "object" && (v.required === true || v.enabled === true || v.value === true)))
      } catch {
        setApprovalRequired(false)
      }
      setSummaryRows(Array.isArray(sm.data) ? sm.data : [])
      setGatePasses((Array.isArray(gp.data) ? gp.data : []).map((row: any) => ({
        ...row,
        customer_name: partyList.find((x) => x.id === row.customer_id)?.name ?? "Not set",
        godown_name: godownList.find((x) => x.id === row.godown_id)?.name ?? "Not set",
        items: (row.gate_pass_items ?? row.items ?? []).map((it: any) => ({
          ...it, product_name: productList.find((x) => x.id === it.product_id)?.name ?? "Not set",
        })),
      })))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load gate pass data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Mount load: without this the page never leaves its skeleton —
  // isLoading starts true and only post-action handlers reloaded before.
  React.useEffect(() => { loadData() }, [loadData])

  // Dashboard drill-down: apply ?filter= on mount, like the other
  // register pages (inward, payroll, daybook) already do.
  React.useEffect(() => { setDrillFilter(getUrlFilter()) }, [])

  // Post a draft pass from the register (e.g. one saved via "Save as
  // draft" or rejected back to draft). Uses the existing post action;
  // a posted pass opens its print document immediately.
  const handlePostDraft = async (gp: GatePassRow) => {
    if (isPending) return
    setIsPending(true)
    try {
      const posted = await postGatePass(gp.id, postToken("gatepass:post", gp.id))
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the gate pass.")
        return
      }
      const row: any = posted.data ?? gp
      if (row.status === "awaiting_approval") {
        setFormNotice(`${gp.pass_no} submitted for approval — stock will be deducted when it is approved.`)
      } else {
        setFormNotice(`${gp.pass_no} dispatched — ${formatWeight(row.total_weight_kg ?? gp.total_weight_kg)} deducted from ${gp.godown_name || "the godown"}.`)
      }
      if (row.status === "posted") {
        const fresh = await getGatePass(gp.id)
        const serverRow: any = fresh.success ? fresh.data : row
        setSelectedPassForPrint({
          ...serverRow,
          customer_name: customers.find((x) => x.id === serverRow.customer_id)?.name ?? serverRow.customer_id,
          godown_name: godowns.find((x) => x.id === serverRow.godown_id)?.name ?? serverRow.godown_id,
          items: (serverRow.gate_pass_items ?? serverRow.items ?? []).map((it: any) => ({
            ...it,
            product_name: products.find((x) => x.id === it.product_id)?.name ?? "Not set",
          })),
        })
      }
      await loadData()
    } finally {
      setIsPending(false)
    }
  }

  // Opens the return modal with the quantity still returnable per
  // (product, owner) pool: dispatched minus already-returned rows.
  const openReturnModal = async (gp: any) => {
    const fresh = await getGatePass(gp.id)
    if (!fresh.success) {
      setFormError(fresh.error ?? "Could not load the gate pass.")
      return
    }
    const row: any = fresh.data
    const dispatched = (row.gate_pass_items ?? []) as any[]
    const prior = (row.gate_pass_returns ?? []) as any[]
    const byKey = new Map<string, any>()
    for (const d of dispatched) {
      const key = `${d.product_id}|${d.party_id ?? ""}`
      const cur = byKey.get(key) ?? { productId: d.product_id, partyId: d.party_id ?? null, remainingKg: 0 }
      cur.remainingKg += Number(d.net_weight_kg) || 0
      byKey.set(key, cur)
    }
    for (const r of prior) {
      const key = `${r.product_id}|${r.party_id ?? ""}`
      const cur = byKey.get(key)
      if (cur) cur.remainingKg -= Number(r.qty_kg) || 0
    }
    const lines = [...byKey.values()]
      .filter((l) => l.remainingKg > 0)
      .map((l) => ({
        ...l,
        remainingKg: Math.round(l.remainingKg * 100) / 100,
        qtyKg: Math.round(l.remainingKg * 100) / 100,
        condition: "",
        restockDecision: "accepted" as const,
        productName: products.find((p) => p.id === l.productId)?.name ?? l.productId,
        ownerName: l.partyId ? (owners.find((o) => o.id === l.partyId)?.name ?? l.partyId) : "Company",
      }))
    if (!lines.length) {
      setFormError(`${gp.pass_no} has nothing left to return.`)
      return
    }
    setReturnTarget(gp)
    setReturnLines(lines)
  }

  // Spec §9.3 step 4: approval deducts stock; rejection returns the
  // pass to draft. Both are owner_admin-only on the server (interim —
  // the client has not yet defined who approves under §19).
  const handleApprove = async (gp: GatePassRow) => {
    if (isApproving) return
    setIsApproving(true)
    try {
      const res = await approveGatePass(gp.id, postToken("gatepass:approve", gp.id))
      if (!res.success) {
        setFormError(res.error ?? "Could not approve the gate pass.")
        return
      }
      setFormNotice(`${gp.pass_no} approved — ${formatWeight(gp.total_weight_kg)} deducted from stock.`)
      await loadData()
    } finally {
      setIsApproving(false)
    }
  }

  // Spec §9.3: cancellation after posting creates a reversal with reason;
  // the pass stays searchable as "reversed" and stock is restored by
  // compensating inward ledger rows. The pass number is never reused.
  const handleConfirmReversal = async (reasonCode: string, reason: string) => {
    if (!reversalTarget || isReversing) return
    setIsReversing(true)
    try {
      const res = await reverseGatePass(reversalTarget.id, `${reasonCode}: ${reason}`, postToken("gatepass:reverse", reversalTarget.id))
      if (!res.success) {
        setFormError(res.error ?? "Could not reverse the gate pass.")
        return
      }
      setFormNotice(`${reversalTarget.pass_no} reversed — dispatched stock restored. Reason recorded: ${reasonCode}.`)
      setReversalTarget(null)
      await loadData()
    } finally {
      setIsReversing(false)
    }
  }

  // Dialog callbacks: notice banner + register reload.
  const handleDialogSaved = (notice: string) => {
    setFormNotice(notice)
    void loadData()
  }

  const drillPasses = drillFilter === "today"
    ? gatePasses.filter((gp) => isTodayISO(gp.date, todayStr))
    : drillFilter === "posted"
      ? gatePasses.filter((gp) => gp.status === "posted")
      : gatePasses

  // Register filters: status, customer, vehicle, and date range, on
  // top of any dashboard drill-down filter.
  const visiblePasses = drillPasses.filter((gp) =>
    (!filterStatus || gp.status === filterStatus) &&
    (!filterCustomer || gp.customer_id === filterCustomer) &&
    (!filterVehicle || gp.vehicle_no.toLowerCase().includes(filterVehicle.toLowerCase())) &&
    (!filterFrom || gp.date.slice(0, 10) >= filterFrom) &&
    (!filterTo || gp.date.slice(0, 10) <= filterTo),
  )

  // Shared by the CSV / Excel / PDF buttons: one definition of the export
  // rows, columns, title and totals, so all formats agree.
  const getGatepassExport = () => ({
    rows: visiblePasses.map((gp) => ({
      pass_no: gp.pass_no, date: formatDate(gp.date), customer: gp.customer_name,
      receiver_name: gp.receiver_name || "", receiver_contact: gp.receiver_contact || "",
      dispatch_mode: gp.dispatch_mode || "",
      destination: gp.destination || "Direct", godown: gp.godown_name,
      vehicle_no: gp.vehicle_no, driver_name: gp.driver_name,
      driver_phone: gp.driver_phone || "N/A", bags: gp.total_bags,
      weight_kg: gp.total_weight_kg, status: gp.status,
      prepared_by: gp.prepared_by || "", approved_by: gp.approved_by || "",
      return_reason: gp.return_reason || "", returned_at: gp.returned_at ? formatDate(gp.returned_at) : "",
      reversal_reason: gp.reversal_reason || "", reversed_at: gp.reversed_at ? formatDate(gp.reversed_at) : "",
    })),
    filename: "gate_pass_register",
    columns: [{ key: "pass_no", label: "Pass no" }, { key: "date", label: "Date" }, { key: "customer", label: "Customer" }, { key: "receiver_name", label: "Receiver" }, { key: "receiver_contact", label: "Receiver contact" }, { key: "dispatch_mode", label: "Dispatch mode" }, { key: "destination", label: "Destination" }, { key: "godown", label: "Godown" }, { key: "vehicle_no", label: "Vehicle" }, { key: "driver_name", label: "Driver" }, { key: "driver_phone", label: "Driver phone" }, { key: "bags", label: "Bags" }, { key: "weight_kg", label: "Weight (kg)" }, { key: "status", label: "Status" }, { key: "prepared_by", label: "Prepared by" }, { key: "approved_by", label: "Approved by" }, { key: "return_reason", label: "Return reason" }, { key: "returned_at", label: "Returned at" }, { key: "reversal_reason", label: "Reversal reason" }, { key: "reversed_at", label: "Reversed at" }],
    options: { title: "Gate Pass Register", dateRange: filterFrom || filterTo ? `${filterFrom || "…"} to ${filterTo || "…"}` : undefined, totals: { bags: visiblePasses.reduce((a, gp) => a + (gp.total_bags || 0), 0), weight_kg: visiblePasses.reduce((a, gp) => a + (gp.total_weight_kg || 0), 0) } },
    report: "gate_passes",
  })
  const handleGatepassExport = async (format: "csv" | "xlsx" | "pdf") => {
    const e = getGatepassExport()
    const ok = format === "csv"
      ? exportReportToCsv(e.rows, e.filename, e.columns as any, e.options as any)
      : format === "xlsx"
        ? await exportToExcel(e.rows, e.filename, e.columns as any, e.options as any)
        : await exportToPdf(e.rows, e.filename, e.columns as any, e.options as any)
    if (ok) void logExport({ report: e.report, format })
  }

  if (isLoading) return <GatepassSkeleton />


  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <FileCheck2 className="h-6 w-6 text-emerald-500" />
            Gate Pass
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleGatepassExport("csv")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title="Download CSV"
          >
            <Download className="h-4 w-4 text-emerald-500" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => void handleGatepassExport("xlsx")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title="Download Excel"
          >
            <Download className="h-4 w-4 text-emerald-500" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={() => void handleGatepassExport("pdf")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title="Download PDF"
          >
            <Download className="h-4 w-4 text-emerald-500" />
            <span>Export PDF</span>
          </button>


          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>New Gate Pass</span>
          </button>
        </div>
      </div>

      {/* Register filters: status / customer / vehicle / date range */}
      <div className="expensive-card p-4 flex flex-wrap items-end gap-3 text-xs">
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="filter-status">Status</label>
          <select id="filter-status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="awaiting_approval">Awaiting Approval</option>
            <option value="posted">Posted</option>
            <option value="partially_returned">Partially Returned</option>
            <option value="returned">Returned</option>
            <option value="reversed">Reversed</option>
          </select>
        </div>
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="filter-customer">Customer</label>
          <select id="filter-customer" value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="filter-vehicle">Vehicle</label>
          <input id="filter-vehicle" type="text" value={filterVehicle} onChange={(e) => setFilterVehicle(e.target.value)} placeholder="e.g. LES-4419" className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
        </div>
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="filter-from">From</label>
          <input id="filter-from" type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
        </div>
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="filter-to">To</label>
          <input id="filter-to" type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
        </div>
        {(filterStatus || filterCustomer || filterVehicle || filterFrom || filterTo) && (
          <button type="button" onClick={() => { setFilterStatus(""); setFilterCustomer(""); setFilterVehicle(""); setFilterFrom(""); setFilterTo("") }} className="px-3 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Clear filters</button>
        )}
      </div>

      {/* Dispatched Passes Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Gate Passes ({visiblePasses.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Gate Pass No</th>
                <th className="pb-3 font-bold">Date & Time</th>
                <th className="pb-3 font-bold">Customer / Receiver</th>
                <th className="pb-3 font-bold">Vehicle / Driver</th>
                <th className="pb-3 font-bold">Dispatch Godown</th>
                <th className="pb-3 font-bold text-right">Bags</th>
                <th className="pb-3 font-bold text-right">Weight (kg)</th>
                <th className="pb-3 font-bold text-center">Status</th>
                <th className="pb-3 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visiblePasses.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4">
                    <EmptyState
                      title={drillFilter ? "No gate passes match this filter" : "No gate passes issued yet"}
                      hint={drillFilter ? "Clear the filter to see all passes." : "Create your first gate pass."}
                      actionLabel="Create & Authorize Gate Pass"
                      onAction={() => setIsModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
              {visiblePasses.map((gp) => (
                <tr key={gp.id} className="hover:bg-muted transition-colors">
                  <td className="py-3 font-bold text-foreground">
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                      {gp.pass_no}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground">{formatDate(gp.date)}</td>
                  <td className="py-3 font-semibold text-foreground">
                    <div>{gp.customer_name}</div>
                    {gp.receiver_name && <div className="text-[10px] text-muted-foreground">Receiver: {gp.receiver_name}</div>}
                    {gp.destination && <div className="text-[10px] text-muted-foreground">{gp.destination}</div>}
                  </td>
                  <td className="py-3 text-muted-foreground">
                    <div className="font-mono font-bold text-foreground">{gp.vehicle_no}</div>
                    <div className="text-[10px]">{gp.driver_name} {gp.driver_phone && `(${gp.driver_phone})`}</div>
                  </td>
                  <td className="py-3 text-muted-foreground">{gp.godown_name}</td>
                  <td className="py-3 text-right font-semibold text-foreground">
                    {formatBags(gp.total_bags)}
                  </td>
                  <td className="py-3 text-right font-black text-blue-600 dark:text-blue-400">
                    {formatWeight(gp.total_weight_kg)}
                  </td>
                  <td className="py-3 text-center">
                    <span className={gp.status === "reversed" ? "px-2 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase border border-red-500/20" : gp.status === "draft" ? "px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase border border-amber-500/20" : gp.status === "awaiting_approval" ? "px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-400 text-[10px] font-bold uppercase border border-violet-500/20" : gp.status === "returned" || gp.status === "partially_returned" ? "px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase border border-blue-500/20" : "px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase border border-emerald-500/20"}>
                      {gp.status === "draft" ? "Draft" : gp.status === "awaiting_approval" ? "Awaiting Approval" : gp.status === "reversed" ? "Reversed" : gp.status === "returned" ? "Returned" : gp.status === "partially_returned" ? "Partially Returned" : "Posted"}
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {gp.status === "draft" && (
                        <button
                          type="button"
                          onClick={() => void handlePostDraft(gp)}
                          disabled={isPending}
                          className="px-2 py-1 rounded-md hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                          title="Post this draft: deducts stock (or sends for approval when approval is on)"
                        >
                          Post
                        </button>
                      )}
                      {gp.status === "awaiting_approval" && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleApprove(gp)}
                            disabled={isApproving}
                            className="px-2 py-1 rounded-md hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                            title="Approve: deducts stock (owner_admin only)"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectTarget(gp)}
                            className="px-2 py-1 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer"
                            title="Reject back to draft with a reason"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {gp.status === "posted" ? (
                        <button
                          type="button"
                          onClick={() => setSelectedPassForPrint(gp)}
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                          title="Print A4 Gate Pass"
                          aria-label="Print A4 Gate Pass"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="p-1.5 rounded-md text-muted-foreground opacity-50 cursor-not-allowed"
                          title="Printing is available only for posted passes"
                          aria-label="Printing is available only for posted passes"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                      )}
                      {(gp.status === "posted" || gp.status === "partially_returned") && (
                        <button
                          type="button"
                          onClick={() => openReturnModal(gp)}
                          className="px-2 py-1 rounded-md hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-semibold cursor-pointer"
                          title="Return part or all of this pass"
                        >
                          Return
                        </button>
                      )}
                      {(gp.status === "posted" || gp.status === "partially_returned") && (
                        <button
                          type="button"
                          onClick={() => setReversalTarget(gp)}
                          className="px-2 py-1 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer"
                          title="Reverse this dispatched pass (requires a reason)"
                        >
                          Reverse
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gate pass preview: the SAME GatePassPrint document that prints,
          so preview and paper can never drift apart. Company details
          come from settings (getCompanySettings); when none are
          configured the header simply renders without them. */}
      {selectedPassForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white text-black rounded-md shadow-md max-h-[90dvh] overflow-y-auto">
            <div className="p-4 sm:p-6">
              <GatePassPrint
                company={company}
                passNo={selectedPassForPrint.pass_no}
                date={formatDate(selectedPassForPrint.date)}
                time={formatTime(selectedPassForPrint.date)}
                status={selectedPassForPrint.status}
                customerName={selectedPassForPrint.customer_name}
                receiverName={selectedPassForPrint.receiver_name ?? undefined}
                receiverContact={selectedPassForPrint.receiver_contact ?? undefined}
                destination={selectedPassForPrint.destination}
                godown={selectedPassForPrint.godown_name}
                orderRef={selectedPassForPrint.order_ref}
                transporter={selectedPassForPrint.transporter}
                vehicleNo={selectedPassForPrint.vehicle_no}
                driverName={selectedPassForPrint.driver_name}
                driverPhone={selectedPassForPrint.driver_phone}
                dispatchMode={selectedPassForPrint.dispatch_mode ?? undefined}
                notes={selectedPassForPrint.notes}
                attachmentUrl={(selectedPassForPrint as any).attachment_url ?? undefined}
                attachmentNote={(selectedPassForPrint as any).attachment_note ?? undefined}
                preparedBy={selectedPassForPrint.prepared_by ?? undefined}
                approvedBy={selectedPassForPrint.approved_by ?? undefined}
                receiverSignName={selectedPassForPrint.receiver_name ?? undefined}
                items={selectedPassForPrint.items.map((it) => ({ product: it.product_name, bags: it.bags_count, weightKg: it.net_weight_kg, grossWeightKg: it.gross_weight_kg, bagType: it.packaging_type_id ? (packagingTypes.find((t: any) => t.id === it.packaging_type_id)?.name ?? undefined) : undefined, remarks: it.remarks }))}
              />
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 px-4 sm:px-6 pb-4 sm:pb-6 pt-4 border-t border-gray-200 no-print">
              <button
                type="button"
                onClick={() => setSelectedPassForPrint(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              {selectedPassForPrint.status === "posted" ? (
                <PrintButton label="Print Official Gate Pass (A4)" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
              ) : (
                <p className="text-xs text-muted-foreground">Printing is available only for posted passes.</p>
              )}
            </div>
          </div>
        </div>
      )}
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.pass_no ?? ""}
        note="The dispatched stock will be restored. The pass number will never be reused."
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
      <GatePassDialog
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        godowns={godowns}
        products={products}
        customers={customers}
        owners={owners}
        packagingTypes={packagingTypes}
        summaryRows={summaryRows}
        approvalRequired={approvalRequired}
        setGodowns={setGodowns}
        setProducts={setProducts}
        setCustomers={setCustomers}
        setOwners={setOwners}
        setPackagingTypes={setPackagingTypes}
        onSaved={handleDialogSaved}
        onPrinted={(v) => setSelectedPassForPrint(v)}
      />
      <GatePassReturnDialog
        open={returnTarget !== null}
        target={returnTarget}
        initialLines={returnLines}
        onClose={() => setReturnTarget(null)}
        onSaved={handleDialogSaved}
      />
      <GatePassRejectDialog
        open={rejectTarget !== null}
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onSaved={handleDialogSaved}
      />
    </div>
  )
}
