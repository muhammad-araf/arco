"use client"

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
import { listGatePasses, createGatePassDraft, postGatePass, reverseGatePass, returnGatePass } from "@/app/actions/gatepass"
import { getStockSummary } from "@/app/actions/inventory"
import { listGodowns, listProducts, listParties } from "@/app/actions/masters"
import { GatePassPrint, PrintButton } from "@/components/print"
import { GatePass, GatePassItem, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatDate, formatDateTime } from "@/lib/utils"
import { exportToCSV } from "@/lib/export-utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  PageSkeleton,
  ReversalDialog,
  SubmitSpinner,
  getUrlFilter,
  isPositive,
  isTodayISO,
} from "@/components/erp-ui"

export default function GatePassPage() {
  const [gatePasses, setGatePasses] = React.useState<GatePass[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])
  const [summaryRows, setSummaryRows] = React.useState<any[]>([])
  const [returnTarget, setReturnTarget] = React.useState<any | null>(null)
  const [returnPending, setReturnPending] = React.useState(false)

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
  }[]>([
    { productId: "", bags: 100, netWeight: 5000, remarks: "50kg Packed Certified Bags" },
  ])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    const [gp, g, pr, pa, sm] = await Promise.all([listGatePasses(), listGodowns(), listProducts(), listParties(), getStockSummary()])
    const failed = [gp, g, pr, pa, sm].find((x) => !x.success)
    if (failed) setFormError(failed.error ?? "Could not load gate pass data.")
    const godownList = (Array.isArray(g.data) ? g.data : []) as Godown[]
    const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
    const partyList = (Array.isArray(pa.data) ? pa.data : []) as Party[]
    setGodowns(godownList); setProducts(productList); setCustomers(partyList.filter((x) => x.type === "customer" || x.type === "both"))
    setSummaryRows(Array.isArray(sm.data) ? sm.data : [])
    setGatePasses((Array.isArray(gp.data) ? gp.data : []).map((row: any) => ({
      ...row,
      customer_name: partyList.find((x) => x.id === row.customer_id)?.name ?? row.customer_id,
      godown_name: godownList.find((x) => x.id === row.godown_id)?.name ?? row.godown_id,
      items: (row.gate_pass_items ?? row.items ?? []).map((it: any) => ({
        ...it, product_name: productList.find((x) => x.id === it.product_id)?.name ?? it.product_id,
      })),
    })))
    setIsLoading(false)
  }, [])

  React.useEffect(() => {
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
    if (customers.length > 0 && !customerId) setCustomerId(customers[0].id)
    const finishedProds = products.filter((p) => p.category === "finished_seed" || p.category === "by_product")
    if (finishedProds.length > 0 && items[0].productId === "") {
      setItems([{ productId: finishedProds[0].id, bags: 100, netWeight: 5000, remarks: "Packed in 50kg Green PP Bags" }])
    }
  }, [godowns, customers, products, godownId, customerId, items])

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        productId: products[0]?.id || "",
        bags: 50,
        netWeight: 2500,
        remarks: "Packed seed bags",
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
      const available = summaryRows.filter((r) => r.product_id === item.productId && r.godown_id === godownId).reduce((a, r) => a + (Number(r.balance_kg) || 0), 0)
      if (item.netWeight > available) {
        const prod = products.find((p) => p.id === item.productId)
        return setFormError(`Insufficient stock for ${prod?.name || "Product"}: ${available} kg available in this godown, but ${item.netWeight} kg requested. Reduce the quantity or pick another godown.`)
      }
    }
    setFormError("")
    const selectedCust = customers.find((c) => c.id === customerId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const passNo = `GP-2026-${String(gatePasses.length + 85).padStart(4, "0")}`
    const gatePassItems: GatePassItem[] = items.map((item, idx) => {
      const prod = products.find((p) => p.id === item.productId)
      return {
        id: `gpi-${Date.now()}-${idx}`,
        gate_pass_id: `gp-${Date.now()}`,
        product_id: item.productId,
        product_name: prod?.name || "Seed",
        bags_count: Number(item.bags),
        net_weight_kg: Number(item.netWeight),
        gross_weight_kg: Number(item.netWeight) + Number(item.bags) * 0.5,
        remarks: item.remarks,
      }
    })
    setDraftPass({
      id: `gp-${Date.now()}`,
      pass_no: passNo,
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
        items: items.map((it) => ({ productId: it.productId, bags: Number(it.bags), netWeightKg: Number(it.netWeight), remarks: it.remarks })),
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the gate pass draft.")
        return
      }
      const posted = await postGatePass((created.data as any).id, `gatepass-${Date.now()}`)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the gate pass.")
        return
      }
      const row: any = posted.data ?? created.data
      setFormNotice(`${row.pass_no ?? draftPass.pass_no} dispatched — ${formatWeight(row.total_weight_kg ?? draftPass.total_weight_kg)} deducted from ${draftPass.godown_name || "the godown"}.`)
      setSelectedPassForPrint({ ...draftPass, pass_no: row.pass_no ?? draftPass.pass_no, status: "posted" })
      setShowPostConfirm(false)
      setIsModalOpen(false)
      setDraftPass(null)
      await loadData()
    } finally {
      setIsPending(false)
      postGuard.current = false
    }
  }

  const handleFullReturn = async () => {
    if (!returnTarget || returnPending) return
    setReturnPending(true)
    try {
      const res = await returnGatePass(returnTarget.id, { reason: "Full return of dispatched goods" }, `gatepass-return-${Date.now()}`)
      if (!res.success) {
        setFormError(res.error ?? "Could not return the gate pass.")
        return
      }
      setFormNotice(`${returnTarget.pass_no} returned in full — stock restored.`)
      setReturnTarget(null)
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
      const res = await reverseGatePass(reversalTarget.id, `${reasonCode}: ${reason}`, `gatepass-rev-${Date.now()}`)
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
    ? gatePasses.filter((gp) => isTodayISO(gp.date))
    : drillFilter === "posted"
      ? gatePasses.filter((gp) => gp.status === "posted")
      : gatePasses

  if (isLoading) return <PageSkeleton />

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
            Outgoing Goods & Gate Pass Engine
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Strict dispatch authorizations, vehicle & driver tracking, stock verification, and print-ready A4 gate passes.
          </p>
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-card hover:bg-muted/60 text-foreground border border-border/80 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
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
            <span>Create & Authorize Gate Pass</span>
          </button>
        </div>
      </div>

      {/* Dispatched Passes Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Issued Gate Passes ({visiblePasses.length})
          </h2>
          <span className="text-xs text-muted-foreground">Authorized Premise Clearance Documents</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
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
            <tbody className="divide-y divide-border/40">
              {visiblePasses.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4">
                    <EmptyState
                      title={drillFilter ? "No gate passes match this filter" : "No gate passes issued yet"}
                      hint={drillFilter ? "Clear the dashboard filter above to see the full register." : "Create your first authorized dispatch — stock is verified before the pass is issued."}
                      actionLabel="Create & Authorize Gate Pass"
                      onAction={() => setIsModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
              {visiblePasses.map((gp) => (
                <tr key={gp.id} className="hover:bg-muted/30 transition-colors">
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
                    <span className={gp.status === "reversed" ? "px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase border border-red-500/20" : "px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase border border-emerald-500/20"}>
                      {gp.status === "reversed" ? "Reversed" : "Dispatched"}
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedPassForPrint(gp)}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Print A4 Gate Pass"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      {gp.status === "posted" && (
                        <button
                          type="button"
                          onClick={() => setReturnTarget(gp)}
                          className="px-2 py-1 rounded-md hover:bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-semibold cursor-pointer"
                          title="Return this pass in full (partial returns pass items via returnGatePass)"
                        >
                          Return
                        </button>
                      )}
                      {gp.status === "posted" && (
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div className="expensive-card w-full max-w-3xl p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 my-8 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
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
                  <label className="block font-medium text-foreground mb-1">Customer / Consignee</label>
                  <select
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
                  <label className="block font-medium text-foreground mb-1">Dispatch Godown</label>
                  <select
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
                  <label className="block font-medium text-foreground mb-1">Delivery Destination</label>
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="e.g. Sahiwal Regional Depot"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Vehicle / Truck No</label>
                  <input
                    type="text"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    placeholder="e.g. LES-4419"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Driver Full Name</label>
                  <input
                    type="text"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder="Driver's Name"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Driver Mobile Number</label>
                  <input
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
                    const available = item.productId ? summaryRows.filter((r) => r.product_id === item.productId && r.godown_id === godownId).reduce((a, r) => a + (Number(r.balance_kg) || 0), 0) : 0
                    return (
                      <div
                        key={idx}
                        className="grid grid-cols-1 sm:grid-cols-6 gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/70 text-xs items-center"
                      >
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-muted-foreground mb-0.5">
                            Product (Available: {formatWeight(available)})
                          </label>
                          <select
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
                          <label className="block text-[10px] text-muted-foreground mb-0.5">Bags Count</label>
                          <input
                            type="number"
                            value={item.bags}
                            onChange={(e) => handleItemChange(idx, "bags", Number(e.target.value))}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                            min="1"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5">Net Wt (kg)</label>
                          <input
                            type="number"
                            value={item.netWeight}
                            onChange={(e) => handleItemChange(idx, "netWeight", Number(e.target.value))}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                            min="1"
                          />
                        </div>

                        <div className="sm:col-span-2 flex items-center gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] text-muted-foreground mb-0.5">Packaging Remarks</label>
                            <input
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

      {/* Formal A4 Printable Gate Pass */}
      {selectedPassForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-4 sm:p-8 bg-white text-black shadow-2xl rounded-xl printable-document space-y-6 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <h1 className="text-2xl font-black tracking-tight uppercase">ARCO SEED GODOWN</h1>
                <div className="text-xs text-gray-600">OFFICIAL OUTGOING GOODS GATE PASS & DISPATCH VOUCHER</div>
                <div className="text-[10px] text-gray-500 mt-1">Plot 14-B, Grain Market Industrial Area</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-mono font-black text-gray-900 border-2 border-black px-3 py-1 inline-block">
                  {selectedPassForPrint.pass_no}
                </div>
                <div className="text-xs text-gray-500 mt-1">{formatDateTime(selectedPassForPrint.date)}</div>
              </div>
            </div>

            {/* Consignee & Vehicle Details Grid */}
            <div className="grid grid-cols-2 gap-4 text-xs bg-gray-50 p-4 rounded border border-gray-200">
              <div>
                <span className="text-gray-500 uppercase text-[10px] font-bold block">Consignee / Customer</span>
                <strong className="text-sm block">{selectedPassForPrint.customer_name}</strong>
                <span className="text-gray-600 text-[11px]">{selectedPassForPrint.destination || "Factory / Farm Dispatch"}</span>
              </div>

              <div>
                <span className="text-gray-500 uppercase text-[10px] font-bold block">Dispatch Godown</span>
                <strong className="text-sm block">{selectedPassForPrint.godown_name}</strong>
                <span className="text-gray-600 text-[11px]">Authorized Exit Point</span>
              </div>

              <div>
                <span className="text-gray-500 uppercase text-[10px] font-bold block">Vehicle Number</span>
                <strong className="text-base font-mono font-black block">{selectedPassForPrint.vehicle_no}</strong>
              </div>

              <div>
                <span className="text-gray-500 uppercase text-[10px] font-bold block">Driver Details</span>
                <strong className="text-sm block">{selectedPassForPrint.driver_name}</strong>
                <span className="text-gray-600 font-mono">{selectedPassForPrint.driver_phone || "Contact Not Recorded"}</span>
              </div>
            </div>

            {/* Items Table */}
            <table className="w-full text-left border-collapse text-xs mt-4">
              <thead>
                <tr className="border-b-2 border-black bg-gray-100">
                  <th className="py-2 px-2">Sr</th>
                  <th className="py-2">Description of Seed / Goods</th>
                  <th className="py-2 text-right">Bags</th>
                  <th className="py-2 text-right">Net Weight (kg)</th>
                  <th className="py-2 px-2">Packaging Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-300">
                {selectedPassForPrint.items.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="py-2.5 px-2 font-mono">{idx + 1}</td>
                    <td className="py-2.5 font-bold text-gray-900">{item.product_name}</td>
                    <td className="py-2.5 text-right font-mono font-bold">{item.bags_count}</td>
                    <td className="py-2.5 text-right font-mono font-black">{item.net_weight_kg.toLocaleString()} kg</td>
                    <td className="py-2.5 px-2 text-gray-600">{item.remarks || "-"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black font-black bg-gray-50 text-sm">
                  <td colSpan={2} className="py-2 px-2">Total Verified for Dispatch</td>
                  <td className="py-2 text-right font-mono">{selectedPassForPrint.total_bags} bags</td>
                  <td className="py-2 text-right font-mono text-emerald-800">{selectedPassForPrint.total_weight_kg.toLocaleString()} kg</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>

            {/* Driver Declaration */}
            <div className="p-3 bg-gray-50 border border-gray-200 rounded text-[11px] text-gray-600 italic">
              "I hereby acknowledge the receipt of the specified goods in sound condition and sealed packaging as listed above for onward transit to the destination."
            </div>

            {/* Signature Blocks */}
            <div className="grid grid-cols-3 gap-6 pt-16 text-center text-xs">
              <div className="border-t-2 border-gray-400 pt-2 font-medium">Driver Signature</div>
              <div className="border-t-2 border-gray-400 pt-2 font-medium">Security Gate Officer</div>
              <div className="border-t-2 border-gray-400 pt-2 font-bold">Godown Incharge Stamp</div>
            </div>

            {/* Modal Controls */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t no-print">
              <button
                type="button"
                onClick={() => setSelectedPassForPrint(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              <PrintButton label="Print Official Gate Pass (A4)" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
            </div>
          </div>
        </div>
      )}
      {selectedPassForPrint && selectedPassForPrint.status === "posted" && (
        <div className="hidden print:block">
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
            items={selectedPassForPrint.items.map((it) => ({ product: it.product_name, bags: it.bags_count, weightKg: it.net_weight_kg, grossWeightKg: it.gross_weight_kg, remarks: it.remarks }))}
          />
        </div>
      )}
      <ConfirmDialog
        open={returnTarget !== null}
        title={`Return ${returnTarget?.pass_no ?? ""} in full?`}
        description="The full dispatched quantity is returned to stock. For a partial return, call returnGatePass with item quantities — the server action supports it; this button covers the full-return flow."
        confirmLabel="Return in full"
        pending={returnPending}
        onConfirm={handleFullReturn}
        onCancel={() => setReturnTarget(null)}
      />
      <ConfirmDialog
        open={showPostConfirm}
        title="Authorize this gate pass?"
        description={draftPass ? `${draftPass.pass_no} will deduct ${formatWeight(draftPass.total_weight_kg)} (${formatBags(draftPass.total_bags)}) from ${draftPass.godown_name || "the dispatch godown"} for vehicle ${draftPass.vehicle_no}. A posted pass can only be changed by reversal.` : ""}
        confirmLabel="Authorize & Deduct Stock"
        pending={isPending}
        onConfirm={handleConfirmPost}
        onCancel={() => { setShowPostConfirm(false); setDraftPass(null) }}
      />
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.pass_no ?? ""}
        note="Compensating inward ledger rows will restore the dispatched stock. The pass number will never be reused."
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
    </div>
  )
}
