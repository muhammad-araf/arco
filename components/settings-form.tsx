"use client"

import * as React from "react"
import { Settings as SettingsIcon, CheckCircle2 } from "lucide-react"
import {
  getSettingsSnapshot,
  updateAppSetting,
  updateCompanySettings,
  listDocNumbering,
  updateDocNumberingPrefix,
} from "@/app/actions/settings"
import {
  type SettingsSnapshot,
  type DocNumberingRow,
} from "@/lib/settings-validation"
import { AlertBanner, SubmitSpinner } from "@/components/erp-ui"
import { SettingsSkeleton } from "@/components/route-skeletons"

const inputCls =
  "w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
const labelCls = "block font-medium text-foreground mb-1"

type SettingsFormProps = {
  /** Snapshot fetched by the server page; null when that fetch failed. */
  initialSnapshot: SettingsSnapshot | null
  /** Numbering rows fetched by the server page; [] when that fetch failed. */
  initialNumbering: DocNumberingRow[]
  /** Error from the server fetch ("" when both fetches succeeded), shown
   *  in the same formError banner the client-side load used to set. */
  initialError: string
}

export function SettingsForm({
  initialSnapshot,
  initialNumbering,
  initialError,
}: SettingsFormProps) {
  // Initial state is seeded from the server-rendered props, so the form
  // paints with content immediately — no mount-time fetch. The only
  // remaining client fetch is loadData(), run after a save to reload
  // fresh values, exactly as the old page did.
  const [isLoading, setIsLoading] = React.useState(false)
  const [formError, setFormError] = React.useState(initialError)
  const [formNotice, setFormNotice] = React.useState("")
  const [pending, setPending] = React.useState(false)

  const [companyName, setCompanyName] = React.useState(
    initialSnapshot?.company?.name ?? "",
  )
  const [companyAddress, setCompanyAddress] = React.useState(
    initialSnapshot?.company?.address ?? "",
  )
  const [companyPhone, setCompanyPhone] = React.useState(
    initialSnapshot?.company?.phone ?? "",
  )
  const [companyEmail, setCompanyEmail] = React.useState(
    initialSnapshot?.company?.email ?? "",
  )
  const [companyLogo, setCompanyLogo] = React.useState(
    initialSnapshot?.company?.logo_url ?? "",
  )
  // Typed as string (not the snapshot's narrow unions) so the select
  // onChange handlers keep accepting plain strings, as before.
  const [businessModel, setBusinessModel] = React.useState<string>(
    initialSnapshot?.business_model ?? "unconfirmed",
  )
  const [valuationMethod, setValuationMethod] = React.useState<string>(
    initialSnapshot?.valuation_method ?? "unconfirmed",
  )
  const [currency, setCurrency] = React.useState(
    initialSnapshot?.currency ?? "PKR",
  )
  const [timeout, setTimeout] = React.useState(
    initialSnapshot ? String(initialSnapshot.session_timeout_minutes) : "60",
  )
  const [cutoverDate, setCutoverDate] = React.useState(
    initialSnapshot?.cutover_date ?? "",
  )
  const [gatepassApproval, setGatepassApproval] = React.useState(
    initialSnapshot?.gatepass_approval_required ?? false,
  )
  const [costLedger, setCostLedger] = React.useState(
    initialSnapshot?.cost_ledger_enabled === true,
  )
  const [tolerance, setTolerance] = React.useState(
    initialSnapshot?.variance_tolerance_pct == null
      ? ""
      : String(initialSnapshot.variance_tolerance_pct),
  )
  const [biltyCheck, setBiltyCheck] = React.useState<string>(
    initialSnapshot?.bilty_duplicate_check ?? "warn",
  )

  const [numbering, setNumbering] = React.useState<DocNumberingRow[]>(initialNumbering)
  const [prefixDrafts, setPrefixDrafts] = React.useState<Record<string, string>>(
    Object.fromEntries(initialNumbering.map((r) => [r.series, r.prefix])),
  )
  const [prefixPending, setPrefixPending] = React.useState<string | null>(null)


  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [snap, num] = await Promise.all([
        getSettingsSnapshot(),
        listDocNumbering(),
      ])
      const failed = [snap, num].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load settings.")
      if (snap.success && snap.data) {
        const s = snap.data as SettingsSnapshot
        setCompanyName(s.company?.name ?? "")
        setCompanyAddress(s.company?.address ?? "")
        setCompanyPhone(s.company?.phone ?? "")
        setCompanyEmail(s.company?.email ?? "")
        setCompanyLogo(s.company?.logo_url ?? "")
        setBusinessModel(s.business_model)
        setValuationMethod(s.valuation_method)
        setCurrency(s.currency)
        setTimeout(String(s.session_timeout_minutes))
        setCutoverDate(s.cutover_date ?? "")
        setGatepassApproval(s.gatepass_approval_required)
        setCostLedger((s as any).cost_ledger_enabled === true)
        setTolerance(s.variance_tolerance_pct === null ? "" : String(s.variance_tolerance_pct))
        setBiltyCheck(s.bilty_duplicate_check)
      }
      if (num.success && Array.isArray(num.data)) {
        setNumbering(num.data as DocNumberingRow[])
        setPrefixDrafts(
          Object.fromEntries((num.data as DocNumberingRow[]).map((r) => [r.series, r.prefix])),
        )
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load settings.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const saveOne = async (key: string, value: unknown) => {
    const res = await updateAppSetting(key, value)
    if (!res.success) {
      setFormError(res.error ?? "Could not save that setting.")
      return false
    }
    return true
  }

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setFormError("")
    try {
      const res = await updateCompanySettings({
        name: companyName.trim() || null,
        address: companyAddress.trim() || null,
        phone: companyPhone.trim() || null,
        email: companyEmail.trim() || null,
        logo_url: companyLogo.trim() || null,
      })
      if (!res.success) {
        setFormError(res.error ?? "Could not save company details.")
        return
      }
      setFormNotice("Company details saved.")
      await loadData()
    } finally {
      setPending(false)
    }
  }

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setFormError("")
    try {
      const timeoutNum = Number(timeout)
      if (!Number.isInteger(timeoutNum) || timeoutNum < 0) {
        setFormError("Session timeout must be a whole number of minutes (0 disables idle sign-out).")
        return
      }
      const toleranceNum = tolerance.trim() === "" ? null : Number(tolerance)
      if (toleranceNum !== null && (!Number.isFinite(toleranceNum) || toleranceNum < 0 || toleranceNum > 100)) {
        setFormError("Variance tolerance must be between 0 and 100, or empty to disable it.")
        return
      }
      const writes: [string, unknown][] = [
        ["business_model", businessModel],
        ["valuation_method", valuationMethod],
        ["currency", currency.trim().toUpperCase()],
        ["session_timeout_minutes", timeoutNum],
        ["cutover_date", cutoverDate.trim() === "" ? null : cutoverDate.trim()],
        ["gatepass_approval_required", gatepassApproval],
        ["cost_ledger_enabled", costLedger],
        ["variance_tolerance_pct", toleranceNum],
        ["bilty_duplicate_check", biltyCheck],
      ]
      for (const [key, value] of writes) {
        if (!(await saveOne(key, value))) return
      }
      setFormNotice("Settings saved.")
      await loadData()
    } finally {
      setPending(false)
    }
  }

  const handleSavePrefix = async (series: string) => {
    const prefix = (prefixDrafts[series] ?? "").trim()
    setPrefixPending(series)
    setFormError("")
    try {
      const res = await updateDocNumberingPrefix(series, prefix)
      if (!res.success) {
        setFormError(res.error ?? "Could not save that prefix.")
        return
      }
      setFormNotice(`Prefix for "${series}" saved. New numbers will use it; issued numbers do not change.`)
      await loadData()
    } finally {
      setPrefixPending(null)
    }
  }

  if (isLoading) return <SettingsSkeleton />

  return (
    <div className="space-y-6">
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      <div>
        <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-emerald-500" />
          Settings
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Only Owner / Admin can save changes. Every save is written to the audit log.
        </p>
      </div>

      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-4">Company</h2>
        <form onSubmit={handleSaveCompany} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div><label className={labelCls} htmlFor="company-name">Name</label><input id="company-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="company-phone">Phone</label><input id="company-phone" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="company-email">Email</label><input id="company-email" type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="company-logo">Logo URL</label><input id="company-logo" value={companyLogo} onChange={(e) => setCompanyLogo(e.target.value)} placeholder="Optional link to the logo image" className={inputCls} /></div>
          <div className="sm:col-span-2"><label className={labelCls} htmlFor="company-address">Address</label><input id="company-address" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} className={inputCls} /></div>
          <div className="sm:col-span-2 flex justify-end"><button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{pending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}<span>{pending ? "Saving…" : "Save company"}</span></button></div>
        </form>
      </div>

      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-4">Business settings</h2>
        <form onSubmit={handleSaveGeneral} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div><label className={labelCls} htmlFor="business-model">Business model</label><select id="business-model" value={businessModel} onChange={(e) => setBusinessModel(e.target.value)} className={inputCls}><option value="unconfirmed">Unconfirmed</option><option value="own">Own seed</option><option value="customer">Customer-owned seed</option><option value="both">Both</option></select></div>
          <div><label className={labelCls} htmlFor="valuation-method">Valuation method</label><select id="valuation-method" value={valuationMethod} onChange={(e) => setValuationMethod(e.target.value)} className={inputCls}><option value="unconfirmed">Unconfirmed</option><option value="last_purchase_cost">Last purchase cost</option><option value="average_cost">Average cost</option></select></div>
          <div><label className={labelCls} htmlFor="currency">Currency</label><input id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="session-timeout">Session timeout (minutes, 0 disables idle sign-out)</label><input id="session-timeout" type="number" min="0" step="1" value={timeout} onChange={(e) => setTimeout(e.target.value)} className={`${inputCls} font-mono`} /></div>
          <div><label className={labelCls} htmlFor="cutover-date">Cutover date</label><input id="cutover-date" type="date" value={cutoverDate} onChange={(e) => setCutoverDate(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="bilty-check">Bilty duplicate check</label><select id="bilty-check" value={biltyCheck} onChange={(e) => setBiltyCheck(e.target.value)} className={inputCls}><option value="off">Off</option><option value="warn">Warn</option><option value="block">Block</option></select></div>
          <div><label className={labelCls} htmlFor="variance-tolerance">Variance tolerance % (empty = disabled)</label><input id="variance-tolerance" type="number" min="0" max="100" step="0.01" value={tolerance} onChange={(e) => setTolerance(e.target.value)} placeholder="Empty = disabled" className={`${inputCls} font-mono`} /></div>
          <div className="flex items-end gap-2 pb-1"><input id="gatepass-approval" type="checkbox" checked={gatepassApproval} onChange={(e) => setGatepassApproval(e.target.checked)} className="h-4 w-4" /><label className="font-medium text-foreground" htmlFor="gatepass-approval">Gate pass approval required</label></div>
          <div className="flex items-end gap-2 pb-1"><input id="cost-ledger-enabled" type="checkbox" checked={costLedger} onChange={(e) => setCostLedger(e.target.checked)} className="h-4 w-4" /><label className="font-medium text-foreground" htmlFor="cost-ledger-enabled">Production cost ledger enabled (off by default — when on, batch/job posts record cost rows)</label></div>
          <div className="sm:col-span-2 flex justify-end"><button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{pending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}<span>{pending ? "Saving…" : "Save settings"}</span></button></div>
        </form>
      </div>

      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Voucher prefixes</h2>
        <p className="text-xs text-muted-foreground mb-4">Changing a prefix affects numbers issued after the change only. The running number never resets here.</p>
        {numbering.length === 0 ? (
          <p className="text-xs text-muted-foreground">No numbering series exist yet — they are created when the first voucher of each type is issued.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[560px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Series</th>
                  <th className="pb-3 font-bold">Prefix</th>
                  <th className="pb-3 font-bold text-right">Last number</th>
                  <th className="pb-3 font-bold text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {numbering.map((row) => (
                  <tr key={row.series}>
                    <td className="py-3 font-mono font-bold text-muted-foreground">{row.series}</td>
                    <td className="py-3"><input aria-label={`Prefix for ${row.series}`} value={prefixDrafts[row.series] ?? row.prefix} onChange={(e) => setPrefixDrafts({ ...prefixDrafts, [row.series]: e.target.value })} className={`${inputCls} font-mono max-w-[160px]`} /></td>
                    <td className="py-3 text-right font-mono">{row.last_no}</td>
                    <td className="py-3 text-center"><button type="button" disabled={prefixPending === row.series} onClick={() => handleSavePrefix(row.series)} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{prefixPending === row.series ? "Saving…" : "Save prefix"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
