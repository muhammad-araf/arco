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
import { GodownStore } from "@/lib/services/godown-store"
import { GatePass, GatePassItem, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatDate, formatDateTime } from "@/lib/utils"
import { exportToCSV } from "@/lib/export-utils"

export default function GatePassPage() {
  const [gatePasses, setGatePasses] = React.useState<GatePass[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])

  // Modal / Print State
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [selectedPassForPrint, setSelectedPassForPrint] = React.useState<GatePass | null>(null)

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

  const loadData = React.useCallback(() => {
    setGatePasses(GodownStore.getGatePasses())
    setGodowns(GodownStore.getGodowns())
    setProducts(GodownStore.getProducts())
    setCustomers(GodownStore.getParties().filter((p) => p.type === "customer" || p.type === "both"))
  }, [])

  React.useEffect(() => {
    loadData()
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

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
    if (!customerId || !godownId || !vehicleNo || !driverName) return

    // Stock verification
    for (const item of items) {
      const available = GodownStore.getProductStock(item.productId, godownId)
      if (item.netWeight > available) {
        const prod = products.find((p) => p.id === item.productId)
        alert(`Insufficient stock for ${prod?.name || "Product"}. Available: ${available} kg, Requested: ${item.netWeight} kg`)
        return
      }
    }

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

    const newPass: GatePass = {
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
    }

    GodownStore.postGatePass(newPass)
    setIsModalOpen(false)
    setSelectedPassForPrint(newPass)
  }

  return (
    <div className="space-y-6">
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
            Issued Gate Passes ({gatePasses.length})
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
              {gatePasses.map((gp) => (
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
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase border border-emerald-500/20">
                      Dispatched
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <button
                      type="button"
                      onClick={() => setSelectedPassForPrint(gp)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title="Print A4 Gate Pass"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
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
          <div className="expensive-card w-full max-w-3xl p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 my-8">
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
                    const available = item.productId ? GodownStore.getProductStock(item.productId, godownId) : 0
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
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Authorize & Deduct Stock</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Formal A4 Printable Gate Pass */}
      {selectedPassForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-8 bg-white text-black shadow-2xl rounded-xl printable-document space-y-6">
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
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>Print Official Gate Pass (A4)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
