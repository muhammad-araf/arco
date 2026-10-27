"use client"

import * as React from "react"
import {
  BarChart3,
  Printer,
  Calendar,
  Building2,
  TrendingUp,
  Boxes,
  Package,
  Layers,
  ArrowUpRight,
} from "lucide-react"
import { getPL, getBardanaLedger, getPartyStatement, getVendorStatement, listExpenses, listInvoices, listCashAccounts, listOpeningBalances, saveCogsApproval, getCogsApproval, getStockValuation } from "@/app/actions/finance"
import { getSettingsSnapshot } from "@/app/actions/settings"
import { listInward } from "@/app/actions/inward"
import { listBatches, listRecipes, listPackingRecords } from "@/app/actions/production"
import { listJobs } from "@/app/actions/machinery"
import { getPayrollRegister, listPayroll, listPayrollPayments, getAttendanceSummary } from "@/app/actions/payroll"
import { CustomerStatementPrint } from "@/components/print/customer-statement-print"
import { PrintButton } from "@/components/print/print-button"
import { getStockSummary, getStockLedger } from "@/app/actions/inventory"
import { listPackagingTypes, listParties, listProducts, listGodowns } from "@/app/actions/masters"
import { formatCurrency, formatWeight, formatBags } from "@/lib/utils"
import { exportReportToCsv, exportToExcel, exportToPdf } from "@/lib/export-utils"
import { logExport } from "@/app/actions/audit-log"
import {
  AlertBanner,
  EmptyState,
  } from "@/components/erp-ui"
import { ReportsSkeleton } from "@/components/route-skeletons"

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = React.useState<"pnl" | "stock" | "ledger" | "bardana" | "party" | "vendor" | "inward" | "production" | "machinery" | "packing" | "expenses" | "payroll" | "valuation">("pnl")
  const [reportError, setReportError] = React.useState("")
  const [pl, setPl] = React.useState<any | null>(null)
  const [ledgerRows, setLedgerRows] = React.useState<any[]>([])
  const [bardanaTotals, setBardanaTotals] = React.useState<any | null>(null)
  const [parties, setParties] = React.useState<any[]>([])
  const [stmtPartyId, setStmtPartyId] = React.useState("")
  const [stmt, setStmt] = React.useState<any | null>(null)
  const [stmtError, setStmtError] = React.useState("")
  const [stockSummary, setStockSummary] = React.useState<any[]>([])
  const [packaging, setPackaging] = React.useState<any[]>([])
  const [jobs, setJobs] = React.useState<any[]>([])
  const [packingRecords, setPackingRecords] = React.useState<any[]>([])
  const [expenses, setExpenses] = React.useState<any[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [cogsInput, setCogsInput] = React.useState("")
  const [cogsBasisInput, setCogsBasisInput] = React.useState("")
  const [cogsNoteInput, setCogsNoteInput] = React.useState("")
  const [appliedCogs, setAppliedCogs] = React.useState<{ amount: number; basis: string; note: string; saved: boolean } | null>(null)
  const [cogsUnavailable, setCogsUnavailable] = React.useState(false)
  const [cogsSaving, setCogsSaving] = React.useState(false)
  // New-report state (loaded lazily when their tab opens, not on first paint)
  const [godowns, setGodowns] = React.useState<any[]>([])
  const [products, setProducts] = React.useState<any[]>([])
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  const [rawStock, setRawStock] = React.useState<any[]>([])
  const [inwardRows, setInwardRows] = React.useState<any[]>([])
  const [inwardStatus, setInwardStatus] = React.useState("")
  const [batches, setBatches] = React.useState<any[]>([])
  const [recipes, setRecipes] = React.useState<any[]>([])
  const [machInvoices, setMachInvoices] = React.useState<any[]>([])
  const [expCategory, setExpCategory] = React.useState("")
  const [expAccount, setExpAccount] = React.useState("")
  const [payReg, setPayReg] = React.useState<any | null>(null)
  const [payAttSummary, setPayAttSummary] = React.useState<any[]>([])
  const [payPeriods, setPayPeriods] = React.useState<any[]>([])
  const [payHistPeriodId, setPayHistPeriodId] = React.useState("")
  const [payHistRows, setPayHistRows] = React.useState<any[]>([])
  const [payLedgerEmpId, setPayLedgerEmpId] = React.useState("")
  const [payLedgerPayments, setPayLedgerPayments] = React.useState<Record<string, any[]>>({})
  // Stock movement view (inside the stock tab)
  const [stockView, setStockView] = React.useState<"current" | "movement">("current")
  const [movGodown, setMovGodown] = React.useState("")
  const [movProduct, setMovProduct] = React.useState("")
  const [movCategory, setMovCategory] = React.useState("")
  const [movOwner, setMovOwner] = React.useState("")
  const [movRows, setMovRows] = React.useState<any[]>([])
  const [movLoading, setMovLoading] = React.useState(false)
  // Paged stock ledger (the ledger tab no longer uses the capped 500-row shape)
  const [ledGodown, setLedGodown] = React.useState("")
  const [ledProduct, setLedProduct] = React.useState("")
  const [ledParty, setLedParty] = React.useState("")
  const [ledVoucher, setLedVoucher] = React.useState("")
  const [ledPage, setLedPage] = React.useState(1)
  const [ledTotal, setLedTotal] = React.useState(0)
  const [ledPagedRows, setLedPagedRows] = React.useState<any[]>([])
  const [ledLoading, setLedLoading] = React.useState(false)
  // Stock valuation tab (finance team's action, loaded defensively)
  const [valStatus, setValStatus] = React.useState<"checking" | "unavailable" | "not-set" | "valued">("checking")
  const [valData, setValData] = React.useState<any | null>(null)
  const [valMethod, setValMethod] = React.useState("")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  // Month defaults come from a client-side effect, never from render
  // (blocking-prerender-current-time under cacheComponents). The skeleton
  // covers first paint, so real defaults are set before content renders.
  const [defaultFrom, setDefaultFrom] = React.useState("")
  const [defaultTo, setDefaultTo] = React.useState("")
  React.useEffect(() => {
    const now = new Date()
    setDefaultFrom(now.toISOString().slice(0, 8) + "01")
    setDefaultTo(now.toISOString().slice(0, 10))
  }, [])

  const effFrom = dateFrom || defaultFrom
  const effTo = dateTo || defaultTo
  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      setReportError("")
      const [plRes, sm, le, ba, pk, pa, pr] = await Promise.all([
        getPL({ from: effFrom, to: effTo, ...(appliedCogs ? { cogsAmount: appliedCogs.amount, cogsBasis: appliedCogs.basis } : {}) }),
        getStockSummary(), getStockLedger({ from: effFrom, to: effTo }),
        getBardanaLedger({ from: effFrom, to: effTo }),
        listPackagingTypes(), listParties(), listProducts(),
      ])
      const failed = [plRes, sm, le, ba, pk, pa, pr].find((x) => !x.success)
      if (failed) setReportError(failed.error ?? "Could not load report data.")
      setPl(plRes.success ? plRes.data : null)
      const productList = Array.isArray(pr.data) ? pr.data : []
      const grouped = new Map<string, any>()
      for (const r of (Array.isArray(sm.data) ? sm.data : []) as any[]) {
        const prod = productList.find((x: any) => x.id === r.product_id)
        const cur = grouped.get(r.product_id) ?? { id: r.product_id, code: prod?.code ?? "", name: r.product_name, category: prod?.category ?? "", totalStock: 0, bagsCount: 0, min_stock: prod?.min_stock ?? 0 }
        cur.totalStock += Number(r.balance_kg) || 0
        grouped.set(r.product_id, cur)
      }
      for (const cur of grouped.values()) {
        const prod = productList.find((x: any) => x.id === cur.id)
        cur.bagsCount = prod?.weight_per_bag ? Math.round(cur.totalStock / prod.weight_per_bag) : 0
      }
      setStockSummary([...grouped.values()])
      setLedgerRows(Array.isArray(le.data) ? le.data : [])
      setBardanaTotals(ba.success ? ba.data : null)
      setPackaging(Array.isArray(pk.data) ? pk.data : [])
      setParties(Array.isArray(pa.data) ? pa.data : [])
      setRawStock(Array.isArray(sm.data) ? sm.data : [])
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "Could not load report data.")
    } finally {
      setIsLoading(false)
    }
  }, [effFrom, effTo, appliedCogs])

  React.useEffect(() => {
    if (!effFrom || !effTo) return
    loadData()
  }, [loadData])

  React.useEffect(() => {
    Promise.all([listGodowns(), listCashAccounts()]).then(([g, c]) => {
      if (g.success) setGodowns(Array.isArray(g.data) ? g.data : [])
      if (c.success) setCashAccounts(Array.isArray(c.data) ? c.data : [])
    })
  }, [])
  React.useEffect(() => {
    // Full product list (with categories) for movement + inward filters.
    listProducts().then((res) => { if (res.success) setProducts(Array.isArray(res.data) ? res.data : []) })
  }, [])

  // Lazy tab data: inward / production / machinery / packing / expenses / payroll.
  React.useEffect(() => {
    if (selectedReport === "inward") listInward({ from: effFrom, to: effTo }).then((r) => { if (r.success) setInwardRows(Array.isArray(r.data) ? r.data : []) })
    if (selectedReport === "production") Promise.all([listBatches({ from: effFrom, to: effTo }), listRecipes(true)]).then(([b, r]) => {
      if (b.success) setBatches(Array.isArray(b.data) ? b.data : [])
      if (r.success) setRecipes(Array.isArray(r.data) ? r.data : [])
    })
    if (selectedReport === "machinery") Promise.all([listJobs({ from: effFrom, to: effTo }), listInvoices({ sourceType: "machinery_job", from: effFrom, to: effTo })]).then(([j, i]) => {
      if (j.success) setJobs(Array.isArray(j.data) ? j.data : [])
      if (i.success) setMachInvoices(Array.isArray(i.data) ? i.data : [])
    })
    if (selectedReport === "packing") listPackingRecords().then((r) => { if (r.success) setPackingRecords(Array.isArray(r.data) ? r.data : []) })
    if (selectedReport === "expenses") listExpenses({ from: effFrom, to: effTo }).then((r) => { if (r.success) setExpenses(Array.isArray(r.data) ? r.data : []) })
    if (selectedReport === "payroll") Promise.all([
      getPayrollRegister({ month: Number(effFrom.slice(5, 7)) || 1, year: Number(effFrom.slice(0, 4)) || 2026 }),
      getAttendanceSummary({ from: effFrom, to: effTo }), listPayroll({}),
    ]).then(([reg, att, per]) => {
      if (reg.success) setPayReg(reg.data)
      if (att.success) setPayAttSummary(Array.isArray((att.data as any)?.employees) ? (att.data as any).employees : [])
      if (per.success) setPayPeriods(Array.isArray(per.data) ? per.data : [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReport, effFrom, effTo])
  React.useEffect(() => {
    if (!payHistPeriodId) { setPayHistRows([]); return }
    listPayrollPayments(payHistPeriodId).then((r) => { if (r.success) setPayHistRows(Array.isArray(r.data) ? r.data : []) })
  }, [payHistPeriodId])
  React.useEffect(() => {
    if (!payLedgerEmpId) return
    const periods = payPeriods.filter((p: any) => p.employee_id === payLedgerEmpId)
    const missing = periods.filter((p: any) => !(p.id in payLedgerPayments))
    if (!missing.length) return
    Promise.all(missing.map((p: any) => listPayrollPayments(p.id).then((r) => ({ id: p.id, rows: r.success && Array.isArray(r.data) ? r.data : [] })))).then((rs) => setPayLedgerPayments((prev) => ({ ...prev, ...Object.fromEntries(rs.map((x) => [x.id, x.rows])) })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payLedgerEmpId, payPeriods.length])

  // Stock movement: every ledger page (no date filter) + opening balances,
  // then opening = openings + pre-period net, closing = opening + period net.
  React.useEffect(() => {
    if (selectedReport !== "stock" || stockView !== "movement") return
    let cancelled = false
    setMovLoading(true)
    ;(async () => {
      try {
        const all: any[] = []
        for (let page = 1; page <= 50; page++) {
          const res: any = await getStockLedger({ page, pageSize: 200 })
          if (!res.success || !res.data) break
          const rows = Array.isArray(res.data.rows) ? res.data.rows : []
          all.push(...rows)
          if (rows.length < 200 || all.length >= (res.data.total ?? 0)) break
        }
        const openings: any = await listOpeningBalances()
        const openRows = openings.success && Array.isArray(openings.data) ? openings.data.filter((o: any) => o.balance_kind === "stock") : []
        if (cancelled) return
        const pools = new Map<string, any>()
        const key = (g: string, p: string, o: string) => `${g}|${p}|${o}`
        for (const o of openRows) {
          const k = key(o.godown_id, o.product_id, o.party_id ?? "")
          const cur = pools.get(k) ?? { godown_id: o.godown_id, product_id: o.product_id, party_id: o.party_id ?? null, opening: 0, inward: 0, consumed: 0, produced: 0, dispatched: 0, adjusted: 0 }
          // An opening dated after the period start is not a period opening.
          if (!effFrom || !o.as_of || String(o.as_of).slice(0, 10) < effFrom) cur.opening += Number(o.quantity || 0)
          pools.set(k, cur)
        }
        for (const r of all) {
          const k = key(r.godown_id, r.product_id, r.party_id ?? "")
          const cur = pools.get(k) ?? { godown_id: r.godown_id, product_id: r.product_id, party_id: r.party_id ?? null, opening: 0, inward: 0, consumed: 0, produced: 0, dispatched: 0, adjusted: 0 }
          const d = String(r.date ?? "").slice(0, 10)
          const inQ = Number(r.inward_qty || 0); const outQ = Number(r.outward_qty || 0)
          if (effFrom && d < effFrom) { cur.opening += inQ - outQ }
          else if ((!effFrom || d >= effFrom) && (!effTo || d <= effTo)) {
            if (r.voucher_type === "inward") cur.inward += inQ
            else if (r.voucher_type === "batch_consume") cur.consumed += outQ
            else if (r.voucher_type === "batch_produce") cur.produced += inQ
            else if (r.voucher_type === "gatepass") cur.dispatched += outQ
            else cur.adjusted += inQ - outQ // adjustment + transfer net
          }
          pools.set(k, cur)
        }
        setMovRows([...pools.values()].map((m) => ({ ...m, closing: m.opening + m.inward - m.consumed + m.produced - m.dispatched + m.adjusted })))
      } finally { if (!cancelled) setMovLoading(false) }
    })()
    return () => { cancelled = true }
  }, [selectedReport, stockView, effFrom, effTo])

  // Paged stock ledger for the ledger tab.
  React.useEffect(() => {
    if (selectedReport !== "ledger") return
    setLedLoading(true)
    getStockLedger({ page: ledPage, pageSize: 50, godownId: ledGodown || undefined, productId: ledProduct || undefined, partyId: ledParty || undefined, voucherNo: ledVoucher || undefined, from: effFrom, to: effTo }).then((res: any) => {
      if (res.success && res.data && Array.isArray(res.data.rows)) { setLedPagedRows(res.data.rows); setLedTotal(res.data.total ?? res.data.rows.length) }
      else if (res.success && Array.isArray(res.data)) { setLedPagedRows(res.data); setLedTotal(res.data.length) }
      setLedLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReport, ledPage, ledGodown, ledProduct, ledParty, ledVoucher, effFrom, effTo])

  // COGS approval + stock valuation (finance team's actions, import only).
  // The valuation method comes from the valuation_method app setting via
  // the settings snapshot; when it is unconfirmed the valuation action
  // itself returns method_not_set with a null total, and no number is shown.
  React.useEffect(() => {
    const month = Number(effFrom.slice(5, 7)) || 1
    const year = Number(effFrom.slice(0, 4)) || 2026
    getCogsApproval({ month, year }).then((res: any) => {
      if (res?.success && res.data) {
        setAppliedCogs({ amount: Number(res.data.amount || 0), basis: res.data.basis ?? "", note: res.data.note ?? "", saved: true })
        setCogsInput(String(res.data.amount ?? "")); setCogsBasisInput(res.data.basis ?? ""); setCogsNoteInput(res.data.note ?? "")
      }
    }).catch(() => undefined)
    setCogsUnavailable(false)
    getSettingsSnapshot().then(async (snap: any) => {
      const method = snap?.success ? String((snap.data as any)?.valuation_method ?? "unconfirmed") : "unconfirmed"
      setValMethod(method)
      if (method !== "last_purchase_cost" && method !== "average_cost") { setValStatus("not-set"); return }
      try {
        const res: any = await getStockValuation(method)
        if (res?.success && res.data?.status === "valued") { setValData(res.data); setValStatus("valued") }
        else setValStatus("not-set")
      } catch { setValStatus("not-set") }
    }).catch(() => setValStatus("unavailable"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effFrom])

  const handleCogsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = Number(cogsInput)
    if (!(amt >= 0) || !Number.isFinite(amt)) return
    const payload = { amount: amt, basis: cogsBasisInput.trim(), note: cogsNoteInput.trim() }
    setCogsSaving(true)
    try {
      const month = Number(effFrom.slice(5, 7)) || 1
      const year = Number(effFrom.slice(0, 4)) || 2026
      const res = await saveCogsApproval({ month, year, ...payload })
      if (res?.success) { setAppliedCogs({ ...payload, saved: true }); setCogsUnavailable(false) }
      else setReportError(res?.error ?? "Could not save the COGS approval.")
    } catch (err) { setReportError(err instanceof Error ? err.message : "Could not save the COGS approval.") }
    finally { setCogsSaving(false) }
  }

  React.useEffect(() => {
    if (!stmtPartyId) { setStmt(null); return }
    const fn = selectedReport === "vendor" ? getVendorStatement : getPartyStatement
    fn({ partyId: stmtPartyId, from: effFrom, to: effTo }).then((res) => {
      if (!res.success) setStmtError(res.error ?? "Could not load the statement.")
      else { setStmtError(""); setStmt(res.data) }
    })
  }, [stmtPartyId, selectedReport, effFrom, effTo])

  const inPeriod = (iso: string) => {
    if (dateFrom && iso.slice(0, 10) < dateFrom) return false
    if (dateTo && iso.slice(0, 10) > dateTo) return false
    return true
  }
  const periodLabel = dateFrom || dateTo
    ? `${dateFrom || "…"} to ${dateTo || "…"}`
    : "All posted records to date"

  // P&L straight from getPL (spec §15): posted invoices only for revenue,
  // receipts never counted as revenue, COGS 0 with a warning unless the
  // accountant supplies an approved valuation. Warnings are shown verbatim.
  const machineryRevenue = Number(pl?.serviceRevenue || 0)
  const packingRevenue = 0 // packing-source invoices are inside serviceRevenue above
  const seedSalesRevenue = Number(pl?.productSalesRevenue || 0)
  const otherRevenue = Number(pl?.otherRevenue || 0)
  const totalRevenue = Number(pl?.revenue ?? machineryRevenue + seedSalesRevenue + otherRevenue)
  const operationalExpenses = Number(pl?.operatingExpenses || 0)
  const bardanaCost = Number(pl?.packagingCost || 0)
  const laborPayroll = Number(pl?.payrollCost || 0)
  const cogsAmount = Number(pl?.cogs || 0)
  const totalCosts = Number(pl?.totalCost ?? operationalExpenses + bardanaCost + laborPayroll + cogsAmount)
  const netProfit = Number(pl?.netProfit ?? totalRevenue - totalCosts)
  const netMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0
  const plWarnings: string[] = Array.isArray(pl?.warnings) ? pl.warnings : []

  const stockTotals = stockSummary.reduce((acc, item) => ({ kg: acc.kg + item.totalStock, bags: acc.bags + item.bagsCount }), { kg: 0, bags: 0 })
  const bardanaEntries: any[] = bardanaTotals?.entries ?? []
  const bardanaRows = packaging.map((pkg) => {
    const recs = bardanaEntries.filter((r) => r.packaging_type_id === pkg.id)
    const consumed = recs.filter((r) => r.voucher_type !== "purchase" && r.voucher_type !== "purchase_return").reduce((a, r) => a + (Number(r.out_qty) || 0), 0)
    const purchased = recs.filter((r) => r.voucher_type === "purchase").reduce((a, r) => a + (Number(r.in_qty) || 0), 0)
    const last = recs[recs.length - 1]
    return {
      ...pkg,
      consumed, purchased,
      damaged: 0, // damaged bags are tracked on packing records, not the bardana ledger
      current_stock: last ? Number(last.running_balance) || 0 : Number(pkg.current_stock || 0),
    }
  })

  // --- New-report computed rows (filters + totals, spec §16) ---
  const godownName = (id: string) => godowns.find((g: any) => g.id === id)?.name ?? id
  const productName = (id: string) => products.find((x: any) => x.id === id)?.name ?? id
  const partyName = (id: string) => parties.find((x: any) => x.id === id)?.name ?? id
  const inwardFiltered = inwardRows.filter((r: any) => (!inwardStatus || r.status === inwardStatus))
  const inwardTotals = inwardFiltered.reduce((a: any, r: any) => {
    const items = r.incoming_goods_items ?? r.items ?? []
    const bags = items.reduce((x: number, it: any) => x + (Number(it.bags) || 0), 0)
    const kg = items.reduce((x: number, it: any) => x + (Number(it.net_weight ?? it.netWeight ?? ((Number(it.gross_weight ?? it.grossWeight ?? 0)) - (Number(it.tare_weight ?? it.tareWeight ?? 0)))) || 0), 0)
    return { vouchers: a.vouchers + 1, bags: a.bags + bags, kg: a.kg + kg }
  }, { vouchers: 0, bags: 0, kg: 0 })
  const recipeName = (id: string) => recipes.find((x: any) => x.id === id)?.name ?? id
  const batchTotals = batches.reduce((a: any, b: any) => {
    const out = (b.production_batch_outputs ?? b.outputs ?? []).reduce((x: number, o: any) => x + (Number(o.qty_kg ?? o.output_kg ?? 0)), 0)
    const inp = (b.production_batch_inputs ?? b.inputs ?? []).reduce((x: number, o: any) => x + (Number(o.qty_kg ?? o.input_kg ?? 0)), 0)
    return { batches: a.batches + 1, inputKg: a.inputKg + inp, outputKg: a.outputKg + out }
  }, { batches: 0, inputKg: 0, outputKg: 0 })
  const machRows = jobs.map((j: any) => {
    const inv = machInvoices.find((i: any) => i.source_id === j.id)
    const bal = inv ? Number(inv.balance_amount ?? Number(inv.total_amount || 0) - Number(inv.paid_amount || 0)) : null
    return { ...j, invoice: inv ?? null, outstanding: !inv || (inv.status === "posted" && (bal ?? 0) > 0) }
  })
  const machOutstanding = machRows.filter((j: any) => j.outstanding)
  const packingTotals = packingRecords.reduce((a: any, r: any) => ({ records: a.records + 1, bags: a.bags + (Number(r.bags_packed ?? r.bagsPacked ?? 0)), damaged: a.damaged + (Number(r.damaged_bags ?? r.damagedBags ?? 0)), weight: a.weight + (Number(r.packed_weight ?? r.packedWeight ?? r.total_weight ?? 0)) }), { records: 0, bags: 0, damaged: 0, weight: 0 })
  const expenseFiltered = expenses.filter((e: any) => (!expCategory || e.category_name === expCategory) && (!expAccount || e.cash_account_id === expAccount))
  const expenseTotals = expenseFiltered.reduce((a: any, e: any) => ({ count: a.count + 1, amount: a.amount + (Number(e.amount || 0)), posted: a.posted + (e.status === "posted" ? Number(e.amount || 0) : 0) }), { count: 0, amount: 0, posted: 0 })
  const movFiltered = movRows.filter((m: any) => {
    if (movGodown && m.godown_id !== movGodown) return false
    if (movProduct && m.product_id !== movProduct) return false
    if (movOwner && (m.party_id ?? "") !== movOwner) return false
    if (movCategory) { const prod = products.find((x: any) => x.id === m.product_id); if (prod?.category !== movCategory) return false }
    return true
  })
  const movTotals = movFiltered.reduce((a: any, m: any) => ({ opening: a.opening + m.opening, inward: a.inward + m.inward, consumed: a.consumed + m.consumed, produced: a.produced + m.produced, dispatched: a.dispatched + m.dispatched, adjusted: a.adjusted + m.adjusted, closing: a.closing + m.closing }), { opening: 0, inward: 0, consumed: 0, produced: 0, dispatched: 0, adjusted: 0, closing: 0 })
  const ledPages = Math.max(1, Math.ceil(ledTotal / 50))
  const payRegRows: any[] = Array.isArray((payReg as any)?.rows) ? (payReg as any).rows : []
  const payRegTotals: any = (payReg as any)?.totals ?? null

  // Shared by the CSV / Excel / PDF buttons below: one definition of the
  // current tab's rows, columns, title, range and totals (spec §16), so
  // all three formats of the same report always agree.
  const getCurrentReportExport = () => {
    const range = `${effFrom} to ${effTo}`
    if (selectedReport === "stock" && stockView !== "movement") return { rows: stockSummary.map((p) => ({ code: p.code, name: p.name, category: p.category, stock_kg: p.totalStock, bags: p.bagsCount, min_stock: p.min_stock || 0 })), filename: "stock_summary_report", columns: [{ key: "code", label: "Code" }, { key: "name", label: "Product" }, { key: "category", label: "Category" }, { key: "stock_kg", label: "Stock (kg)" }, { key: "bags", label: "Bags" }, { key: "min_stock", label: "Min stock" }], options: { title: "Stock Summary", dateRange: range, totals: { stock_kg: stockTotals.kg, bags: stockTotals.bags } }, report: "stock_summary" }
    if (selectedReport === "bardana") return { rows: bardanaRows.map((p) => ({ bag_type: p.name, capacity_kg: p.capacity_kg, consumed: p.consumed, purchased: p.purchased, closing: p.current_stock, unit_cost: p.cost_per_bag })), filename: "bardana_ledger_report", columns: [{ key: "bag_type", label: "Bag type" }, { key: "capacity_kg", label: "Capacity (kg)" }, { key: "consumed", label: "Consumed" }, { key: "purchased", label: "Purchased" }, { key: "closing", label: "Closing" }, { key: "unit_cost", label: "Unit cost" }], options: { title: "Bardana Ledger", dateRange: range, totals: { consumed: Number(bardanaTotals?.consumed || 0), purchased: Number(bardanaTotals?.purchased || 0) } }, report: "bardana_ledger" }
    if (selectedReport === "ledger") return { rows: ledPagedRows.map((e: any) => ({ date: e.date, voucher_no: e.voucher_no, type: e.voucher_type, godown: godownName(e.godown_id), product: productName(e.product_id), user: e.created_by ?? "", lot: e.lot_number ?? "", inward_kg: e.inward_qty, outward_kg: e.outward_qty, balance_kg: e.running_balance })), filename: "stock_ledger_report", columns: [{ key: "date", label: "Date" }, { key: "voucher_no", label: "Voucher" }, { key: "type", label: "Type" }, { key: "godown", label: "Godown" }, { key: "product", label: "Product" }, { key: "user", label: "User" }, { key: "lot", label: "Lot" }, { key: "inward_kg", label: "Inward (kg)" }, { key: "outward_kg", label: "Outward (kg)" }, { key: "balance_kg", label: "Balance (kg)" }], options: { title: "Stock Ledger", dateRange: range }, report: "stock_ledger" }
    if (selectedReport === "party" || selectedReport === "vendor") return { rows: (stmt?.entries ?? []).map((e: any) => ({ date: e.date, voucher_no: e.voucher_no, debit: e.debit, credit: e.credit, balance: e.running_balance })), filename: `${selectedReport}_statement`, columns: [{ key: "date", label: "Date" }, { key: "voucher_no", label: "Voucher" }, { key: "debit", label: "Debit" }, { key: "credit", label: "Credit" }, { key: "balance", label: "Balance" }], options: { title: `${selectedReport === "vendor" ? "Vendor" : "Party"} Statement`, dateRange: range, totals: { debit: Number(stmt?.charges || 0), credit: Number(stmt?.settlements || 0) } }, report: `${selectedReport}_statement` }
    if (selectedReport === "inward") return { rows: inwardFiltered.map((r: any) => ({ date: r.date?.slice(0, 10), voucher_no: r.voucher_no ?? r.inward_no, party: partyName(r.party_id), godown: godownName(r.godown_id), bilty_no: r.bilty_no ?? "", status: r.status, bags: (r.incoming_goods_items ?? r.items ?? []).reduce((x: number, it: any) => x + (Number(it.bags) || 0), 0) })), filename: "incoming_goods_report", columns: [{ key: "date", label: "Date" }, { key: "voucher_no", label: "Voucher" }, { key: "party", label: "Party" }, { key: "godown", label: "Godown" }, { key: "bilty_no", label: "Bilty" }, { key: "status", label: "Status" }, { key: "bags", label: "Bags" }], options: { title: "Incoming Goods", dateRange: range, totals: { bags: inwardTotals.bags } }, report: "incoming_goods" }
    if (selectedReport === "production") return { rows: batches.map((b: any) => ({ date: b.date?.slice(0, 10), batch_no: b.batch_no, recipe: recipeName(b.recipe_id), recipe_version: b.recipe_version_used ?? "", status: b.status, output_kg: b.actual_output_kg ?? "" })), filename: "production_report", columns: [{ key: "date", label: "Date" }, { key: "batch_no", label: "Batch" }, { key: "recipe", label: "Recipe" }, { key: "recipe_version", label: "Recipe version" }, { key: "status", label: "Status" }, { key: "output_kg", label: "Output (kg)" }], options: { title: "Production", dateRange: range, totals: { output_kg: batchTotals.outputKg } }, report: "production" }
    if (selectedReport === "machinery") return { rows: machRows.map((j: any) => ({ date: j.date?.slice(0, 10), job_no: j.job_no, customer: partyName(j.customer_id), machine: j.machine_id, status: j.status, invoice_no: j.invoice?.invoice_no ?? "", outstanding: j.outstanding ? "yes" : "no" })), filename: "machinery_jobs_report", columns: [{ key: "date", label: "Date" }, { key: "job_no", label: "Job" }, { key: "customer", label: "Customer" }, { key: "status", label: "Status" }, { key: "invoice_no", label: "Invoice" }, { key: "outstanding", label: "Outstanding" }], options: { title: "Machinery Jobs", dateRange: range }, report: "machinery_jobs" }
    if (selectedReport === "packing") return { rows: packingRecords.map((r: any) => ({ date: r.date?.slice(0, 10), packing_no: r.packing_no ?? "", product: productName(r.output_product_id), bags_packed: r.bags_packed ?? "", damaged_bags: r.damaged_bags ?? "" })), filename: "packing_report", columns: [{ key: "date", label: "Date" }, { key: "packing_no", label: "Packing no" }, { key: "product", label: "Product" }, { key: "bags_packed", label: "Bags packed" }, { key: "damaged_bags", label: "Damaged bags" }], options: { title: "Packing", dateRange: range, totals: { bags_packed: packingTotals.bags, damaged_bags: packingTotals.damaged } }, report: "packing" }
    if (selectedReport === "expenses") return { rows: expenseFiltered.map((e: any) => ({ date: e.date?.slice(0, 10), expense_no: e.expense_no, category: e.category_name, payee: e.payee, amount: e.amount, status: e.status })), filename: "expenses_report", columns: [{ key: "date", label: "Date" }, { key: "expense_no", label: "Expense no" }, { key: "category", label: "Category" }, { key: "payee", label: "Payee" }, { key: "amount", label: "Amount" }, { key: "status", label: "Status" }], options: { title: "Expenses", dateRange: range, totals: { amount: expenseTotals.amount, posted: expenseTotals.posted } }, report: "expenses" }
    if (selectedReport === "payroll") return { rows: payRegRows.map((p: any) => ({ employee_id: p.employee_id, month: p.month, year: p.year, gross: p.gross_pay, net: p.net_payable, paid: p.paid_amount, balance: p.balance_amount, status: p.status })), filename: "payroll_register_report", columns: [{ key: "employee_id", label: "Employee id" }, { key: "month", label: "Month" }, { key: "year", label: "Year" }, { key: "gross", label: "Gross" }, { key: "net", label: "Net" }, { key: "paid", label: "Paid" }, { key: "balance", label: "Balance" }, { key: "status", label: "Status" }], options: { title: "Payroll Register", dateRange: range, totals: { gross: Number(payRegTotals?.gross || 0), net: Number(payRegTotals?.net || 0) } }, report: "payroll_register" }
    if (selectedReport === "valuation") return { rows: valStatus === "valued" && Array.isArray((valData as any)?.rows) ? (valData as any).rows : [], filename: "stock_valuation_report", columns: [{ key: "productId", label: "Product" }, { key: "closingQty", label: "Closing qty" }, { key: "unitCost", label: "Unit cost" }, { key: "value", label: "Value" }], options: { title: "Stock Valuation", dateRange: range }, report: "stock_valuation" }
    if (selectedReport === "stock" && stockView === "movement") return { rows: movFiltered.map((m: any) => ({ godown: godownName(m.godown_id), product: productName(m.product_id), owner: m.party_id ? partyName(m.party_id) : "Company", opening: m.opening, inward: m.inward, consumed: m.consumed, produced: m.produced, dispatched: m.dispatched, adjusted: m.adjusted, closing: m.closing })), filename: "stock_movement_report", columns: [{ key: "godown", label: "Godown" }, { key: "product", label: "Product" }, { key: "owner", label: "Owner" }, { key: "opening", label: "Opening" }, { key: "inward", label: "Inward" }, { key: "consumed", label: "Consumed" }, { key: "produced", label: "Produced" }, { key: "dispatched", label: "Dispatched" }, { key: "adjusted", label: "Adjusted" }, { key: "closing", label: "Closing" }], options: { title: "Stock Movement", dateRange: range, totals: { opening: movTotals.opening, closing: movTotals.closing } }, report: "stock_movement" }
    return { rows: [{ period: periodLabel, service_revenue: machineryRevenue, product_sales: seedSalesRevenue, other_revenue: otherRevenue, operating_expenses: operationalExpenses, packaging_cost: bardanaCost, payroll_cost: laborPayroll, cogs: cogsAmount, net_profit: netProfit }], filename: "pnl_report", columns: [{ key: "period", label: "Period" }, { key: "service_revenue", label: "Service revenue" }, { key: "product_sales", label: "Product sales" }, { key: "other_revenue", label: "Other revenue" }, { key: "operating_expenses", label: "Operating expenses" }, { key: "packaging_cost", label: "Packaging cost" }, { key: "payroll_cost", label: "Payroll cost" }, { key: "cogs", label: "COGS" }, { key: "net_profit", label: "Net profit" }], options: { title: "Profit & Loss", dateRange: range }, report: "profit_and_loss" }
  }
  const handleReportExport = async (format: "csv" | "xlsx" | "pdf") => {
    const e = getCurrentReportExport()
    const ok = format === "csv"
      ? exportReportToCsv(e.rows, e.filename, e.columns as any, e.options as any)
      : format === "xlsx"
        ? await exportToExcel(e.rows, e.filename, e.columns as any, e.options as any)
        : await exportToPdf(e.rows, e.filename, e.columns as any, e.options as any)
    if (ok) void logExport({ report: e.report, format, filters: { dateRange: `${effFrom} to ${effTo}` } })
  }

  if (isLoading) return <ReportsSkeleton />


  return (
    <div className="space-y-6">
      <AlertBanner tone="warning" message="P&L counts posted invoices only. Receipts are never revenue. This is not audited accounts." />
      {reportError && <AlertBanner tone="error" message={/not configured|Authentication required/i.test(reportError) ? "Supabase is not set up, or sign-in is required. See SETUP.md." : reportError} onDismiss={() => setReportError("")} />}
      {plWarnings.map((w, i) => (<AlertBanner key={i} tone="warning" message={w} />))}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-emerald-500" />
            Reports
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" htmlFor="report-date-from">
            From
            <input id="report-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-2 py-1.5 rounded-lg bg-background border border-border text-foreground font-mono" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" htmlFor="report-date-to">
            To
            <input id="report-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-2 py-1.5 rounded-lg bg-background border border-border text-foreground font-mono" />
          </label>
          <button
            type="button"
            onClick={() => void handleReportExport("csv")}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void handleReportExport("xlsx")}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => void handleReportExport("pdf")}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            Export PDF
          </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
        >
          <Printer className="h-4 w-4" />
          <span>Print Report Sheet (A4)</span>
        </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">Report period: <strong className="text-foreground">{periodLabel}</strong> · Filters and totals are shown on each report, per spec §16.</p>

      {/* Report Switcher Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1 rounded-lg bg-muted border border-border self-start max-w-full text-xs font-semibold">
        <button
          type="button"
          onClick={() => setSelectedReport("pnl")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            selectedReport === "pnl"
              ? "bg-primary text-primary-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Profit & Loss Statement (P.ID P-L)
        </button>
        <button
          type="button"
          onClick={() => setSelectedReport("stock")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            selectedReport === "stock"
              ? "bg-primary text-primary-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Godown Stock Inventory Summary
        </button>
        <button
          type="button"
          onClick={() => setSelectedReport("bardana")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            selectedReport === "bardana"
              ? "bg-primary text-primary-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Bardana & Packaging Ledger
        </button>
        <button type="button" onClick={() => setSelectedReport("ledger")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "ledger" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Stock Ledger</button>
        <button type="button" onClick={() => setSelectedReport("party")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "party" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Party Statement</button>
        <button type="button" onClick={() => setSelectedReport("vendor")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "vendor" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Vendor Statement</button>
        <button type="button" onClick={() => setSelectedReport("inward")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "inward" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Incoming Goods</button>
        <button type="button" onClick={() => setSelectedReport("production")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "production" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Production</button>
        <button type="button" onClick={() => setSelectedReport("machinery")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "machinery" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Machinery Jobs</button>
        <button type="button" onClick={() => setSelectedReport("packing")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "packing" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Packing</button>
        <button type="button" onClick={() => setSelectedReport("expenses")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "expenses" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Expenses</button>
        <button type="button" onClick={() => setSelectedReport("payroll")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "payroll" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Attendance & Payroll</button>
        <button type="button" onClick={() => setSelectedReport("valuation")} className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${selectedReport === "valuation" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"}`}>Stock Valuation</button>
      </div>

      {/* P&L Statement View */}
      {selectedReport === "pnl" && (
        <div className="expensive-card p-6 printable-document space-y-6">
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <h2 className="text-lg font-black text-foreground">ARCO SEED GODOWN & PROCESSING</h2>
              <div className="text-xs text-muted-foreground">Comprehensive Commercial Profit & Loss Statement</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Calculated from posted transaction ledgers</div>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 rounded border border-emerald-500/25">
                Margin: {totalRevenue > 0 ? `+${netMargin}%` : "—"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xs">
            {/* Revenue Column */}
            <div className="space-y-3">
              <h3 className="font-bold text-foreground uppercase tracking-wider text-[11px] pb-1 border-b border-border flex items-center justify-between">
                <span>Operational Revenues</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-mono">{formatCurrency(totalRevenue)}</span>
              </h3>

              <div className="space-y-2">
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Certified Seed Product Sales</span>
                  <strong className="font-mono">{formatCurrency(seedSalesRevenue)}</strong>
                </div>
                <p className="text-[11px] text-muted-foreground px-1">No product-sale invoices exist in this prototype, so sales revenue is 0 — it is not estimated.</p>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Machinery Processing & Grading Charges</span>
                  <strong className="font-mono">{formatCurrency(machineryRevenue)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Final Unit Bardana Packing Fees</span>
                  <strong className="font-mono">{formatCurrency(packingRevenue)}</strong>
                </div>
              </div>
            </div>

            {/* Expenses Column */}
            <div className="space-y-3">
              <h3 className="font-bold text-foreground uppercase tracking-wider text-[11px] pb-1 border-b border-border flex items-center justify-between">
                <span>Recognized Costs & Overheads</span>
                <span className="text-destructive font-mono">{formatCurrency(totalCosts)}</span>
              </h3>

              <div className="space-y-2">
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Cost of Goods Sold (Raw Seeds)</span>
                  <strong className="font-mono text-destructive">{appliedCogs ? `-${formatCurrency(cogsAmount)}` : "— not yet approved"}</strong>
                </div>
                <p className="text-[11px] text-muted-foreground px-1">{appliedCogs ? `${appliedCogs.saved ? "Saved approved COGS" : "Local COGS preview (approval action unavailable)"} for this report: ${appliedCogs.basis || "no basis noted"}${appliedCogs.note ? ` — ${appliedCogs.note}` : ""}.` : "COGS needs an approved inventory valuation method (spec §15.1) and is excluded rather than estimated."}</p>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Packaging Material (Bags Consumed)</span>
                  <strong className="font-mono text-destructive">-{formatCurrency(bardanaCost)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Posted Operating Expenses</span>
                  <strong className="font-mono text-destructive">-{formatCurrency(operationalExpenses)}</strong>
                </div>
                <div className="flex justify-between p-2 rounded bg-muted">
                  <span className="text-foreground">Labor, Operator & Machine Wages</span>
                  <strong className="font-mono text-destructive">{laborPayroll === 0 ? "— no finalized periods" : `-${formatCurrency(laborPayroll)}`}</strong>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleCogsSubmit} className="p-4 rounded-md bg-card border border-border space-y-3">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Approved COGS for this period</h3>
            <p className="text-[11px] text-muted-foreground">The accountant supplies the approved COGS valuation for this period; it is passed to the P&amp;L as-is and is not derived from purchases. Saving uses the finance team&apos;s COGS approval action.</p>
            {cogsUnavailable && <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">COGS approval unavailable — the finance team&apos;s approval action is not available yet, so the amount below is a local preview only and was not saved as an approval.</p>}
            {appliedCogs && !appliedCogs.saved && <p className="text-[11px] text-muted-foreground">Applied as a local preview (not a saved approval).</p>}
            {appliedCogs && appliedCogs.saved && <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">Saved approval loaded for this month{appliedCogs.note ? `: ${appliedCogs.note}` : ""}.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div><label className="block font-medium text-foreground mb-1" htmlFor="cogs-amount-pkr">COGS amount (PKR)</label><input id="cogs-amount-pkr" type="number" value={cogsInput} onChange={(e) => setCogsInput(e.target.value)} min="0" placeholder="e.g. 120000" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="valuation-basis">Valuation basis</label><input id="valuation-basis" value={cogsBasisInput} onChange={(e) => setCogsBasisInput(e.target.value)} placeholder="e.g. Weighted-average closing stock valuation, approved 2026-10-27" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
              <div><label className="block font-medium text-foreground mb-1" htmlFor="cogs-note">Note</label><input id="cogs-note" value={cogsNoteInput} onChange={(e) => setCogsNoteInput(e.target.value)} placeholder="Approver note (optional)" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
            </div>
            <div className="flex justify-end gap-2">
              {appliedCogs && (<button type="button" onClick={() => { setAppliedCogs(null); setCogsInput(""); setCogsBasisInput(""); setCogsNoteInput("") }} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Clear COGS</button>)}
              <button type="submit" disabled={cogsSaving} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60">{cogsSaving ? "Saving…" : "Save COGS approval"}</button>
            </div>
          </form>

          {/* Net Profit Banner */}
          <div className="p-4 rounded-md bg-emerald-100 dark:bg-emerald-900 border border-emerald-300 dark:border-emerald-700 flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">
                Net Operating Profit
              </span>
              <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                {formatCurrency(netProfit)}
              </span>
            </div>
            <div className="text-right text-xs">
              <span className="text-muted-foreground block">Net Profit Margin</span>
              <strong className="text-base text-foreground font-mono font-bold">{totalRevenue > 0 ? `+${netMargin}.0%` : "—"}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Stock Summary Tab: current stock + movement views */}
      {selectedReport === "stock" && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap gap-2 mb-4 text-xs font-semibold">
            <button type="button" onClick={() => setStockView("current")} className={`px-3 py-1.5 rounded-md cursor-pointer ${stockView === "current" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Current stock</button>
            <button type="button" onClick={() => setStockView("movement")} className={`px-3 py-1.5 rounded-md cursor-pointer ${stockView === "movement" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>Stock movement</button>
          </div>
          {stockView === "movement" && (
            <div>
              <div className="flex flex-wrap gap-2 mb-4 text-xs">
                <select value={movGodown} onChange={(e) => setMovGodown(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All godowns</option>{godowns.map((g: any) => (<option key={g.id} value={g.id}>{g.name}</option>))}</select>
                <select value={movProduct} onChange={(e) => setMovProduct(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All products</option>{products.map((x: any) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select>
                <select value={movCategory} onChange={(e) => setMovCategory(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All categories</option>{[...new Set(products.map((x: any) => x.category).filter(Boolean))].map((c: any) => (<option key={c} value={c}>{c}</option>))}</select>
                <select value={movOwner} onChange={(e) => setMovOwner(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All owners</option><option value="">Company stock</option>{parties.map((x: any) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select>
              </div>
              {movLoading ? <p className="text-xs text-muted-foreground">Loading movement…</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[880px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Godown</th><th className="pb-3">Product</th><th className="pb-3">Owner</th><th className="pb-3 text-right">Opening</th><th className="pb-3 text-right">Inward</th><th className="pb-3 text-right">Consumed</th><th className="pb-3 text-right">Produced</th><th className="pb-3 text-right">Dispatched</th><th className="pb-3 text-right">Adjusted</th><th className="pb-3 text-right">Closing</th></tr></thead>
                <tbody className="divide-y divide-border font-mono">
                  {movFiltered.length === 0 && <tr><td colSpan={10} className="py-4 text-muted-foreground font-sans">No movement rows for these filters.</td></tr>}
                  {movFiltered.map((m: any, i: number) => (<tr key={i}><td className="py-2 font-sans">{godownName(m.godown_id)}</td><td className="py-2 font-sans font-semibold">{productName(m.product_id)}</td><td className="py-2 font-sans">{m.party_id ? partyName(m.party_id) : "Company"}</td><td className="py-2 text-right">{formatWeight(m.opening)}</td><td className="py-2 text-right">{formatWeight(m.inward)}</td><td className="py-2 text-right">{formatWeight(m.consumed)}</td><td className="py-2 text-right">{formatWeight(m.produced)}</td><td className="py-2 text-right">{formatWeight(m.dispatched)}</td><td className="py-2 text-right">{formatWeight(m.adjusted)}</td><td className="py-2 text-right font-bold">{formatWeight(m.closing)}</td></tr>))}
                  {movFiltered.length > 0 && (<tr className="border-t-2 border-border font-bold"><td className="py-2 font-sans" colSpan={3}>Totals</td><td className="py-2 text-right">{formatWeight(movTotals.opening)}</td><td className="py-2 text-right">{formatWeight(movTotals.inward)}</td><td className="py-2 text-right">{formatWeight(movTotals.consumed)}</td><td className="py-2 text-right">{formatWeight(movTotals.produced)}</td><td className="py-2 text-right">{formatWeight(movTotals.dispatched)}</td><td className="py-2 text-right">{formatWeight(movTotals.adjusted)}</td><td className="py-2 text-right">{formatWeight(movTotals.closing)}</td></tr>)}
                </tbody></table></div>)}
              <p className="text-[11px] text-muted-foreground mt-3">Opening = opening balances + ledger net before the period. Adjusted includes adjustment vouchers and transfer net (a transfer moves stock between godowns, so it nets within a pool). Computed from stock_ledger + openings; the current-stock view above is the closing balance.</p>
            </div>
          )}
          {stockView === "current" && (
          <div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Product</th>
                  <th className="pb-3 font-bold">Category</th>
                  <th className="pb-3 font-bold text-right">Physical Stock</th>
                  <th className="pb-3 font-bold text-right">Bags</th>
                  <th className="pb-3 font-bold text-right">Valuation Rate</th>
                  <th className="pb-3 font-bold text-right">Inventory Valuation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {stockSummary.map((item) => (
                  <tr key={item.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-bold text-foreground font-sans">{item.name}</td>
                    <td className="py-3 text-muted-foreground capitalize font-sans">{item.category.replace("_", " ")}</td>
                    <td className="py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatWeight(item.totalStock)}</td>
                    <td className="py-3 text-right text-foreground">{item.bagsCount} bags</td>
                    <td className="py-3 text-right text-muted-foreground font-sans">—</td>
                    <td className="py-3 text-right font-black text-foreground">—</td>
                  </tr>
                ))}
                {stockSummary.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 font-sans">
                      <EmptyState title="No products in stock summary" hint="Add products in Masters and post inward vouchers." />
                    </td>
                  </tr>
                )}
                {stockSummary.length > 0 && (
                  <tr className="border-t-2 border-border font-bold">
                    <td className="py-3 font-sans" colSpan={2}>Totals</td>
                    <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">{formatWeight(stockTotals.kg)}</td>
                    <td className="py-3 text-right">{stockTotals.bags} bags</td>
                    <td className="py-3" colSpan={2} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">Valuation is not shown: no costing method is approved yet (spec §5.1). Quantity tracking works without it.</p>
          </div>
          )}
        </div>
      )}

      {/* Bardana Packaging Ledger Tab */}
      {selectedReport === "bardana" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Bardana / Bag Type</th>
                  <th className="pb-3 font-bold">Capacity</th>
                  <th className="pb-3 font-bold text-right">Consumed</th>
                  <th className="pb-3 font-bold text-right">Damaged</th>
                  <th className="pb-3 font-bold text-right">Current Available</th>
                  <th className="pb-3 font-bold text-right">Unit Bag Cost</th>
                  <th className="pb-3 font-bold text-right">Total Bag Asset Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {bardanaRows.map((pkg) => (
                  <tr key={pkg.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-bold text-foreground font-sans">{pkg.name}</td>
                    <td className="py-3 text-muted-foreground font-sans">{pkg.capacity_kg} kg</td>
                    <td className="py-3 text-right font-mono">{pkg.consumed} bags</td>
                    <td className="py-3 text-right font-mono text-red-600 dark:text-red-400">{pkg.damaged} bags</td>
                    <td className="py-3 text-right font-bold text-foreground">{formatBags(pkg.current_stock)}</td>
                    <td className="py-3 text-right text-muted-foreground">{formatCurrency(pkg.cost_per_bag)}</td>
                    <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(pkg.current_stock * pkg.cost_per_bag)}
                    </td>
                  </tr>
                ))}
                {bardanaRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 font-sans">
                      <EmptyState title="No packaging types yet" hint="Add bag types in Masters." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selectedReport === "ledger" && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap gap-2 mb-4 text-xs">
            <select value={ledGodown} onChange={(e) => { setLedGodown(e.target.value); setLedPage(1) }} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All godowns</option>{godowns.map((g: any) => (<option key={g.id} value={g.id}>{g.name}</option>))}</select>
            <select value={ledProduct} onChange={(e) => { setLedProduct(e.target.value); setLedPage(1) }} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All products</option>{products.map((x: any) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select>
            <select value={ledParty} onChange={(e) => { setLedParty(e.target.value); setLedPage(1) }} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All parties</option>{parties.map((x: any) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select>
            <input value={ledVoucher} onChange={(e) => { setLedVoucher(e.target.value); setLedPage(1) }} placeholder="Voucher no" className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
            <span className="text-muted-foreground self-center">Dates use the From / To above. Page {ledPage} of {ledPages} ({ledTotal} rows, 50 per page).</span>
          </div>
          {ledLoading ? <p className="text-xs text-muted-foreground">Loading ledger…</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[880px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Voucher</th><th className="pb-3">Type</th><th className="pb-3">Godown</th><th className="pb-3">Product</th><th className="pb-3">User</th><th className="pb-3">Lot</th><th className="pb-3 text-right">Inward</th><th className="pb-3 text-right">Outward</th><th className="pb-3 text-right">Balance</th></tr></thead>
            <tbody className="divide-y divide-border">
              {ledPagedRows.length === 0 && <tr><td colSpan={10} className="py-4 text-muted-foreground">No ledger rows match these filters.</td></tr>}
              {ledPagedRows.map((e: any) => (<tr key={e.id}><td className="py-2">{e.date?.slice(0, 10)}</td><td className="py-2 font-mono font-bold">{e.voucher_no}</td><td className="py-2">{e.voucher_type}</td><td className="py-2">{godownName(e.godown_id)}</td><td className="py-2">{productName(e.product_id)}</td><td className="py-2 font-mono">{e.created_by ?? "—"}</td><td className="py-2 font-mono">{e.lot_number ?? "—"}</td><td className="py-2 text-right">{formatWeight(Number(e.inward_qty || 0))}</td><td className="py-2 text-right">{formatWeight(Number(e.outward_qty || 0))}</td><td className="py-2 text-right font-bold">{formatWeight(Number(e.running_balance || 0))}</td></tr>))}
            </tbody></table></div>)}
          <div className="flex gap-2 mt-4 text-xs">
            <button type="button" disabled={ledPage <= 1} onClick={() => setLedPage((p) => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-md bg-muted cursor-pointer disabled:opacity-50">Previous</button>
            <button type="button" disabled={ledPage >= ledPages} onClick={() => setLedPage((p) => Math.min(ledPages, p + 1))} className="px-3 py-1.5 rounded-md bg-muted cursor-pointer disabled:opacity-50">Next</button>
          </div>
        </div>
      )}
      {(selectedReport === "party" || selectedReport === "vendor") && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
            <label className="font-medium text-foreground" htmlFor="statement-party">{selectedReport === "vendor" ? "Vendor" : "Party"}</label>
            <select id="statement-party" value={stmtPartyId} onChange={(e) => setStmtPartyId(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select a party</option>{parties.filter((x) => selectedReport === "vendor" ? (x.type === "supplier" || x.type === "both") : (x.type === "customer" || x.type === "both")).map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}</select>
            {stmtError && <span className="text-red-600 dark:text-red-400 font-medium">{stmtError}</span>}
          </div>
          {!stmt && <EmptyState title="Select a party to view its statement" hint="Shows opening balance, charges, settlements and closing. A positive balance means the party owes you." />}
          {stmt && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">Opening: {formatCurrency(Number(stmt.opening || 0))}{stmt.masterOpening !== undefined ? ` (master ${formatCurrency(Number(stmt.masterOpening || 0))}, migration evidence ${formatCurrency(Number(stmt.evidenceOpening || 0))})` : ""} · Charges: {formatCurrency(Number(stmt.charges || 0))} · Settlements: {formatCurrency(Number(stmt.settlements || 0))} · Closing: {formatCurrency(Number(stmt.closing || 0))} ({stmt.closingKind})</p>
              <div className="flex justify-end mb-3"><PrintButton label="Print statement" className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" /></div>
              <div className="hidden print:block">
                <CustomerStatementPrint
                  customerName={stmt.party?.name}
                  customerPhone={stmt.party?.phone}
                  customerAddress={stmt.party?.address}
                  dateFrom={effFrom}
                  dateTo={effTo}
                  openingBalance={Number(stmt.opening || 0)}
                  closingBalance={Number(stmt.closing || 0)}
                  rows={(stmt.entries ?? []).map((e: any) => ({ date: e.date?.slice(0, 10), voucherNo: e.voucher_no, type: e.entry_type, description: e.notes ?? "", debit: Number(e.debit || 0), credit: Number(e.credit || 0), balance: Number(e.running_balance || 0) }))}
                />
              </div>
              <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Voucher</th><th className="pb-3 text-right">Debit</th><th className="pb-3 text-right">Credit</th><th className="pb-3 text-right">Balance</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {(stmt.entries ?? []).map((e: any) => (<tr key={e.id}><td className="py-2">{e.date?.slice(0, 10)}</td><td className="py-2 font-mono">{e.voucher_no}</td><td className="py-2 text-right">{formatCurrency(Number(e.debit || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(e.credit || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(e.running_balance || 0))}</td></tr>))}
                </tbody></table></div>
            </div>
          )}
        </div>
      )}

      {/* Incoming goods */}
      {selectedReport === "inward" && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap gap-2 mb-4 text-xs">
            <select value={inwardStatus} onChange={(e) => setInwardStatus(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All statuses</option><option value="draft">draft</option><option value="posted">posted</option><option value="reversed">reversed</option></select>
            <span className="text-muted-foreground self-center">Period uses From / To above.</span>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[880px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Voucher</th><th className="pb-3">Party</th><th className="pb-3">Godown</th><th className="pb-3">Bilty</th><th className="pb-3">Items</th><th className="pb-3 text-right">Bags</th><th className="pb-3 text-right">Net kg</th><th className="pb-3">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {inwardFiltered.length === 0 && <tr><td colSpan={9} className="py-4 text-muted-foreground">No incoming goods in this period.</td></tr>}
              {inwardFiltered.map((r: any) => {
                const items = r.incoming_goods_items ?? r.items ?? []
                const bags = items.reduce((x: number, it: any) => x + (Number(it.bags) || 0), 0)
                const kg = items.reduce((x: number, it: any) => x + (Number(it.net_weight ?? it.netWeight ?? ((Number(it.gross_weight ?? it.grossWeight ?? 0)) - (Number(it.tare_weight ?? it.tareWeight ?? 0)))) || 0), 0)
                return (<tr key={r.id}><td className="py-2">{r.date?.slice(0, 10)}</td><td className="py-2 font-mono font-bold">{r.voucher_no ?? r.inward_no}</td><td className="py-2">{partyName(r.party_id)}</td><td className="py-2">{godownName(r.godown_id)}</td><td className="py-2 font-mono">{r.bilty_no || "—"}</td><td className="py-2">{items.map((it: any) => productName(it.product_id)).join(", ") || "—"}</td><td className="py-2 text-right">{bags}</td><td className="py-2 text-right">{formatWeight(kg)}</td><td className="py-2">{r.status}</td></tr>)
              })}
              {inwardFiltered.length > 0 && (<tr className="border-t-2 border-border font-bold"><td className="py-2" colSpan={6}>Totals ({inwardTotals.vouchers} vouchers)</td><td className="py-2 text-right">{inwardTotals.bags}</td><td className="py-2 text-right">{formatWeight(inwardTotals.kg)}</td><td /></tr>)}
            </tbody></table></div>
        </div>
      )}
      {/* Production / batches */}
      {selectedReport === "production" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[880px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Batch</th><th className="pb-3">Recipe</th><th className="pb-3">Recipe version</th><th className="pb-3">Lines (in / out)</th><th className="pb-3 text-right">Output kg</th><th className="pb-3">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {batches.length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground">No batches in this period.</td></tr>}
              {batches.map((b: any) => {
                const ins = b.production_batch_inputs ?? b.inputs ?? []
                const outs = b.production_batch_outputs ?? b.outputs ?? []
                return (<tr key={b.id}><td className="py-2">{b.date?.slice(0, 10)}</td><td className="py-2 font-mono font-bold">{b.batch_no}</td><td className="py-2">{recipeName(b.recipe_id)}</td><td className="py-2 font-mono">{b.recipe_version_used ?? "—"}</td><td className="py-2">In: {ins.map((i: any) => `${productName(i.product_id)} ${formatWeight(Number(i.qty_kg ?? 0))}`).join("; ") || "—"}<br />Out: {outs.map((o: any) => `${productName(o.product_id)} ${formatWeight(Number(o.qty_kg ?? 0))}`).join("; ") || "—"}</td><td className="py-2 text-right">{formatWeight(Number(b.actual_output_kg || 0))}</td><td className="py-2">{b.status}</td></tr>)
              })}
              {batches.length > 0 && (<tr className="border-t-2 border-border font-bold"><td className="py-2" colSpan={5}>Totals ({batchTotals.batches} batches)</td><td className="py-2 text-right">{formatWeight(batchTotals.outputKg)}</td><td /></tr>)}
            </tbody></table></div>
        </div>
      )}
      {/* Machinery jobs + outstanding */}
      {selectedReport === "machinery" && (
        <div className="expensive-card p-5">
          <p className="text-xs text-muted-foreground mb-4">{machOutstanding.length} of {machRows.length} jobs outstanding — a job is outstanding when no posted invoice links to it via source_type / source_id, or the linked invoice still has a balance.</p>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[880px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Job</th><th className="pb-3">Customer</th><th className="pb-3">Status</th><th className="pb-3">Linked invoice</th><th className="pb-3 text-right">Invoice balance</th><th className="pb-3">Outstanding</th></tr></thead>
            <tbody className="divide-y divide-border">
              {machRows.length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground">No machinery jobs in this period.</td></tr>}
              {machRows.map((j: any) => (<tr key={j.id}><td className="py-2">{j.date?.slice(0, 10)}</td><td className="py-2 font-mono font-bold">{j.job_no}</td><td className="py-2">{partyName(j.customer_id)}</td><td className="py-2">{j.status}</td><td className="py-2 font-mono">{j.invoice?.invoice_no ?? "—"}</td><td className="py-2 text-right">{j.invoice ? formatCurrency(Number(j.invoice.balance_amount ?? Number(j.invoice.total_amount || 0) - Number(j.invoice.paid_amount || 0))) : "—"}</td><td className="py-2 font-bold">{j.outstanding ? "Yes" : "No"}</td></tr>))}
            </tbody></table></div>
        </div>
      )}
      {/* Packing */}
      {selectedReport === "packing" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[720px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Packing / Batch</th><th className="pb-3">Product</th><th className="pb-3">Packaging</th><th className="pb-3 text-right">Bags packed</th><th className="pb-3 text-right">Damaged</th><th className="pb-3 text-right">Packed weight</th></tr></thead>
            <tbody className="divide-y divide-border">
              {packingRecords.length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground">No packing records.</td></tr>}
              {packingRecords.map((r: any) => (<tr key={r.id}><td className="py-2">{r.date?.slice(0, 10)}</td><td className="py-2 font-mono font-bold">{r.packing_no ?? r.batch_no ?? "—"}</td><td className="py-2">{r.output_product_name ?? productName(r.output_product_id)}</td><td className="py-2">{r.packaging_name ?? "—"}</td><td className="py-2 text-right">{r.bags_packed ?? r.bagsPacked ?? "—"}</td><td className="py-2 text-right">{r.damaged_bags ?? r.damagedBags ?? 0}</td><td className="py-2 text-right">{formatWeight(Number(r.packed_weight ?? r.packedWeight ?? 0))}</td></tr>))}
              {packingRecords.length > 0 && (<tr className="border-t-2 border-border font-bold"><td className="py-2" colSpan={4}>Totals ({packingTotals.records} records)</td><td className="py-2 text-right">{packingTotals.bags}</td><td className="py-2 text-right">{packingTotals.damaged}</td><td className="py-2 text-right">{formatWeight(packingTotals.weight)}</td></tr>)}
            </tbody></table></div>
        </div>
      )}
      {/* Expenses */}
      {selectedReport === "expenses" && (
        <div className="expensive-card p-5">
          <div className="flex flex-wrap gap-2 mb-4 text-xs">
            <select value={expCategory} onChange={(e) => setExpCategory(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All categories</option>{[...new Set(expenses.map((e: any) => e.category_name).filter(Boolean))].map((c: any) => (<option key={c} value={c}>{c}</option>))}</select>
            <select value={expAccount} onChange={(e) => setExpAccount(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">All accounts</option>{cashAccounts.map((a: any) => (<option key={a.id} value={a.id}>{a.name}</option>))}</select>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[720px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Date</th><th className="pb-3">Expense no</th><th className="pb-3">Category</th><th className="pb-3">Payee</th><th className="pb-3">Account</th><th className="pb-3 text-right">Amount</th><th className="pb-3">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {expenseFiltered.length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground">No expenses match these filters.</td></tr>}
              {expenseFiltered.map((e: any) => (<tr key={e.id}><td className="py-2">{e.date?.slice(0, 10)}</td><td className="py-2 font-mono font-bold">{e.expense_no}</td><td className="py-2">{e.category_name}</td><td className="py-2">{e.payee}</td><td className="py-2">{cashAccounts.find((a: any) => a.id === e.cash_account_id)?.name ?? "—"}</td><td className="py-2 text-right">{formatCurrency(Number(e.amount || 0))}</td><td className="py-2">{e.status}</td></tr>))}
              {expenseFiltered.length > 0 && (<tr className="border-t-2 border-border font-bold"><td className="py-2" colSpan={5}>Period totals ({expenseTotals.count} expenses)</td><td className="py-2 text-right">{formatCurrency(expenseTotals.amount)}</td><td className="py-2">posted {formatCurrency(expenseTotals.posted)}</td></tr>)}
            </tbody></table></div>
        </div>
      )}
      {/* Attendance & payroll report */}
      {selectedReport === "payroll" && (
        <div className="expensive-card p-5 space-y-6">
          <div>
            <h2 className="text-sm font-bold text-foreground mb-1">Payroll Register — {effFrom.slice(0, 7)}</h2>
            <p className="text-xs text-muted-foreground mb-3">Totals: gross {formatCurrency(Number(payRegTotals?.gross || 0))} · net {formatCurrency(Number(payRegTotals?.net || 0))} · paid {formatCurrency(Number(payRegTotals?.paid || 0))} · balance {formatCurrency(Number(payRegTotals?.balance || 0))}.</p>
            <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Net</th><th className="pb-2 text-right">Paid</th><th className="pb-2 text-right">Balance</th><th className="pb-2">Status</th></tr></thead>
              <tbody className="divide-y divide-border">
                {payRegRows.length === 0 && <tr><td colSpan={6} className="py-4 text-muted-foreground">No payroll periods for this month.</td></tr>}
                {payRegRows.map((p: any) => (<tr key={p.id}><td className="py-2 font-semibold">{p.employee_id}</td><td className="py-2 text-right">{formatCurrency(Number(p.gross_pay || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.net_payable || 0))}</td><td className="py-2 text-right">{formatCurrency(Number(p.paid_amount || 0))}</td><td className="py-2 text-right font-bold">{formatCurrency(Number(p.balance_amount || 0))}</td><td className="py-2">{p.status}</td></tr>))}
              </tbody></table></div>
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground mb-1">Attendance Summary</h2>
            <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Employee</th><th className="pb-2 text-right">Present</th><th className="pb-2 text-right">Half</th><th className="pb-2 text-right">Leave</th><th className="pb-2 text-right">Absent</th><th className="pb-2 text-right">Holiday</th><th className="pb-2 text-right">Overtime hrs</th></tr></thead>
              <tbody className="divide-y divide-border">
                {payAttSummary.length === 0 && <tr><td colSpan={7} className="py-4 text-muted-foreground">No attendance in this period.</td></tr>}
                {payAttSummary.map((a: any) => (<tr key={a.employeeId}><td className="py-2 font-semibold">{a.employeeId}</td><td className="py-2 text-right">{a.present || 0}</td><td className="py-2 text-right">{a.half_day || 0}</td><td className="py-2 text-right">{a.leave || 0}</td><td className="py-2 text-right">{a.absent || 0}</td><td className="py-2 text-right">{a.holiday || 0}</td><td className="py-2 text-right">{a.overtime_hours || 0}</td></tr>))}
              </tbody></table></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
            <div>
              <h2 className="text-sm font-bold text-foreground mb-1">Payment History</h2>
              <select value={payHistPeriodId} onChange={(e) => setPayHistPeriodId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground mb-3"><option value="">Select period</option>{payPeriods.map((p: any) => (<option key={p.id} value={p.id}>{p.employee_id} — {p.month}/{p.year} ({p.status})</option>))}</select>
              {payHistPeriodId && payHistRows.length === 0 && <p className="text-muted-foreground">No payments for this period yet.</p>}
              {payHistRows.map((r: any) => (<p key={r.id} className="py-1">{r.date?.slice(0, 10)} — {formatCurrency(Number(r.amount || 0))} via {r.payment_method ?? r.account ?? "—"}{r.reference_no ? ` (${r.reference_no})` : ""}</p>))}
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground mb-1">Employee Ledger</h2>
              <select value={payLedgerEmpId} onChange={(e) => setPayLedgerEmpId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground mb-3"><option value="">Select employee</option>{[...new Set(payPeriods.map((p: any) => p.employee_id))].map((id: any) => (<option key={id} value={id}>{id}</option>))}</select>
              {payLedgerEmpId && payPeriods.filter((p: any) => p.employee_id === payLedgerEmpId).map((p: any) => (
                <div key={p.id} className="border border-border rounded-lg p-3 mb-2">
                  <div className="flex justify-between font-semibold"><span>{p.month}/{p.year} ({p.status})</span><span>Net {formatCurrency(Number(p.net_payable || 0))} · Balance {formatCurrency(Number(p.balance_amount || 0))}</span></div>
                  {(payLedgerPayments[p.id] ?? []).length > 0 ? (payLedgerPayments[p.id] ?? []).map((r: any) => (<p key={r.id} className="text-muted-foreground mt-1">{r.date?.slice(0, 10)} — {formatCurrency(Number(r.amount || 0))}</p>)) : (<p className="text-muted-foreground mt-1">No payments yet.</p>)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Stock valuation */}
      {selectedReport === "valuation" && (
        <div className="expensive-card p-5">
          {valStatus === "checking" && <p className="text-xs text-muted-foreground">Checking valuation availability…</p>}
          {valStatus === "unavailable" && <EmptyState title="Stock valuation unavailable" hint="The finance team's stock valuation action is not available yet, so no valuation is shown rather than an invented number." />}
          {valStatus === "not-set" && <EmptyState title="Valuation method not set" hint="The valuation_method app setting is unconfirmed (or has no committed reader yet). Set the method first — no value is shown until then." />}
          {valStatus === "valued" && valData && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">Method: {valMethod} · Total value: {formatCurrency(Number((valData as any).totalValue ?? 0))}</p>
              <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-3">Product</th><th className="pb-3 text-right">Closing qty</th><th className="pb-3 text-right">Unit cost</th><th className="pb-3 text-right">Value</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {((valData as any).rows ?? []).map((r: any, i: number) => (<tr key={i}><td className="py-2 font-semibold">{productName(r.productId)}</td><td className="py-2 text-right">{formatWeight(Number(r.closingQty || 0))}</td><td className="py-2 text-right">{r.unitCost == null ? "—" : formatCurrency(Number(r.unitCost))}</td><td className="py-2 text-right font-bold">{r.value == null ? "—" : formatCurrency(Number(r.value))}</td></tr>))}
                </tbody></table></div>
              {((valData as any).uncostedProductIds ?? []).length > 0 && <p className="text-[11px] text-muted-foreground mt-3">Uncosted products (no purchase history under this method): {((valData as any).uncostedProductIds ?? []).map((id: string) => productName(id)).join(", ")}.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
