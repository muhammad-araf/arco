"use client"

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
import { GodownStore } from "@/lib/services/godown-store"
import { IncomingGoodsVoucher, IncomingGoodsItem, Godown, Product, Party } from "@/lib/types/database"
import { formatWeight, formatBags, formatCurrency, formatDate } from "@/lib/utils"

export default function InwardPage() {
  const [vouchers, setVouchers] = React.useState<IncomingGoodsVoucher[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [parties, setParties] = React.useState<Party[]>([])

  // Modal / Form state
  const [isFormOpen, setIsFormOpen] = React.useState(false)
  const [selectedVoucherForPrint, setSelectedVoucherForPrint] = React.useState<IncomingGoodsVoucher | null>(null)

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
  }[]>([
    { productId: "", bags: 100, grossWeight: 5050, tareWeight: 50, rate: 120 },
  ])

  const loadData = React.useCallback(() => {
    setVouchers(GodownStore.getInwardVouchers())
    setGodowns(GodownStore.getGodowns())
    setProducts(GodownStore.getProducts())
    setParties(GodownStore.getParties().filter((p) => p.type === "supplier" || p.type === "both" || p.type === "source"))
  }, [])

  React.useEffect(() => {
    loadData()
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

  React.useEffect(() => {
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
    if (parties.length > 0 && !partyId) setPartyId(parties[0].id)
    if (products.length > 0 && items[0].productId === "") {
      setItems([{ productId: products[0].id, bags: 200, grossWeight: 10100, tareWeight: 100, rate: 125 }])
    }
  }, [godowns, parties, products, godownId, partyId, items])

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        productId: products[0]?.id || "",
        bags: 100,
        grossWeight: 5050,
        tareWeight: 50,
        rate: 120,
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
    if (!partyId || !godownId) return

    const selectedParty = parties.find((p) => p.id === partyId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const voucherNo = `INW-2026-${String(vouchers.length + 1).padStart(3, "0")}`

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

    const newVoucher: IncomingGoodsVoucher = {
      id: `inw-${Date.now()}`,
      voucher_no: voucherNo,
      date: new Date().toISOString(),
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
    }

    GodownStore.postInwardVoucher(newVoucher)
    setIsFormOpen(false)
    setSelectedVoucherForPrint(newVoucher)
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Truck className="h-6 w-6 text-emerald-500" />
            Inward Goods & Godown Receiving
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Log raw seed arrivals, bilty references, tare weights, and post directly to the stock ledger.
          </p>
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

      {/* Inward Vouchers Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-500" />
            Posted Inward Vouchers ({vouchers.length})
          </h2>
          <span className="text-xs text-muted-foreground">Immutable Stock Ledger Receipts</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
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
            <tbody className="divide-y divide-border/40">
              {vouchers.map((v) => (
                <tr key={v.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 font-bold text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{v.voucher_no}</span>
                      <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold uppercase">
                        Posted
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
                    <button
                      type="button"
                      onClick={() => setSelectedVoucherForPrint(v)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title="Print Inward Receiving Slip"
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

      {/* Creation Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div className="expensive-card w-full max-w-3xl p-6 bg-card border border-border shadow-2xl rounded-xl my-8 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-border/60">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Truck className="h-5 w-5 text-emerald-500" />
                  Record Inward Seed Voucher
                </h3>
                <p className="text-xs text-muted-foreground">
                  Upon posting, inventory will be atomically added to the selected godown's stock ledger.
                </p>
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
              {/* Header Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-foreground mb-1">Supplier / Party</label>
                  <select
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
                  <label className="block font-medium text-foreground mb-1">Target Godown</label>
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
                  <label className="block font-medium text-foreground mb-1">Bilty Number</label>
                  <input
                    type="text"
                    value={biltyNo}
                    onChange={(e) => setBiltyNo(e.target.value)}
                    placeholder="e.g. BL-88412"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Truck / Vehicle No</label>
                  <input
                    type="text"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    placeholder="e.g. LES-9941"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Driver Name</label>
                  <input
                    type="text"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder="Driver's Full Name"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Driver Contact</label>
                  <input
                    type="text"
                    value={driverPhone}
                    onChange={(e) => setDriverPhone(e.target.value)}
                    placeholder="0300-XXXXXXX"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-foreground mb-1">Remarks / Quality Notes</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Moisture level, physical purity or grain condition"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
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
                        className="grid grid-cols-1 sm:grid-cols-6 gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/70 text-xs items-center"
                      >
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-muted-foreground mb-0.5">Product</label>
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
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                            min="1"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5">Gross Wt (kg)</label>
                          <input
                            type="number"
                            value={item.grossWeight}
                            onChange={(e) => handleItemChange(idx, "grossWeight", Number(e.target.value))}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-muted-foreground mb-0.5">Tare Wt (kg)</label>
                          <input
                            type="number"
                            value={item.tareWeight}
                            onChange={(e) => handleItemChange(idx, "tareWeight", Number(e.target.value))}
                            className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground"
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] text-muted-foreground mb-0.5">Rate / kg</label>
                            <input
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
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Post & Update Stock Ledger</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Inward Slip View */}
      {selectedVoucherForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-4 sm:p-8 bg-white text-black shadow-2xl rounded-xl printable-document space-y-6 max-h-[90dvh] overflow-y-auto">
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
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>Print Receiving Slip</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
