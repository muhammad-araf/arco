"use client"

import * as React from "react"
import {
  PackageCheck,
  Plus,
  Boxes,
  AlertTriangle,
  CheckCircle2,
  Package,
  Layers,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react"
import { GodownStore } from "@/lib/services/godown-store"
import { PackagingType, PackingRecord, Product } from "@/lib/types/database"
import { formatBags, formatCurrency, formatWeight, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  PageSkeleton,
  SubmitSpinner,
  isPositive,
} from "@/components/erp-ui"

export default function PackingPage() {
  const [packaging, setPackaging] = React.useState<PackagingType[]>([])
  const [packingRecords, setPackingRecords] = React.useState<PackingRecord[]>([])
  const [products, setProducts] = React.useState<Product[]>([])

  // Modal
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftRecord, setDraftRecord] = React.useState<PackingRecord | null>(null)
  const packGuard = React.useRef(false)
  const [packagingId, setPackagingId] = React.useState("")
  const [productId, setProductId] = React.useState("")
  const [bagsPacked, setBagsPacked] = React.useState<number>(100)
  const [damagedBags, setDamagedBags] = React.useState<number>(2)
  const [packingRate, setPackingRate] = React.useState<number>(15)
  const [notes, setNotes] = React.useState("")

  const loadData = React.useCallback(() => {
    setPackaging(GodownStore.getPackaging())
    setProducts(GodownStore.getProducts().filter((p) => p.category === "finished_seed" || p.category === "intermediate"))
    const state = (GodownStore as any).getState()
    setPackingRecords(state.packingRecords || [])
  }, [])

  React.useEffect(() => {
    loadData()
    setIsLoading(false)
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

  React.useEffect(() => {
    if (packaging.length > 0 && !packagingId) setPackagingId(packaging[0].id)
    if (products.length > 0 && !productId) setProductId(products[0].id)
  }, [packaging, products, packagingId, productId])

  const selectedPkg = packaging.find((p) => p.id === packagingId)
  const capacityKg = selectedPkg?.capacity_kg || 50
  const totalPackedKg = bagsPacked * capacityKg
  const totalCharge = bagsPacked * packingRate

  const handleRecordPacking = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §8: positive bag count, non-negative damage/rate, and the
    // bardana stock guard — packed + damaged bags both leave inventory.
    if (!packagingId) return setFormError("Select a bag / bardana type.")
    if (!productId) return setFormError("Select the product being packed.")
    if (!isPositive(bagsPacked)) return setFormError("Bags packed must be greater than zero.")
    if (damagedBags < 0) return setFormError("Damaged bags cannot be negative.")
    if (packingRate < 0) return setFormError("Packing rate cannot be negative.")
    const totalBagsNeeded = bagsPacked + damagedBags
    if (selectedPkg && selectedPkg.current_stock < totalBagsNeeded) {
      return setFormError(`Insufficient bag stock: ${selectedPkg.current_stock} ${selectedPkg.name} bags available, but ${totalBagsNeeded} needed (${bagsPacked} packed + ${damagedBags} damaged). Purchase more bardana first.`)
    }
    setFormError("")
    const selectedProd = products.find((p) => p.id === productId)
    setDraftRecord({
      id: `pck-${Date.now()}`,
      packing_no: `PCK-2026-${String(packingRecords.length + 1).padStart(3, "0")}`,
      date: new Date().toISOString(),
      reference_type: "general",
      output_product_id: productId,
      output_product_name: selectedProd?.name,
      packaging_type_id: packagingId,
      packaging_name: selectedPkg?.name,
      bags_packed: bagsPacked,
      bag_capacity_kg: capacityKg,
      total_packed_kg: totalPackedKg,
      packing_rate: packingRate,
      packing_charge: totalCharge,
      damaged_bags: damagedBags,
      status: "posted",
      notes: notes || undefined,
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const handleConfirmPacking = () => {
    if (!draftRecord || packGuard.current) return
    packGuard.current = true
    setIsPending(true)
    try {
      const totalBagsNeeded = draftRecord.bags_packed + (draftRecord.damaged_bags || 0)
      const state = (GodownStore as any).getState()
      state.packaging = state.packaging.map((pkg: PackagingType) =>
        pkg.id === packagingId ? { ...pkg, current_stock: pkg.current_stock - totalBagsNeeded } : pkg
      )
      state.packingRecords = [draftRecord, ...(state.packingRecords || [])]
      ;(GodownStore as any).saveState(state)
      setFormNotice(`${draftRecord.packing_no} posted — ${draftRecord.bags_packed} bags packed (${formatWeight(draftRecord.total_packed_kg)}), ${draftRecord.damaged_bags || 0} damaged, ${totalBagsNeeded} bags deducted from bardana.`)
    } finally {
      setIsPending(false)
      packGuard.current = false
      setShowConfirm(false)
      setIsModalOpen(false)
      setDraftRecord(null)
    }
  }

  // Spec §8.2 / §16 bardana ledger, derived from posted packing records:
  // closing is the live packaging stock; consumed/damaged are totals to date.
  const bardanaLedger = packaging.map((pkg) => {
    const recs = packingRecords.filter((r) => r.packaging_type_id === pkg.id)
    return {
      ...pkg,
      consumed: recs.reduce((a, r) => a + r.bags_packed, 0),
      damaged: recs.reduce((a, r) => a + (r.damaged_bags || 0), 0),
    }
  })

  if (isLoading) return <PageSkeleton />

  return (
    <div className="space-y-6">
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <PackageCheck className="h-6 w-6 text-emerald-500" />
            Final Unit Packing & Bardana Ledger
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track packaging material inventory (PP bags, jute bardana), bag consumption, stitch/packing charges, and damages.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Record Packing & Bag Consumption</span>
        </button>
      </div>

      {/* Bardana Packaging Stock Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {packaging.map((pkg) => (
          <div key={pkg.id} className="expensive-card p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground font-bold">{pkg.code}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
                  {pkg.capacity_kg} kg Bag
                </span>
              </div>
              <h3 className="font-bold text-sm text-foreground mt-2">{pkg.name}</h3>
            </div>

            <div className="my-3">
              <div className="text-2xl font-black text-foreground">
                {formatBags(pkg.current_stock)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Unit Cost: <strong className="text-foreground">{formatCurrency(pkg.cost_per_bag)}</strong> / bag
              </div>
            </div>

            <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Reorder: {pkg.reorder_level} bags</span>
              <span className={pkg.current_stock <= pkg.reorder_level ? "text-amber-500 font-bold" : "text-emerald-500 font-semibold"}>
                {pkg.current_stock <= pkg.reorder_level ? "Order Needed" : "Sufficient Stock"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Bardana Ledger (spec §8.2): consumed + damaged to date, live closing */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-emerald-500" />
            Bardana Ledger — Consumed, Damaged &amp; Closing
          </h2>
          <span className="text-xs text-muted-foreground">Opening + purchases are tracked in Masters &amp; Purchases; closing here is live stock.</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Bag / Bardana Type</th>
                <th className="pb-3 font-bold text-right">Consumed (packed)</th>
                <th className="pb-3 font-bold text-right">Damaged</th>
                <th className="pb-3 font-bold text-right">Closing Stock</th>
                <th className="pb-3 font-bold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {bardanaLedger.map((pkg) => (
                <tr key={pkg.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 font-semibold text-foreground">{pkg.name}</td>
                  <td className="py-3 text-right font-mono">{pkg.consumed} bags</td>
                  <td className="py-3 text-right font-mono text-red-600 dark:text-red-400">{pkg.damaged} bags</td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">{pkg.current_stock} bags</td>
                  <td className="py-3 text-center">
                    <span className={pkg.current_stock <= pkg.reorder_level ? "px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase border border-amber-500/20" : "px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase border border-emerald-500/20"}>
                      {pkg.current_stock <= pkg.reorder_level ? "Order needed" : "Sufficient"}
                    </span>
                  </td>
                </tr>
              ))}
              {bardanaLedger.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4">
                    <EmptyState title="No packaging types yet" hint="Add bag / bardana types in Master Data to track consumption here." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Packing Records Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Layers className="h-4 w-4 text-emerald-500" />
            Packing & Bagging History ({packingRecords.length})
          </h2>
          <span className="text-xs text-muted-foreground">Bardana Consumed & Labor Packing Charges</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Packing No</th>
                <th className="pb-3 font-bold">Date</th>
                <th className="pb-3 font-bold">Product Seed Packed</th>
                <th className="pb-3 font-bold">Bag / Bardana Type</th>
                <th className="pb-3 font-bold text-right">Bags Packed</th>
                <th className="pb-3 font-bold text-right">Total Weight</th>
                <th className="pb-3 font-bold text-right">Damaged Bags</th>
                <th className="pb-3 font-bold text-right">Labor Charge</th>
                <th className="pb-3 font-bold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {packingRecords.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 font-bold text-foreground font-sans">{r.packing_no}</td>
                  <td className="py-3 text-muted-foreground font-sans">{formatDate(r.date)}</td>
                  <td className="py-3 font-semibold text-foreground font-sans">{r.output_product_name}</td>
                  <td className="py-3 text-muted-foreground font-sans">{r.packaging_name}</td>
                  <td className="py-3 text-right font-black text-foreground">{r.bags_packed} bags</td>
                  <td className="py-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                    {formatWeight(r.total_packed_kg)}
                  </td>
                  <td className="py-3 text-right text-destructive font-bold">{r.damaged_bags} bags</td>
                  <td className="py-3 text-right font-bold text-foreground">{formatCurrency(r.packing_charge)}</td>
                  <td className="py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase">
                      Posted
                    </span>
                  </td>
                </tr>
              ))}
              {packingRecords.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 font-sans">
                    <EmptyState
                      title="No packing entries yet"
                      hint="Log a bagging run — packed and damaged bags are both deducted from bardana stock."
                      actionLabel="Record Packing & Bag Consumption"
                      onAction={() => setIsModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Packing Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <PackageCheck className="h-4 w-4 text-emerald-500" />
                Record Packing & Bagging
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordPacking} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              <div>
                <label className="block font-medium text-foreground mb-1">Product Seed to Pack</label>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Packaging Bag Type (Bardana)</label>
                <select
                  value={packagingId}
                  onChange={(e) => setPackagingId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                >
                  {packaging.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name} ({pkg.capacity_kg}kg) - Avail: {pkg.current_stock} bags
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Number of Bags</label>
                  <input
                    type="number"
                    value={bagsPacked}
                    onChange={(e) => setBagsPacked(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Damaged / Torn Bags</label>
                  <input
                    type="number"
                    value={damagedBags}
                    onChange={(e) => setDamagedBags(Number(e.target.value))}
                    min="0"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Packing Labor Rate / Bag (PKR)</label>
                <input
                  type="number"
                  value={packingRate}
                  onChange={(e) => setPackingRate(Number(e.target.value))}
                  min="0"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                />
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Packed Weight:</span>
                  <strong className="text-foreground font-mono">{formatWeight(totalPackedKg)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Bags Deducted:</span>
                  <strong className="text-destructive font-mono">{bagsPacked + damagedBags} bags</strong>
                </div>
                <div className="flex justify-between pt-1 border-t border-emerald-500/20">
                  <span className="text-muted-foreground font-bold">Labor Charge:</span>
                  <strong className="text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                    {formatCurrency(totalCharge)}
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
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
                  <span>{isPending ? "Posting…" : "Post & Deduct Bardana"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showConfirm}
        title="Post this packing record?"
        description={draftRecord ? `${draftRecord.packing_no} will pack ${draftRecord.bags_packed} bags (${formatWeight(draftRecord.total_packed_kg)}) of ${draftRecord.output_product_name || "the selected product"} and deduct ${draftRecord.bags_packed + (draftRecord.damaged_bags || 0)} ${draftRecord.packaging_name || "bags"} from bardana stock (packed + damaged). Packing charge: ${formatCurrency(draftRecord.packing_charge)}.` : ""}
        confirmLabel="Post & Deduct Bardana"
        pending={isPending}
        onConfirm={handleConfirmPacking}
        onCancel={() => { setShowConfirm(false); setDraftRecord(null) }}
      />
    </div>
  )
}
