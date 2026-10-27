"use client"

import { postToken } from "@/lib/idempotency"

import * as React from "react"
import {
  Truck,
  Plus,
  Printer,
  CheckCircle2,
  Calendar,
  Warehouse,
  User,
  ArrowRight,
  Trash2,
  FileText,
  Boxes,
} from "lucide-react"
import { listInward, getInward, createInwardDraft, postInward, reverseInward } from "@/app/actions/inward"
import { listGodowns, listProducts, listParties } from "@/app/actions/masters"
import { getCompanySettings } from "@/app/actions/settings"
import { InwardSlipPrint } from "@/components/print/inward-slip-print"
import { AttachmentFields } from "@/components/attachment-fields"
import { PrintButton } from "@/components/print/print-button"
import { IncomingGoodsVoucher, IncomingGoodsItem, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatCurrency, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  ReversalDialog,
  SubmitSpinner,
  getUrlFilter,
  isPositive,
  isTodayISO,
} from "@/components/erp-ui"
import { InwardSkeleton } from "@/components/route-skeletons"

export default function InwardPage() {
  const [vouchers, setVouchers] = React.useState<IncomingGoodsVoucher[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [parties, setParties] = React.useState<Party[]>([])
  const [owners, setOwners] = React.useState<Party[]>([])
  const [ownerId, setOwnerId] = React.useState("")
  const [company, setCompany] = React.useState<{ name?: string; address?: string; phone?: string; email?: string; logoUrl?: string } | null>(null)
  const [inwardDate, setInwardDate] = React.useState("")
  const [receivedBy, setReceivedBy] = React.useState("")
  const [byHand, setByHand] = React.useState(false)
  const [nature, setNature] = React.useState("")
  const [attachmentUrl, setAttachmentUrl] = React.useState("")
  const [attachmentNote, setAttachmentNote] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [fromDate, setFromDate] = React.useState("")
  const [toDate, setToDate] = React.useState("")
  const [inwardPage, setInwardPage] = React.useState(1)
  const [inwardTotal, setInwardTotal] = React.useState(0)
  const [formWarning, setFormWarning] = React.useState("")
  const filterRef = React.useRef({ search: "", from: "", to: "" })

  // Modal / Form state
  const [isFormOpen, setIsFormOpen] = React.useState(false)
  const [selectedVoucherForPrint, setSelectedVoucherForPrint] = React.useState<IncomingGoodsVoucher | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showPostConfirm, setShowPostConfirm] = React.useState(false)
  const [draftVoucher, setDraftVoucher] = React.useState<IncomingGoodsVoucher | null>(null)
  const [reversalTarget, setReversalTarget] = React.useState<IncomingGoodsVoucher | null>(null)
  const [isReversing, setIsReversing] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const postGuard = React.useRef(false)

  // Form Fields
  const [partyId, setPartyId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [biltyNo, setBiltyNo] = React.useState("")
  const [vehicleNo, setVehicleNo] = React.useState("")
  const [driverName, setDriverName] = React.useState("")
  const [driverPhone, setDriverPhone] = React.useState("")
  const [notes, setNotes] = React.useState("")
  
  // Line Items
  const [items, setItems] = React.useState<{
    productId: string
    bags: number
    grossWeight: number
    tareWeight: number
    rate: number
    lotNo: string
  }[]>([
    { productId: "", bags: 0, grossWeight: 0, tareWeight: 0, rate: 0, lotNo: "" },
  ])

  // Supabase-backed load: DB rows (incoming_goods + incoming_goods_items)
  // are mapped onto the page's local voucher shape; names come from the
  // master lists, not from hand-edited local state.
  // "Today" for the today-only filter, from client-side effect state (see
  // isTodayISO): never read new Date() during render.
  const [todayStr, setTodayStr] = React.useState<string | null>(null)
  React.useEffect(() => { setTodayStr(new Date().toISOString().slice(0, 10)) }, [])

  const loadInwardPage = async (page: number) => {
    setIsLoading(true)
    try {
      const [v, g, pr, pa, co] = await Promise.all([
        listInward({ page, pageSize: 50, search: filterRef.current.search || undefined, from: filterRef.current.from || undefined, to: filterRef.current.to || undefined }),
        listGodowns(), listProducts(), listParties(), getCompanySettings(),
      ])
      const failed = [v, g, pr, pa].find((r) => !r.success)
      if (failed) setFormError(failed.error ?? "Could not load inward data.")
      const godownList = (Array.isArray(g.data) ? g.data : []) as Godown[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      const partyList = (Array.isArray(pa.data) ? pa.data : []) as Party[]
      setGodowns(godownList)
      setProducts(productList)
      setParties(partyList.filter((pt) => pt.type === "supplier" || pt.type === "both" || pt.type === "source"))
      setOwners(partyList)
      if (co.success && co.data) {
        const c = co.data as { name?: string | null; address?: string | null; phone?: string | null; email?: string | null; logo_url?: string | null }
        setCompany({ name: c.name ?? undefined, address: c.address ?? undefined, phone: c.phone ?? undefined, email: c.email ?? undefined, logoUrl: c.logo_url ?? undefined })
      }
      const rows = Array.isArray((v.data as any)?.rows) ? (v.data as any).rows : (Array.isArray(v.data) ? v.data : [])
      setInwardTotal(Number((v.data as any)?.total) || rows.length)
      setInwardPage(Number((v.data as any)?.page) || page)
      setVouchers(rows.map((row: any) => ({
        ...row,
        party_name: partyList.find((x) => x.id === row.party_id)?.name ?? "Not set",
        godown_name: godownList.find((x) => x.id === row.godown_id)?.name ?? "Not set",
        items: (row.incoming_goods_items ?? row.items ?? []).map((it: any) => ({
          ...it,
          product_name: productList.find((x) => x.id === it.product_id)?.name ?? "Not set",
        })),
      })))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load inward data.")
    } finally {
      setIsLoading(false)
    }
  }

  const loadData = React.useCallback(() => { void loadInwardPage(1) }, [])

  React.useEffect(() => {
    loadData()
    setDrillFilter(getUrlFilter())
    setInwardDate(new Date().toISOString().slice(0, 10))
  }, [loadData])

  React.useEffect(() => {
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
    if (parties.length > 0 && !partyId) setPartyId(parties[0].id)
    if (products.length > 0 && items[0].productId === "") {
      setItems((prev) => [{ ...prev[0], productId: products[0].id }])
    }
  }, [godowns, parties, products, godownId, partyId, items])

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        productId: products[0]?.id || "",
        bags: 0,
        grossWeight: 0,
        tareWeight: 0,
        rate: 0,
        lotNo: "",
      },
    ])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: string, value: any) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  const totalBags = items.reduce((sum, i) => sum + (Number(i.bags) || 0), 0)
  const totalNetWeight = items.reduce(
    (sum, i) => sum + (Math.max(0, (Number(i.grossWeight) || 0) - (Number(i.tareWeight) || 0))),
    0
  )
  const totalValue = items.reduce(
    (sum, i) =>
      sum +
      Math.max(0, (Number(i.grossWeight) || 0) - (Number(i.tareWeight) || 0)) * (Number(i.rate) || 0),
    0
  )

  const handleSubmitVoucher = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §4.3: required fields + positive quantities blocked with an
    // actionable message — never a silent return.
    if (!partyId) return setFormError("Select a supplier / source before posting. Add one in Masters if the list is empty.")
    if (!godownId) return setFormError("Select the target godown that will receive this stock.")
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.productId) return setFormError(`Line ${i + 1}: select a product.`)
      if (!isPositive(Number(item.bags))) return setFormError(`Line ${i + 1}: bags must be greater than zero.`)
      if (!isPositive(Number(item.grossWeight))) return setFormError(`Line ${i + 1}: gross weight must be greater than zero.`)
      if (Number(item.tareWeight) < 0) return setFormError(`Line ${i + 1}: tare weight cannot be negative.`)
      if (Number(item.tareWeight) >= Number(item.grossWeight)) return setFormError(`Line ${i + 1}: tare weight must be less than gross weight, otherwise net weight is zero.`)
      if (Number(item.rate) < 0) return setFormError(`Line ${i + 1}: rate cannot be negative.`)
    }
    setFormError("")

    const selectedParty = parties.find((p) => p.id === partyId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const voucherItems: IncomingGoodsItem[] = items.map((item, idx) => {
      const prod = products.find((p) => p.id === item.productId)
      const netWeight = Math.max(0, item.grossWeight - item.tareWeight)
      return {
        id: `inwi-${Date.now()}-${idx}`,
        incoming_id: `inw-${Date.now()}`,
        product_id: item.productId,
        product_name: prod?.name || "Seed Grain",
        bags_count: Number(item.bags),
        gross_weight_kg: Number(item.grossWeight),
        tare_weight_kg: Number(item.tareWeight),
        net_weight_kg: netWeight,
        rate_per_unit: Number(item.rate),
        total_value: netWeight * Number(item.rate),
      }
    })
    // No voucher number is shown before posting: the server assigns it.
    setDraftVoucher({
      id: `inw-${Date.now()}`,
      voucher_no: "", 
      date: inwardDate ? `${inwardDate}T00:00:00.000Z` : new Date().toISOString(),
      party_id: partyId,
      party_name: selectedParty?.name,
      godown_id: godownId,
      godown_name: selectedGodown?.name,
      bilty_no: biltyNo || undefined,
      vehicle_no: vehicleNo || undefined,
      driver_name: driverName || undefined,
      driver_phone: driverPhone || undefined,
      status: "posted",
      total_bags: totalBags,
      total_net_weight_kg: totalNetWeight,
      total_value: totalValue,
      notes: notes || undefined,
      items: voucherItems,
      created_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
    })
    setShowPostConfirm(true)
  }

  const handleConfirmPost = async () => {
    if (!draftVoucher || postGuard.current) return
    postGuard.current = true
    setIsPending(true)
    try {
      const created = await createInwardDraft({
        partyId, godownId, date: inwardDate ? `${inwardDate}T00:00:00.000Z` : undefined,
        biltyNo: biltyNo || undefined, vehicleNo: vehicleNo || undefined,
        driverName: driverName || undefined, driverPhone: driverPhone || undefined, notes: notes || undefined,
        receivedBy: receivedBy || undefined, byHand, nature: nature || undefined,
        attachmentUrl: attachmentUrl || undefined, attachmentNote: attachmentNote || undefined,
        isCustomerOwned: ownerId ? true : false, ownerPartyId: ownerId || undefined,
        items: items.map((it) => ({
          productId: it.productId, bags: Number(it.bags), grossWeightKg: Number(it.grossWeight),
          tareWeightKg: Number(it.tareWeight), ratePerUnit: Number(it.rate), lotNo: it.lotNo || undefined,
        })),
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the inward draft.")
        return
      }
      const posted = await postInward((created.data as any).id, postToken("inward:post", (created.data as any).id))
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the inward voucher.")
        return
      }
      const row: any = posted.data ?? created.data
      const warns = [(created.data as any)?.biltyWarning, (created.data as any)?.columnsWarning].filter(Boolean).join(" ")
      if (warns) setFormWarning(warns)
      setFormNotice(`${row.voucher_no} posted — ${formatWeight(row.total_net_weight_kg ?? draftVoucher.total_net_weight_kg)} added to ${draftVoucher.godown_name || "the godown"}.`)
      const fresh = await getInward((created.data as any).id)
      const serverRow: any = fresh.success ? fresh.data : row
      setSelectedVoucherForPrint({
        ...serverRow,
        party_name: parties.find((x) => x.id === serverRow.party_id)?.name ?? serverRow.party_id,
        godown_name: godowns.find((x) => x.id === serverRow.godown_id)?.name ?? serverRow.godown_id,
        items: (serverRow.incoming_goods_items ?? serverRow.items ?? []).map((it: any) => ({
          ...it,
          product_name: products.find((x) => x.id === it.product_id)?.name ?? "Not set",
        })),
      })
      setShowPostConfirm(false)
      setIsFormOpen(false)
      setDraftVoucher(null)
      await loadData()
    } finally {
      setIsPending(false)
      postGuard.current = false
    }
  }

  // Spec §1.1: a posted voucher is never silently deleted. Reversal keeps
  // the voucher visible as "reversed" and writes compensating outward
  // ledger rows so the stock position is restored, with reason on record.
  const handleConfirmReversal = async (reasonCode: string, reason: string) => {
    if (!reversalTarget || isReversing) return
    setIsReversing(true)
    try {
      const res = await reverseInward(reversalTarget.id, `${reasonCode}: ${reason}`, postToken("inward:reverse", reversalTarget.id))
      if (!res.success) {
        setFormError(res.error ?? "Could not reverse the voucher.")
        return
      }
      setFormNotice(`${reversalTarget.voucher_no} reversed — stock restored. Reason recorded: ${reasonCode}.`)
      const target = reversalTarget
      setReversalTarget(null)
      await loadData()
      void target
    } finally {
      setIsReversing(false)
    }
  }

  const visibleVouchers = drillFilter === "today"
    ? vouchers.filter((v) => isTodayISO(v.date, todayStr))
    : drillFilter === "posted"
      ? vouchers.filter((v) => v.status === "posted")
      : vouchers

  if (isLoading) return <InwardSkeleton />

  return (
    <div className="space-y-6">
      <FilterBanner filter={drillFilter} onClear={() => setDrillFilter(null)} />
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="warning" message={formWarning} onDismiss={() => setFormWarning("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Truck className="h-6 w-6 text-emerald-500" />
            Inward
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setIsFormOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>New Receiving Voucher</span>
        </button>
      </div>

      {/* List filters: free-text search + date range (server-side, via listInward filters) */}
      <div className="expensive-card p-4 flex flex-wrap items-end gap-3 text-xs">
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="inward-search">Search</label>
          <input id="inward-search" type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Voucher, bilty or vehicle no." className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
        </div>
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="inward-from">From</label>
          <input id="inward-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
        </div>
        <div>
          <label className="block font-medium text-foreground mb-1" htmlFor="inward-to">To</label>
          <input id="inward-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" />
        </div>
        <button type="button" onClick={() => { filterRef.current = { search: searchQuery, from: fromDate, to: toDate }; void loadInwardPage(1) }} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer">Apply filters</button>
        <button type="button" onClick={() => { setSearchQuery(""); setFromDate(""); setToDate(""); filterRef.current = { search: "", from: "", to: "" }; void loadInwardPage(1) }} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground font-semibold cursor-pointer">Clear</button>
      </div>

      {/* Inward Vouchers Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-500" />
            Vouchers ({visibleVouchers.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Voucher No</th>
                <th className="pb-3 font-bold">Date</th>
                <th className="pb-3 font-bold">Supplier / Source</th>
                <th className="pb-3 font-bold">Target Godown</th>
                <th className="pb-3 font-bold">Bilty / Vehicle</th>
                <th className="pb-3 font-bold text-right">Bags</th>
                <th className="pb-3 font-bold text-right">Net Weight</th>
                <th className="pb-3 font-bold text-right">Total Value</th>
                <th className="pb-3 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleVouchers.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4">
                    <EmptyState
                      title={drillFilter ? "No vouchers match this filter" : "No inward vouchers yet"}
                      hint={drillFilter ? "Clear the filter, or record a new arrival." : "Record your first arrival."}
                      actionLabel="New Receiving Voucher"
                      onAction={() => setIsFormOpen(true)}
                    />
                  </td>
                </tr>
              )}
              {visibleVouchers.map((v) => (
                <tr key={v.id} className="hover:bg-muted transition-colors">
                  <td className="py-3 font-bold text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{v.voucher_no}</span>
                      <span className={v.status === "reversed" ? "px-1.5 py-0.2 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-bold uppercase" : v.status === "draft" ? "px-1.5 py-0.2 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-bold uppercase" : "px-1.5 py-0.2 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold uppercase"}>
                        {v.status === "draft" ? "Draft" : v.status === "reversed" ? "Reversed" : "Posted"}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">{formatDate(v.date)}</td>
                  <td className="py-3 font-medium text-foreground">{v.party_name}</td>
                  <td className="py-3 text-muted-foreground">{v.godown_name}</td>
                  <td className="py-3 font-mono text-muted-foreground">
                    <div>Bilty: {v.bilty_no || "N/A"}</div>
                    <div className="text-[10px] text-foreground font-semibold">{v.vehicle_no || "N/A"}</div>
                  </td>
                  <td className="py-3 text-right font-semibold text-foreground">
                    {formatBags(v.total_bags)}
                  </td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                    {formatWeight(v.total_net_weight_kg)}
                  </td>
                  <td className="py-3 text-right font-bold text-foreground">
                    {formatCurrency(v.total_value || 0)}
                  </td>
                  <td className="py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedVoucherForPrint(v)}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Print Inward Receiving Slip"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      {v.status === "posted" && (
                        <button
                          type="button"
                          onClick={() => setReversalTarget(v)}
                          className="px-2 py-1 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer"
                          title="Reverse this posted voucher (requires a reason)"
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

      <div className="expensive-card p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">
          {inwardPage === 1
            ? `Showing latest ${visibleVouchers.length} of ${inwardTotal} vouchers`
            : `Showing rows ${(inwardPage - 1) * 50 + 1}–${(inwardPage - 1) * 50 + visibleVouchers.length} of ${inwardTotal} vouchers`}
        </span>
        <span className="flex items-center gap-2">
          <button type="button" disabled={inwardPage <= 1} onClick={() => void loadInwardPage(inwardPage - 1)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-semibold cursor-pointer disabled:opacity-50">Previous</button>
          <span className="font-mono">Page {inwardPage} of {Math.max(1, Math.ceil(inwardTotal / 50))}</span>
          <button type="button" disabled={inwardPage * 50 >= inwardTotal} onClick={() => void loadInwardPage(inwardPage + 1)} className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-semibold cursor-pointer disabled:opacity-50">Next</button>
        </span>
      </div>

      {/* Creation Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 overflow-y-auto">
          <div className="expensive-card w-full max-w-3xl p-6 bg-card border border-border shadow-md rounded-md my-8 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Truck className="h-5 w-5 text-emerald-500" />
                  New Receiving Voucher
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitVoucher} className="space-y-5 pt-4">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              {/* Header Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="supplier-party">Supplier / Party</label>
                  <select id="supplier-party"
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="target-godown">Target Godown</label>
                  <select id="target-godown"
                    value={godownId}
                    onChange={(e) => setGodownId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {godowns.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="stock-owner">Stock owner</label>
                  <select id="stock-owner"
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="">Company stock</option>
                    {owners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="bilty-number">Bilty Number</label>
                  <input id="bilty-number"
                    type="text"
                    value={biltyNo}
                    onChange={(e) => setBiltyNo(e.target.value)}
                    placeholder="e.g. BL-88412"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="truck-vehicle-no">Truck / Vehicle No</label>
                  <input id="truck-vehicle-no"
                    type="text"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    placeholder="e.g. LES-9941"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="driver-name">Driver Name</label>
                  <input id="driver-name"
                    type="text"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder="Driver name"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="driver-contact">Driver Contact</label>
                  <input id="driver-contact"
                    type="text"
                    value={driverPhone}
                    onChange={(e) => setDriverPhone(e.target.value)}
                    placeholder="0300-XXXXXXX"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="inward-date">Date</label>
                  <input id="inward-date"
                    type="date"
                    value={inwardDate}
                    onChange={(e) => setInwardDate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="received-by">Received By (staff)</label>
                  <input id="received-by"
                    type="text"
                    value={receivedBy}
                    onChange={(e) => setReceivedBy(e.target.value)}
                    placeholder="Staff member who received the goods"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="nature">Nature (free text)</label>
                  <input id="nature"
                    type="text"
                    value={nature}
                    onChange={(e) => setNature(e.target.value)}
                    placeholder="Receiving classification (free text)"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div className="flex items-center gap-2 pt-5">
                  <input id="by-hand"
                    type="checkbox"
                    checked={byHand}
                    onChange={(e) => setByHand(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label className="font-medium text-foreground" htmlFor="by-hand">Delivered by hand</label>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-foreground mb-1" htmlFor="remarks-quality-notes">Remarks / Quality Notes</label>
                  <input id="remarks-quality-notes"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Moisture, purity, condition"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>
                <div className="sm:col-span-2">
                  <AttachmentFields url={attachmentUrl} note={attachmentNote} onUrlChange={setAttachmentUrl} onNoteChange={setAttachmentNote} idPrefix="inward" />
                </div>
              </div>

              {/* Multi-line Items Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Unloaded Product Lines
                  </span>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="text-xs text-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add Item Line</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {items.map((item, idx) => {
                    const netWeight = Math.max(0, item.grossWeight - item.tareWeight)
                    const lineTotal = netWeight * item.rate
                    return (
                      <div
                        key={idx}
                        className="grid grid-cols-1 sm:grid-cols-7 gap-2 p-2.5 rounded-lg bg-muted border border-border text-xs items-center"
                      >
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`product-${idx}`}>Product</label>
                          <select id={`product-${idx}`}
                            value={item.productId}
                            onChange={(e) => handleItemChange(idx, "productId", e.target.value)}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                          >
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`bags-count-${idx}`}>Bags Count</label>
                          <input id={`bags-count-${idx}`}
                            type="number"
                            value={item.bags}
                            onChange={(e) => handleItemChange(idx, "bags", Number(e.target.value))}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                            min="1"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`gross-wt-kg-${idx}`}>Gross Wt (kg)</label>
                          <input id={`gross-wt-kg-${idx}`}
                            type="number"
                            value={item.grossWeight}
                            onChange={(e) => handleItemChange(idx, "grossWeight", Number(e.target.value))}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`tare-wt-kg-${idx}`}>Tare Wt (kg)</label>
                          <input id={`tare-wt-kg-${idx}`}
                            type="number"
                            value={item.tareWeight}
                            onChange={(e) => handleItemChange(idx, "tareWeight", Number(e.target.value))}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`lot-no-${idx}`}>Lot No. (optional)</label>
                          <input id={`lot-no-${idx}`}
                            type="text"
                            value={item.lotNo}
                            onChange={(e) => handleItemChange(idx, "lotNo", e.target.value)}
                            placeholder="Leave empty for no lot tracking"
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`rate-kg-${idx}`}>Rate / kg</label>
                            <input id={`rate-kg-${idx}`}
                              type="number"
                              value={item.rate}
                              onChange={(e) => handleItemChange(idx, "rate", Number(e.target.value))}
                              className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                            />
                          </div>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              className="mt-3.5 p-1 text-destructive hover:bg-destructive/10 rounded cursor-pointer"
                              title="Delete Row"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Totals Summary Banner */}
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Total Bags: </span>
                  <strong className="text-foreground font-mono">{formatBags(totalBags)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Net Weight: </span>
                  <strong className="text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                    {formatWeight(totalNetWeight)}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Estimated Value: </span>
                  <strong className="text-foreground font-mono">{formatCurrency(totalValue)}</strong>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
                  <span>{isPending ? "Posting…" : "Post & Update Stock Ledger"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Inward Slip View */}
      {selectedVoucherForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-4 sm:p-8 bg-white text-black shadow-md rounded-md printable-document space-y-6 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <h2 className="text-xl font-extrabold tracking-tight">ARCO SEED GODOWN & PROCESSING</h2>
                <div className="text-xs text-gray-500">Official Grain Receiving & Inward Goods Slip</div>
              </div>
              <div className="text-right">
                <div className="text-base font-mono font-bold">{selectedVoucherForPrint.voucher_no}</div>
                <div className="text-xs text-gray-500">{formatDate(selectedVoucherForPrint.date)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-gray-500 block">Supplier / Party:</span>
                <strong className="text-sm">{selectedVoucherForPrint.party_name}</strong>
              </div>
              <div>
                <span className="text-gray-500 block">Unloading Godown:</span>
                <strong className="text-sm">{selectedVoucherForPrint.godown_name}</strong>
              </div>
              <div>
                <span className="text-gray-500 block">Bilty / Transport Ref:</span>
                <span className="font-mono">{selectedVoucherForPrint.bilty_no || "N/A"}</span>
              </div>
              <div>
                <span className="text-gray-500 block">Vehicle Number:</span>
                <span className="font-mono font-bold">{selectedVoucherForPrint.vehicle_no || "N/A"}</span>
              </div>
            </div>

            {/* Item Details */}
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="py-2">Product Description</th>
                  <th className="py-2 text-right">Bags</th>
                  <th className="py-2 text-right">Gross Wt</th>
                  <th className="py-2 text-right">Tare Wt</th>
                  <th className="py-2 text-right">Net Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {selectedVoucherForPrint.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 font-medium">{item.product_name}</td>
                    <td className="py-2 text-right">{item.bags_count}</td>
                    <td className="py-2 text-right">{item.gross_weight_kg} kg</td>
                    <td className="py-2 text-right">{item.tare_weight_kg} kg</td>
                    <td className="py-2 text-right font-bold">{item.net_weight_kg} kg</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-400 font-bold">
                  <td className="py-2">Total Verified</td>
                  <td className="py-2 text-right">{selectedVoucherForPrint.total_bags} bags</td>
                  <td colSpan={2}></td>
                  <td className="py-2 text-right text-sm">{selectedVoucherForPrint.total_net_weight_kg} kg</td>
                </tr>
              </tfoot>
            </table>

            {/* Signature Blocks */}
            <div className="grid grid-cols-3 gap-6 pt-12 text-center text-xs text-gray-500">
              <div className="border-t pt-2">Unloading Labor Head</div>
              <div className="border-t pt-2">Godown Scale Operator</div>
              <div className="border-t pt-2">Authorized Officer</div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t no-print">
              <button
                type="button"
                onClick={() => setSelectedVoucherForPrint(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              <PrintButton
                label="Print Receiving Slip"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}
      {selectedVoucherForPrint && selectedVoucherForPrint.status === "posted" && (
        <div className="hidden print:block">
          <InwardSlipPrint
            company={company ?? undefined}
            voucherNo={selectedVoucherForPrint.voucher_no}
            date={selectedVoucherForPrint.date}
            supplierName={selectedVoucherForPrint.party_name}
            godown={selectedVoucherForPrint.godown_name}
            biltyNo={selectedVoucherForPrint.bilty_no}
            vehicleNo={selectedVoucherForPrint.vehicle_no}
            driverName={selectedVoucherForPrint.driver_name}
            receivedBy={(selectedVoucherForPrint as any).received_by ?? undefined}
            byHand={(selectedVoucherForPrint as any).by_hand ? "By hand" : undefined}
            nature={(selectedVoucherForPrint as any).nature ?? undefined}
            items={selectedVoucherForPrint.items.map((it) => ({
              product: it.product_name, bags: it.bags_count, grossWeightKg: it.gross_weight_kg,
              tareWeightKg: it.tare_weight_kg, netWeightKg: it.net_weight_kg,
            }))}
            totalBags={selectedVoucherForPrint.total_bags}
            totalNetKg={selectedVoucherForPrint.total_net_weight_kg}
            notes={selectedVoucherForPrint.notes}
            attachmentUrl={(selectedVoucherForPrint as any).attachment_url ?? undefined}
            attachmentNote={(selectedVoucherForPrint as any).attachment_note ?? undefined}
          />
        </div>
      )}
      <ConfirmDialog
        open={showPostConfirm}
        title="Post this inward voucher?"
        description={draftVoucher ? `Posting will add ${formatWeight(draftVoucher.total_net_weight_kg)} (${formatBags(draftVoucher.total_bags)}) to ${draftVoucher.godown_name || "the selected godown"}. A voucher number is assigned on posting. Posted vouchers can only be changed by reversal.` : ""}
        confirmLabel="Post & Update Stock Ledger"
        pending={isPending}
        onConfirm={handleConfirmPost}
        onCancel={() => { setShowPostConfirm(false); setDraftVoucher(null) }}
      />
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.voucher_no ?? ""}
        note="Compensating outward ledger rows will restore the stock position."
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
    </div>
  )
}
