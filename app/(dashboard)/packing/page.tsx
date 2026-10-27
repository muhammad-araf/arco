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
import { getBardanaLedger } from "@/app/actions/finance"
import { listPackingRecords, createPackingRecord } from "@/app/actions/production"
import { listPackagingTypes, listProducts } from "@/app/actions/masters"
import { PackagingType, PackingRecord, Product } from "@/lib/types/database"
import { formatBags, formatCurrency, formatWeight, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  SubmitSpinner,
  isPositive,
} from "@/components/erp-ui"
import { PackingSkeleton } from "@/components/route-skeletons"

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
  const [bardanaEntries, setBardanaEntries] = React.useState<any[]>([])
  const [bardanaTotals, setBardanaTotals] = React.useState<any | null>(null)
  const [productId, setProductId] = React.useState("")
  const [bagsPacked, setBagsPacked] = React.useState<number>(100)
  const [damagedBags, setDamagedBags] = React.useState<number>(2)
  const [packingRate, setPackingRate] = React.useState<number>(15)
  const [packedKg, setPackedKg] = React.useState<number>(0)
  const [notes, setNotes] = React.useState("")

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [pk, pr, ba, rec] = await Promise.all([listPackagingTypes(), listProducts(), getBardanaLedger({}), listPackingRecords()])
      const failed = [pk, pr, ba, rec].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load packing data.")
      const packagingList = (Array.isArray(pk.data) ? pk.data : []) as PackagingType[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      setPackaging(packagingList)
      setProducts(productList.filter((x) => x.category === "finished_seed" || x.category === "intermediate"))
      const entries = ba.success ? ((ba.data as any)?.entries ?? []) : []
      setBardanaEntries(entries)
      setBardanaTotals(ba.success ? ba.data : null)
      // History truth: the packing_records table itself, with its real
      // stored packed kg, charge, damaged count and status — never
      // rebuilt from batches, never bags x current capacity.
      setPackingRecords((Array.isArray(rec.data) ? rec.data : []).map((r: any) => ({
        id: r.id,
        packing_no: r.packing_no ?? r.batch_no ?? r.id,
        date: r.date,
        reference_type: r.job_or_batch_id ? "batch" : "general",
        output_product_id: r.output_product_id,
        output_product_name: r.output_product_name,
        packaging_type_id: r.packaging_type_id,
        packaging_name: r.packaging_name,
        bags_packed: Number(r.bags_count || 0),
        bag_capacity_kg: Number(r.capacity_kg || 0),
        total_packed_kg: Number(r.total_packed_kg || 0),
        packing_rate: Number(r.packing_rate || 0),
        packing_charge: Number(r.packing_charge || 0),
        damaged_bags: Number(r.damaged_bags || 0),
        status: r.status,
        notes: r.notes,
        created_at: r.created_at,
      })) as any)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load packing data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Mount load: without this the page never leaves its skeleton —
  // isLoading starts true and only post-action handlers reloaded before.
  React.useEffect(() => { loadData() }, [loadData])

  React.useEffect(() => {
    if (packaging.length > 0 && !packagingId) setPackagingId(packaging[0].id)
    if (products.length > 0 && !productId) setProductId(products[0].id)
  }, [packaging, products, packagingId, productId])

  const selectedPkg = packaging.find((p) => p.id === packagingId)
  const capacityKg = selectedPkg?.capacity_kg || 50
  // Packed weight is ENTERED, not bags x capacity; the charge is
  // bags x rate from the entered values.
  const totalCharge = bagsPacked * packingRate

  const handleRecordPacking = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §8: positive bag count, non-negative damage/rate/packed kg,
    // and the bardana stock guard — packed + damaged bags both leave
    // inventory. The server re-guards all of this before writing.
    if (!packagingId) return setFormError("Select a bag / bardana type.")
    if (!productId) return setFormError("Select the product being packed.")
    if (!isPositive(bagsPacked)) return setFormError("Bags packed must be greater than zero.")
    if (damagedBags < 0) return setFormError("Damaged bags cannot be negative.")
    if (packingRate < 0) return setFormError("Packing rate cannot be negative.")
    if (packedKg < 0) return setFormError("Packed weight cannot be negative.")
    const ledgerClosing = (() => {
      const recs = bardanaEntries.filter((r) => r.packaging_type_id === packagingId)
      const last = recs[recs.length - 1]
      return last ? Number(last.running_balance) : Number(selectedPkg?.current_stock || 0)
    })()
    const totalBagsNeeded = bagsPacked + damagedBags
    if (selectedPkg && ledgerClosing < totalBagsNeeded) {
      return setFormError(`Insufficient bag stock: ${ledgerClosing} ${selectedPkg.name} bags available per the bardana ledger, but ${totalBagsNeeded} needed (${bagsPacked} packed + ${damagedBags} damaged). Purchase more bardana first.`)
    }
    setFormError("")
    const selectedProd = products.find((p) => p.id === productId)
    setDraftRecord({
      id: `pck-${Date.now()}`,
      packing_no: "—",
      date: new Date().toISOString(),
      reference_type: "general",
      output_product_id: productId,
      output_product_name: selectedProd?.name,
      packaging_type_id: packagingId,
      packaging_name: selectedPkg?.name,
      bags_packed: bagsPacked,
      bag_capacity_kg: capacityKg,
      total_packed_kg: packedKg,
      packing_rate: packingRate,
      packing_charge: totalCharge,
      damaged_bags: damagedBags,
      status: "posted",
      notes: notes || undefined,
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const handleConfirmPacking = async () => {
    if (!draftRecord || packGuard.current) return
    packGuard.current = true
    setIsPending(true)
    try {
      // Real write: consumes bardana (with a ledger row) and stores a
      // packing_records row. Seed stock is untouched — this packs
      // output already in stock; batch packing in Production moves
      // seed stock.
      const res = await createPackingRecord({
        packagingTypeId: packagingId,
        outputProductId: productId || undefined,
        bagsPacked,
        damagedBags,
        packingRatePerBag: packingRate,
        packedKg,
      })
      if (!res.success) {
        setFormError(res.error ?? "Could not record the packing.")
        return
      }
      const row: any = res.data
      setFormNotice(`${row.packing_no ?? "Packing"} recorded — ${bagsPacked} bags packed, ${damagedBags} damaged, charge ${formatCurrency(totalCharge)}.`)
      setShowConfirm(false)
      setIsModalOpen(false)
      setDraftRecord(null)
      await loadData()
    } finally {
      setIsPending(false)
      packGuard.current = false
    }
  }

  // Spec §8.2 / §16 bardana ledger: closing is the live packaging
  // stock; consumed is the ledger total to date; damaged is the real
  // stored damaged count from packing_records for this bag type.
  const bardanaLedger = packaging.map((pkg) => {
    const recs = bardanaEntries.filter((r) => r.packaging_type_id === pkg.id)
    const consumed = recs.filter((r) => r.voucher_type !== "purchase" && r.voucher_type !== "purchase_return").reduce((a, r) => a + (Number(r.out_qty) || 0), 0)
    const purchased = recs.filter((r) => r.voucher_type === "purchase").reduce((a, r) => a + (Number(r.in_qty) || 0), 0)
    const damaged = packingRecords.filter((r) => r.packaging_type_id === pkg.id).reduce((a, r) => a + (Number(r.damaged_bags) || 0), 0)
    const last = recs[recs.length - 1]
    return {
      ...pkg,
      consumed,
      purchased,
      damaged,
      current_stock: last ? Number(last.running_balance) || 0 : Number(pkg.current_stock || 0),
    }
  })

  if (isLoading) return <PackingSkeleton />

  return (
    <div className="space-y-6">
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <PackageCheck className="h-6 w-6 text-emerald-500" />
            Packing
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>New Packing</span>
        </button>
      </div>

      {/* Bardana Packaging Stock Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {packaging.map((pkg) => (
          <div key={pkg.id} className="expensive-card p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground font-bold">{pkg.code}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
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

            <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
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
            Bardana Ledger
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[640px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Bag / Bardana Type</th>
                <th className="pb-3 font-bold text-right">Consumed (packed)</th>
                <th className="pb-3 font-bold text-right">Damaged</th>
                <th className="pb-3 font-bold text-right">Closing Stock</th>
                <th className="pb-3 font-bold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bardanaLedger.map((pkg) => (
                <tr key={pkg.id} className="hover:bg-muted transition-colors">
                  <td className="py-3 font-semibold text-foreground">{pkg.name}</td>
                  <td className="py-3 text-right font-mono">{pkg.consumed} bags</td>
                  <td className="py-3 text-right font-mono text-red-600 dark:text-red-400">{pkg.damaged} bags</td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">{pkg.current_stock} bags</td>
                  <td className="py-3 text-center">
                    <span className={pkg.current_stock <= pkg.reorder_level ? "px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase border border-amber-500/20" : "px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase border border-emerald-500/20"}>
                      {pkg.current_stock <= pkg.reorder_level ? "Order needed" : "Sufficient"}
                    </span>
                  </td>
                </tr>
              ))}
              {bardanaLedger.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4">
                    <EmptyState title="No packaging types yet" hint="Add bag types in Masters." />
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
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
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
            <tbody className="divide-y divide-border font-mono">
              {packingRecords.map((r) => (
                <tr key={r.id} className="hover:bg-muted transition-colors">
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
                    <span className={r.status === "reversed" ? "px-2 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase" : r.status === "draft" ? "px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase" : "px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase"}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
              {packingRecords.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 font-sans">
                    <EmptyState
                      title="No packing entries yet"
                      hint="Log a bagging run."
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
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
                <label className="block font-medium text-foreground mb-1" htmlFor="product-seed-to-pack">Product Seed to Pack</label>
                <select id="product-seed-to-pack"
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
                <label className="block font-medium text-foreground mb-1" htmlFor="packaging-bag-type-bardana">Packaging Bag Type (Bardana)</label>
                <select id="packaging-bag-type-bardana"
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
                  <label className="block font-medium text-foreground mb-1" htmlFor="number-of-bags">Number of Bags</label>
                  <input id="number-of-bags"
                    type="number"
                    value={bagsPacked}
                    onChange={(e) => setBagsPacked(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="damaged-torn-bags">Damaged / Torn Bags</label>
                  <input id="damaged-torn-bags"
                    type="number"
                    value={damagedBags}
                    onChange={(e) => setDamagedBags(Number(e.target.value))}
                    min="0"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="packing-labor-rate-bag-pkr">Packing Labor Rate / Bag (PKR)</label>
                <input id="packing-labor-rate-bag-pkr"
                  type="number"
                  value={packingRate}
                  onChange={(e) => setPackingRate(Number(e.target.value))}
                  min="0"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="packed-weight-kg">Packed Weight (kg)</label>
                <input id="packed-weight-kg"
                  type="number"
                  value={packedKg}
                  onChange={(e) => setPackedKg(Number(e.target.value))}
                  min="0"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  required
                />
                <p className="text-[11px] text-muted-foreground mt-1">Weigh the packed output. Packing uses bardana only — seed stock is unchanged. To move seed stock, pack from a production batch in Production.</p>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Packed Weight:</span>
                  <strong className="text-foreground font-mono">{formatWeight(packedKg)}</strong>
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
        description={draftRecord ? `This packing run will pack ${draftRecord.bags_packed} bags (${formatWeight(draftRecord.total_packed_kg)}) of ${draftRecord.output_product_name || "the selected product"} and use ${draftRecord.bags_packed + (draftRecord.damaged_bags || 0)} ${draftRecord.packaging_name || "bags"}. Packing charge: ${formatCurrency(draftRecord.packing_charge)}.` : ""}
        confirmLabel="Post & Deduct Bardana"
        pending={isPending}
        onConfirm={handleConfirmPacking}
        onCancel={() => { setShowConfirm(false); setDraftRecord(null) }}
      />
    </div>
  )
}
