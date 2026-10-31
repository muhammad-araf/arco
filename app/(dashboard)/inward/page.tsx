"use client"

import { postToken } from "@/lib/idempotency"

import * as React from "react"
import {
  Truck,
  Plus,
  Printer,
  FileText,
} from "lucide-react"
import { listInward, reverseInward, getInwardInitData } from "@/app/actions/inward"
import { listGodowns, listProducts, listParties, listEmployees } from "@/app/actions/masters"
import { getCompanySettings } from "@/app/actions/settings"
import { InwardSlipPrint } from "@/components/print/inward-slip-print"
import { AttachmentLink } from "@/components/attachment-fields"
import { PrintButton } from "@/components/print/print-button"
import { IncomingGoodsVoucher, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatCurrency, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  EmptyState,
  FilterBanner,
  ReversalDialog,
  getUrlFilter,
  isTodayISO,
} from "@/components/erp-ui"
import { InwardDialog } from "@/components/inward-dialog"
import { InwardSkeleton } from "@/components/route-skeletons"

export default function InwardPage() {
  const [vouchers, setVouchers] = React.useState<IncomingGoodsVoucher[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [parties, setParties] = React.useState<Party[]>([])
  const [owners, setOwners] = React.useState<Party[]>([])
  const [employees, setEmployees] = React.useState<{ id: string; full_name: string }[]>([])
  const [company, setCompany] = React.useState<{ name?: string; address?: string; phone?: string; email?: string; logoUrl?: string } | null>(null)
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
  const [reversalTarget, setReversalTarget] = React.useState<IncomingGoodsVoucher | null>(null)
  const [isReversing, setIsReversing] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)

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
      const initRes = await getInwardInitData({
        page,
        pageSize: 50,
        search: filterRef.current.search || undefined,
        from: filterRef.current.from || undefined,
        to: filterRef.current.to || undefined,
      })
      if (!initRes.success) {
        setFormError(initRes.error ?? "Could not load inward data.")
        return
      }
      const data = initRes.data as any
      const godownList = (Array.isArray(data.godowns) ? data.godowns : []) as Godown[]
      const productList = (Array.isArray(data.products) ? data.products : []) as Product[]
      const partyList = (Array.isArray(data.parties) ? data.parties : []) as Party[]
      const employeeList = (Array.isArray(data.employees) ? data.employees : []) as any[]

      setEmployees(employeeList.map((e) => ({ id: e.id, full_name: e.full_name })))
      setGodowns(godownList)
      setProducts(productList)
      setParties(partyList.filter((pt) => pt.type === "supplier" || pt.type === "both" || pt.type === "source"))
      setOwners(partyList)
      if (data.company) {
        const c = data.company as { name?: string | null; address?: string | null; phone?: string | null; email?: string | null; logo_url?: string | null }
        setCompany({ name: c.name ?? undefined, address: c.address ?? undefined, phone: c.phone ?? undefined, email: c.email ?? undefined, logoUrl: c.logo_url ?? undefined })
      }
      const v = data.vouchers
      const rows = Array.isArray((v as any)?.rows) ? (v as any).rows : (Array.isArray(v) ? v : [])
      setInwardTotal(Number((v as any)?.total) || rows.length)
      setInwardPage(Number((v as any)?.page) || page)
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
  }, [loadData])

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

  // Dialog callbacks: notice/warning banners + register reload; the
  // dialog itself opens the print viewer via onPrinted.
  const handleDialogSaved = (notice: string, warning?: string) => {
    setFormNotice(notice)
    if (warning) setFormWarning(warning)
    void loadData()
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
                  <td colSpan={9} className="py-4">
                    <EmptyState
                      title={drillFilter ? "No vouchers match this filter" : "No inward vouchers yet"}
                      hint={drillFilter ? "Clear the filter, or record a new arrival." : "Inward records stock received into a godown. Posting a receipt increases stock here; the vendor bill for that receipt is created separately in Purchases. Use New Receiving Voucher to record an arrival."}
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

      {/* Printable Inward Slip View */}
      {selectedVoucherForPrint && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
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

            {(selectedVoucherForPrint as any).attachment_url && (
              <div className="text-xs no-print">
                <span className="text-gray-500">Scanned bill: </span>
                <AttachmentLink url={(selectedVoucherForPrint as any).attachment_url} note={(selectedVoucherForPrint as any).attachment_note ?? undefined} />
              </div>
            )}
            {selectedVoucherForPrint.status === "posted" && (
              <div className="text-xs no-print">
                <a href="/purchases" className="underline font-semibold text-emerald-700">
                  Create purchase bill for this receipt
                </a>
                <span className="text-gray-500"> — the Purchases page does not pre-select a supplier from a link yet, so pick supplier “{selectedVoucherForPrint.party_name}” there. No bill is created automatically.</span>
              </div>
            )}

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
      <InwardDialog
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        godowns={godowns}
        products={products}
        parties={parties}
        owners={owners}
        employees={employees}
        setGodowns={setGodowns}
        setProducts={setProducts}
        setParties={setParties}
        setOwners={setOwners}
        onSaved={handleDialogSaved}
        onPrinted={(v) => setSelectedVoucherForPrint(v)}
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
