"use client"

import { postToken, submissionToken, resetSubmissionToken } from "@/lib/idempotency"

import * as React from "react"
import {
  FileCheck2,
  Plus,
  Printer,
  CheckCircle2,
  AlertTriangle,
  Truck,
  Building2,
  User,
  Phone,
  ShieldCheck,
  Trash2,
  Boxes,
  Download,
} from "lucide-react"
import { listGatePasses, getGatePass, createGatePassDraft, postGatePass, reverseGatePass, returnGatePass } from "@/app/actions/gatepass"
import { getStockSummary } from "@/app/actions/inventory"
import { listGodowns, listProducts, listParties } from "@/app/actions/masters"
import { GatePassPrint } from "@/components/print/gate-pass-print"
import { PrintButton } from "@/components/print/print-button"
import { GatePass, GatePassItem, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatDate, formatDateTime } from "@/lib/utils"
import { exportToCSV } from "@/lib/export-utils"
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
import { GatepassSkeleton } from "@/components/route-skeletons"

export default function GatePassPage() {
  const [gatePasses, setGatePasses] = React.useState<GatePass[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])
  const [owners, setOwners] = React.useState<Party[]>([])
  const [summaryRows, setSummaryRows] = React.useState<any[]>([])
  const [returnTarget, setReturnTarget] = React.useState<any | null>(null)
  const [returnPending, setReturnPending] = React.useState(false)
  const [returnLines, setReturnLines] = React.useState<{
    productId: string; productName: string; partyId: string | null; ownerName: string; remainingKg: number; qtyKg: number
  }[]>([])
  const [returnReason, setReturnReason] = React.useState("")

  // Modal / Print State
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [selectedPassForPrint, setSelectedPassForPrint] = React.useState<GatePass | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showPostConfirm, setShowPostConfirm] = React.useState(false)
  const [draftPass, setDraftPass] = React.useState<GatePass | null>(null)
  const [reversalTarget, setReversalTarget] = React.useState<GatePass | null>(null)
  const [isReversing, setIsReversing] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const postGuard = React.useRef(false)
  const returnTokenRef = React.useRef<string | null>(null)

  // Form Fields
  const [customerId, setCustomerId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [destination, setDestination] = React.useState("")
  const [vehicleNo, setVehicleNo] = React.useState("")
  const [driverName, setDriverName] = React.useState("")
  const [driverPhone, setDriverPhone] = React.useState("")
  const [transporter, setTransporter] = React.useState("")
  const [orderRef, setOrderRef] = React.useState("")
  const [notes, setNotes] = React.useState("")

  // Form Items
  const [items, setItems] = React.useState<{
    productId: string
    bags: number
    netWeight: number
    remarks: string
    ownerId: string
  }[]>([
    { productId: "", bags: 0, netWeight: 0, remarks: "", ownerId: "" },
  ])

  // "Today" for the today-only filter, from client-side effect state (see
  // isTodayISO): never read new Date() during render.
  const [todayStr, setTodayStr] = React.useState<string | null>(null)
  React.useEffect(() => { setTodayStr(new Date().toISOString().slice(0, 10)) }, [])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [gp, g, pr, pa, sm] = await Promise.all([listGatePasses(), listGodowns(), listProducts(), listParties(), getStockSummary()])
      const failed = [gp, g, pr, pa, sm].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load gate pass data.")
      const godownList = (Array.isArray(g.data) ? g.data : []) as Godown[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      const partyList = (Array.isArray(pa.data) ? pa.data : []) as Party[]
      setGodowns(godownList); setProducts(productList); setCustomers(partyList.filter((x) => x.type === "customer" || x.type === "both")); setOwners(partyList)
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

  React.useEffect(() => {
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
    if (customers.length > 0 && !customerId) setCustomerId(customers[0].id)
    const finishedProds = products.filter((p) => p.category === "finished_seed" || p.category === "by_product")
    if (finishedProds.length > 0 && items[0].productId === "") {
      setItems((prev) => [{ ...prev[0], productId: finishedProds[0].id }])
    }
  }, [godowns, customers, products, godownId, customerId, items])

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        productId: products[0]?.id || "",
        bags: 0,
        netWeight: 0,
        remarks: "",
        ownerId: "",
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
  const totalWeight = items.reduce((sum, i) => sum + (Number(i.netWeight) || 0), 0)

  const handleIssueGatePass = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §9.3/§9.5: required fields, positive quantities, and the stock
    // guard — every failure names the product and the numbers involved.
    if (!customerId) return setFormError("Select the customer / receiver before issuing a gate pass.")
    if (!godownId) return setFormError("Select the dispatch godown so stock is deducted from the right place.")
    if (!vehicleNo.trim()) return setFormError("Vehicle number is required on a gate pass.")
    if (!driverName.trim()) return setFormError("Driver name is required on a gate pass.")
    if (!destination.trim()) return setFormError("Destination is required so the pass states where the goods are going.")
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item.productId) return setFormError(`Line ${i + 1}: select a product.`)
      if (!isPositive(Number(item.bags))) return setFormError(`Line ${i + 1}: bags must be greater than zero.`)
      if (!isPositive(Number(item.netWeight))) return setFormError(`Line ${i + 1}: net weight must be greater than zero.`)
      const ownerRow = summaryRows.find((r) => r.product_id === item.productId && r.godown_id === godownId && (r.party_id ?? null) === (item.ownerId || null))
      const available = Number(ownerRow?.balance_kg) || 0
      if (item.netWeight > available) {
        const prod = products.find((p) => p.id === item.productId)
        return setFormError(`Insufficient stock for ${prod?.name || "Product"}: ${available} kg available in this godown, but ${item.netWeight} kg requested. Reduce the quantity or pick another godown.`)
      }
    }
    setFormError("")
    const selectedCust = customers.find((c) => c.id === customerId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const gatePassItems: GatePassItem[] = items.map((item, idx) => {
      const prod = products.find((p) => p.id === item.productId)
      return {
        id: `gpi-${Date.now()}-${idx}`,
        gate_pass_id: `gp-${Date.now()}`,
        product_id: item.productId,
        product_name: prod?.name || "Seed",
        bags_count: Number(item.bags),
        net_weight_kg: Number(item.netWeight),
        gross_weight_kg: Number(item.netWeight),
        remarks: item.remarks,
      }
    })
    // No pass number is shown before posting: the server assigns it.
    setDraftPass({
      id: `gp-${Date.now()}`,
      pass_no: "", 
      date: new Date().toISOString(),
      customer_id: customerId,
      customer_name: selectedCust?.name,
      destination: destination || undefined,
      godown_id: godownId,
      godown_name: selectedGodown?.name,
      vehicle_no: vehicleNo,
      driver_name: driverName,
      driver_phone: driverPhone || undefined,
      transporter: transporter || undefined,
      order_ref: orderRef || undefined,
      status: "posted",
      total_bags: totalBags,
      total_weight_kg: totalWeight,
      notes: notes || undefined,
      items: gatePassItems,
      created_at: new Date().toISOString(),
      dispatched_at: new Date().toISOString(),
    })
    setShowPostConfirm(true)
  }

  const handleConfirmPost = async () => {
    if (!draftPass || postGuard.current) return
    postGuard.current = true
    setIsPending(true)
    try {
      const created = await createGatePassDraft({
        customerId, godownId, vehicleNo: vehicleNo.trim(), driverName: driverName.trim(),
        driverPhone: driverPhone || undefined, transporter: transporter || undefined,
        destination: destination.trim() || undefined, orderRef: orderRef || undefined, notes: notes || undefined,
        items: items.map((it) => ({ productId: it.productId, bags: Number(it.bags), netWeightKg: Number(it.netWeight), remarks: it.remarks, partyId: it.ownerId || undefined })),
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the gate pass draft.")
        return
      }
      const posted = await postGatePass((created.data as any).id, postToken("gatepass:post", (created.data as any).id))
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the gate pass.")
        return
      }
      const row: any = posted.data ?? created.data
      setFormNotice(`${row.pass_no} dispatched — ${formatWeight(row.total_weight_kg ?? draftPass.total_weight_kg)} deducted from ${draftPass.godown_name || "the godown"}.`)
      const fresh = await getGatePass((created.data as any).id)
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
      setShowPostConfirm(false)
      setIsModalOpen(false)
      setDraftPass(null)
      await loadData()
    } finally {
      setIsPending(false)
      postGuard.current = false
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
        productName: products.find((p) => p.id === l.productId)?.name ?? l.productId,
        ownerName: l.partyId ? (owners.find((o) => o.id === l.partyId)?.name ?? l.partyId) : "Company",
      }))
    if (!lines.length) {
      setFormError(`${gp.pass_no} has nothing left to return.`)
      return
    }
    setReturnTarget(gp)
    setReturnLines(lines)
    setReturnReason("")
  }

  const handlePartialReturn = async () => {
    if (!returnTarget || returnPending) return
    if (!returnReason.trim()) {
      setFormError("A return reason is required.")
      return
    }
    const entries = returnLines.filter((l) => Number(l.qtyKg) > 0)
    if (!entries.length) {
      setFormError("Enter a return quantity greater than zero on at least one line.")
      return
    }
    for (const l of entries) {
      if (Number(l.qtyKg) > l.remainingKg) {
        setFormError(`Return for ${l.productName} (${l.ownerName}) exceeds the ${l.remainingKg} kg still returnable.`)
        return
      }
    }
    setReturnPending(true)
    try {
      const res = await returnGatePass(returnTarget.id, {
        reason: returnReason.trim(),
        items: entries.map((l) => ({ productId: l.productId, qtyKg: Number(l.qtyKg), partyId: l.partyId })),
      }, submissionToken(returnTokenRef, "gatepass-return"))
      if (!res.success) {
        setFormError(res.error ?? "Could not return the gate pass.")
        return
      }
      const newStatus = (res.data as any)?.status
      setFormNotice(`${returnTarget.pass_no} ${newStatus === "returned" ? "returned in full" : "partially returned"} — stock restored for the returned quantities.`)
      resetSubmissionToken(returnTokenRef)
      setReturnTarget(null)
      setReturnLines([])
      await loadData()
    } finally {
      setReturnPending(false)
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

  const visiblePasses = drillFilter === "today"
    ? gatePasses.filter((gp) => isTodayISO(gp.date, todayStr))
    : drillFilter === "posted"
      ? gatePasses.filter((gp) => gp.status === "posted")
      : gatePasses

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
            onClick={() => {
              exportToCSV(
                gatePasses.map((gp) => ({
                  pass_no: gp.pass_no,
                  date: gp.date,
                  customer: gp.customer_name,
                  destination: gp.destination || "Direct",
                  godown: gp.godown_name,
                  vehicle_no: gp.vehicle_no,
                  driver_name: gp.driver_name,
                  driver_phone: gp.driver_phone || "N/A",
                  bags: gp.total_bags,
                  weight_kg: gp.total_weight_kg,
                  status: gp.status,
                })),
                "authorized_gate_passes"
              )
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted text-foreground border border-border text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title="Download CSV / Excel"
          >
            <Download className="h-4 w-4 text-emerald-500" />
            <span>Export CSV</span>
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
                    <span className={gp.status === "reversed" ? "px-2 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase border border-red-500/20" : gp.status === "draft" ? "px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase border border-amber-500/20" : gp.status === "returned" || gp.status === "partially_returned" ? "px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase border border-blue-500/20" : "px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase border border-emerald-500/20"}>
                      {gp.status === "draft" ? "Draft" : gp.status === "reversed" ? "Reversed" : gp.status === "returned" ? "Returned" : gp.status === "partially_returned" ? "Partially Returned" : "Posted"}
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
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

      {/* Gate Pass Creator Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 overflow-y-auto">
          <div className="expensive-card w-full max-w-3xl p-6 bg-card border border-border shadow-md rounded-md space-y-4 my-8 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  Issue Outward Gate Pass
                </h3>
                <p className="text-xs text-muted-foreground">
                  Upon authorization, stock is deducted from the godown inventory and an official A4 pass is generated.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleIssueGatePass} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="customer-consignee">Customer / Consignee</label>
                  <select id="customer-consignee"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="dispatch-godown">Dispatch Godown</label>
                  <select id="dispatch-godown"
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
                  <label className="block font-medium text-foreground mb-1" htmlFor="delivery-destination">Delivery Destination</label>
                  <input id="delivery-destination"
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="e.g. Sahiwal Regional Depot"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="vehicle-truck-no">Vehicle / Truck No</label>
                  <input id="vehicle-truck-no"
                    type="text"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    placeholder="e.g. LES-4419"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="driver-full-name">Driver Full Name</label>
                  <input id="driver-full-name"
                    type="text"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder="Driver name"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="driver-mobile-number">Driver Mobile Number</label>
                  <input id="driver-mobile-number"
                    type="text"
                    value={driverPhone}
                    onChange={(e) => setDriverPhone(e.target.value)}
                    placeholder="0300-XXXXXXX"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Authorized Product Line Items
                  </span>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    className="text-xs text-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add Item</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {items.map((item, idx) => {
                    const ownerRow = item.productId ? summaryRows.find((r) => r.product_id === item.productId && r.godown_id === godownId && (r.party_id ?? null) === (item.ownerId || null)) : undefined
                    const available = Number(ownerRow?.balance_kg) || 0
                    return (
                      <div
                        key={idx}
                        className="grid grid-cols-1 sm:grid-cols-6 gap-2 p-2.5 rounded-lg bg-muted border border-border text-xs items-center"
                      >
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`gatepass-item-product-${idx}`}>
                            Product (Available: {formatWeight(available)})
                          </label>
                          <select id={`gatepass-item-product-${idx}`}
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
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                            min="1"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`net-wt-kg-${idx}`}>Net Wt (kg)</label>
                          <input id={`net-wt-kg-${idx}`}
                            type="number"
                            value={item.netWeight}
                            onChange={(e) => handleItemChange(idx, "netWeight", Number(e.target.value))}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                            min="1"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`stock-owner-${idx}`}>Stock owner</label>
                          <select id={`stock-owner-${idx}`}
                            value={item.ownerId}
                            onChange={(e) => handleItemChange(idx, "ownerId", e.target.value)}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                          >
                            <option value="">Company stock</option>
                            {owners.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-2 flex items-center gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`packaging-remarks-${idx}`}>Packaging Remarks</label>
                            <input id={`packaging-remarks-${idx}`}
                              type="text"
                              value={item.remarks}
                              onChange={(e) => handleItemChange(idx, "remarks", e.target.value)}
                              placeholder="e.g. 50kg PP Green Bags"
                              className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                            />
                          </div>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              className="mt-3.5 p-1 text-destructive hover:bg-destructive/10 rounded cursor-pointer"
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

              {/* Total Banner */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-between text-xs">
                <div>
                  <span className="text-muted-foreground">Total Bags Cleared: </span>
                  <strong className="text-foreground font-mono">{formatBags(totalBags)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Dispatched Weight: </span>
                  <strong className="text-blue-600 dark:text-blue-400 font-mono text-sm">
                    {formatWeight(totalWeight)}
                  </strong>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
                  <span>{isPending ? "Authorizing…" : "Authorize & Deduct Stock"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Gate pass preview: the SAME GatePassPrint document that prints,
          so preview and paper can never drift apart. No company address
          is passed, so nothing invented appears on the document. */}
      {selectedPassForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white text-black rounded-md shadow-md max-h-[90dvh] overflow-y-auto">
            <div className="p-4 sm:p-6">
              <GatePassPrint
                passNo={selectedPassForPrint.pass_no}
                date={selectedPassForPrint.date}
                status={selectedPassForPrint.status}
                customerName={selectedPassForPrint.customer_name}
                destination={selectedPassForPrint.destination}
                godown={selectedPassForPrint.godown_name}
                orderRef={selectedPassForPrint.order_ref}
                transporter={selectedPassForPrint.transporter}
                vehicleNo={selectedPassForPrint.vehicle_no}
                driverName={selectedPassForPrint.driver_name}
                driverPhone={selectedPassForPrint.driver_phone}
                notes={selectedPassForPrint.notes}
                items={selectedPassForPrint.items.map((it) => ({ product: it.product_name, bags: it.bags_count, weightKg: it.net_weight_kg, grossWeightKg: it.gross_weight_kg, remarks: it.remarks }))}
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
      {returnTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-6 bg-card border border-border shadow-md rounded-md space-y-4 my-8 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">Return {returnTarget.pass_no}</h3>
              <button type="button" onClick={() => setReturnTarget(null)} className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer">✕</button>
            </div>
            <p className="text-xs text-muted-foreground">Reduce a quantity for a partial return. The remainder stays returnable, and the pass stays reversible until it is fully returned.</p>
            <div className="space-y-2 text-xs">
              {returnLines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2 p-2.5 rounded-lg bg-muted border border-border items-center">
                  <div><div className="font-bold text-foreground">{line.productName}</div><div className="text-muted-foreground">Owner: {line.ownerName}</div></div>
                  <div className="text-muted-foreground">Still returnable: <strong className="text-foreground">{line.remainingKg} kg</strong></div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`return-qty-kg-${idx}`}>Return qty (kg)</label>
                    <input id={`return-qty-kg-${idx}`} type="number" min="0" max={line.remainingKg} value={line.qtyKg} onChange={(e) => setReturnLines((prev) => prev.map((l, i) => (i === idx ? { ...l, qtyKg: Number(e.target.value) } : l)))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" />
                  </div>
                  <div className="text-muted-foreground">Left after return: <strong className="text-foreground">{Math.max(0, Math.round((line.remainingKg - (Number(line.qtyKg) || 0)) * 100) / 100)} kg</strong></div>
                </div>
              ))}
            </div>
            <div>
              <label className="block font-medium text-foreground mb-1 text-xs" htmlFor="return-reason">Return reason *</label>
              <input id="return-reason" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="Why is this stock coming back?" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground text-xs" required />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={() => setReturnTarget(null)} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Cancel</button>
              <button type="button" onClick={handlePartialReturn} disabled={returnPending} className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60">{returnPending ? "Returning…" : "Confirm Return"}</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showPostConfirm}
        title="Authorize this gate pass?"
        description={draftPass ? `Posting will deduct ${formatWeight(draftPass.total_weight_kg)} (${formatBags(draftPass.total_bags)}) from ${draftPass.godown_name || "the dispatch godown"} for vehicle ${draftPass.vehicle_no}. A pass number is assigned on posting. A posted pass can only be changed by reversal.` : ""}
        confirmLabel="Authorize & Deduct Stock"
        pending={isPending}
        onConfirm={handleConfirmPost}
        onCancel={() => { setShowPostConfirm(false); setDraftPass(null) }}
      />
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.pass_no ?? ""}
        note="The dispatched stock will be restored. The pass number will never be reused."
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
    </div>
  )
}
