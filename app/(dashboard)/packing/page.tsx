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
import { listPackagingTypes, listProducts, listParties } from "@/app/actions/masters"
import { listProcessingTypes } from "@/app/actions/processing-types"
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
  const [parties, setParties] = React.useState<any[]>([])
  const [processingTypes, setProcessingTypes] = React.useState<string[]>([])

  // Modal
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftRecord, setDraftRecord] = React.useState<PackingRecord | null>(null)
  const packGuard = React.useRef(false)
  const [bardanaEntries, setBardanaEntries] = React.useState<any[]>([])
  const [bardanaTotals, setBardanaTotals] = React.useState<any | null>(null)
  const [productId, setProductId] = React.useState("")
  // Multi-line packing: one line per bag type. Batch packing still
  // writes a single line; this standalone form may write many.
  const [packingLines, setPackingLines] = React.useState<{ key: number; packagingId: string; bags: number; packedKg: number }[]>([{ key: 1, packagingId: "", bags: 100, packedKg: 0 }])
  const [damagedBags, setDamagedBags] = React.useState<number>(2)
  const [packingRate, setPackingRate] = React.useState<number>(15)
  const [partyId, setPartyId] = React.useState("")
  const [processingType, setProcessingType] = React.useState("")
  const [netWeightKg, setNetWeightKg] = React.useState<number | null>(null)
  const [processingAmount, setProcessingAmount] = React.useState<number>(0)
  // Manual fee override: null = computed bags x rate; a value here
  // replaces the computed charge and is labelled as manual.
  const [manualFee, setManualFee] = React.useState<number | null>(null)
  const [notes, setNotes] = React.useState("")
  // Treatment inputs: recorded only — they never affect stock.
  const [treatmentInputs, setTreatmentInputs] = React.useState<{ key: number; materialName: string; qty: number; unit: string; note: string }[]>([])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [pk, pr, ba, rec, pa, pt] = await Promise.all([listPackagingTypes(), listProducts(), getBardanaLedger({}), listPackingRecords(), listParties(), listProcessingTypes()])
      const failed = [pk, pr, ba, rec].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load packing data.")
      const packagingList = (Array.isArray(pk.data) ? pk.data : []) as PackagingType[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      setPackaging(packagingList)
      setParties(Array.isArray(pa.data) ? pa.data : [])
      setProcessingTypes(pt.success && Array.isArray(pt.data) ? (pt.data as any[]).map((t) => t.name).filter(Boolean) : [])
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
        party_id: r.party_id,
        party_name: r.party_name,
        processing_type: r.processing_type,
        source_product_id: r.source_product_id,
        net_weight_kg: r.net_weight_kg,
        processing_amount: r.processing_amount,
        manual_packing_fee: r.manual_packing_fee,
        packing_lines: r.packing_lines,
        treatment_inputs: r.treatment_inputs,
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
    if (packaging.length > 0 && !packingLines[0]?.packagingId) {
      setPackingLines((lines) => lines.map((l, i) => (i === 0 ? { ...l, packagingId: packaging[0].id } : l)))
    }
    if (products.length > 0 && !productId) setProductId(products[0].id)
  }, [packaging, products, packingLines, productId])

  const firstLinePkg = packaging.find((p) => p.id === packingLines[0]?.packagingId)
  const capacityKg = firstLinePkg?.capacity_kg || 50
  // Packed weight is ENTERED per line, not bags x capacity; the
  // computed charge is bags x rate summed over lines, unless the
  // operator enters a manual fee override.
  const totalBagsPacked = packingLines.reduce((s, l) => s + (Number(l.bags) || 0), 0)
  const totalPackedKg = packingLines.reduce((s, l) => s + (Number(l.packedKg) || 0), 0)
  const computedCharge = packingLines.reduce((s, l) => s + (Number(l.bags) || 0) * packingRate, 0)
  const totalCharge = manualFee !== null ? manualFee : computedCharge

  const handleRecordPacking = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §8: positive bag count, non-negative damage/rate/packed kg,
    // and the bardana stock guard — packed + damaged bags both leave
    // inventory. The server re-guards all of this before writing.
    if (!productId) return setFormError("Select the product being packed.")
    if (!packingLines.length) return setFormError("Add at least one packing line.")
    if (packingLines.some((l) => !l.packagingId)) return setFormError("Every packing line needs a bag / bardana type.")
    if (packingLines.some((l) => (Number(l.bags) || 0) < 0 || (Number(l.packedKg) || 0) < 0)) return setFormError("Bags and packed weight per line cannot be negative.")
    if (!isPositive(totalBagsPacked)) return setFormError("Bags packed must be greater than zero.")
    if (damagedBags < 0) return setFormError("Damaged bags cannot be negative.")
    if (packingRate < 0) return setFormError("Packing rate cannot be negative.")
    if (processingAmount < 0) return setFormError("Processing amount cannot be negative.")
    if (manualFee !== null && manualFee < 0) return setFormError("Manual packing fee cannot be negative.")
    // Bardana guard per bag type (damaged bags count against the
    // first line's type, matching the server), from the ledger.
    const neededByType = new Map<string, number>()
    for (const l of packingLines) {
      neededByType.set(l.packagingId, (neededByType.get(l.packagingId) ?? 0) + (Number(l.bags) || 0))
    }
    const firstType = packingLines[0]?.packagingId
    if (firstType) neededByType.set(firstType, (neededByType.get(firstType) ?? 0) + damagedBags)
    for (const [typeId, needed] of neededByType) {
      const recs = bardanaEntries.filter((r) => r.packaging_type_id === typeId)
      const last = recs[recs.length - 1]
      const pkg = packaging.find((p) => p.id === typeId)
      const closing = last ? Number(last.running_balance) : Number(pkg?.current_stock || 0)
      if (pkg && closing < needed) {
        return setFormError(`Insufficient bag stock: ${closing} ${pkg.name} bags available per the bardana ledger, but ${needed} needed. Purchase more bardana first.`)
      }
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
      packaging_type_id: firstType,
      packaging_name: firstLinePkg?.name,
      bags_packed: totalBagsPacked,
      bag_capacity_kg: capacityKg,
      total_packed_kg: totalPackedKg,
      packing_rate: packingRate,
      packing_charge: totalCharge,
      damaged_bags: damagedBags,
      status: "posted",
      notes: notes || undefined,
      created_at: new Date().toISOString(),
    } as any)
    setShowConfirm(true)
  }

  const handleConfirmPacking = async () => {
    if (!draftRecord || packGuard.current) return
    packGuard.current = true
    setIsPending(true)
    try {
      // Real write: consumes bardana (with a ledger row) and stores a
      // packing_records row with its lines. Seed stock is untouched —
      // this packs output already in stock; batch packing in
      // Production moves seed stock. Treatment inputs are recorded
      // only and never touch stock.
      const res = await createPackingRecord({
        packagingTypeId: packingLines[0]?.packagingId ?? "",
        outputProductId: productId || undefined,
        bagsPacked: totalBagsPacked,
        damagedBags,
        packingRatePerBag: packingRate,
        packedKg: totalPackedKg,
        lines: packingLines.map((l) => ({
          packagingTypeId: l.packagingId,
          bags: Number(l.bags) || 0,
          packedKg: Number(l.packedKg) || 0,
        })),
        partyId: partyId || undefined,
        processingType: processingType || undefined,
        sourceProductId: productId || undefined,
        netWeightKg: netWeightKg ?? totalPackedKg,
        processingAmount,
        manualPackingFee: manualFee,
        notes: notes || undefined,
        treatmentInputs: treatmentInputs
          .filter((t) => t.materialName.trim())
          .map((t) => ({ materialName: t.materialName, qty: Number(t.qty) || 0, unit: t.unit || "kg", note: t.note || undefined })),
      })
      if (!res.success) {
        setFormError(res.error ?? "Could not record the packing.")
        return
      }
      const row: any = res.data
      setFormNotice(`${row.packing_no ?? "Packing"} recorded — ${totalBagsPacked} bags packed, ${damagedBags} damaged, charge ${formatCurrency(totalCharge)}${manualFee !== null ? " (manual fee)" : ""}.`)
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
          <div className="expensive-card w-full max-w-xl p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="packing-party">Customer / Owner Party</label>
                  <select id="packing-party"
                    value={partyId}
                    onChange={(e) => setPartyId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="">Company (no party)</option>
                    {parties.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="packing-processing-type">Processing Type</label>
                  {processingTypes.length > 0 ? (
                    <select id="packing-processing-type"
                      value={processingTypes.includes(processingType) ? processingType : ""}
                      onChange={(e) => setProcessingType(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    >
                      <option value="">Select processing type</option>
                      {processingTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  ) : (
                    <input id="packing-processing-type"
                      type="text"
                      value={processingType}
                      onChange={(e) => setProcessingType(e.target.value)}
                      placeholder="e.g. Grading & Cleaning"
                      className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    />
                  )}
                </div>
              </div>

              {/* Packing lines: one line per bag type */}
              <div className="p-3 rounded-lg bg-muted border border-border space-y-2">
                <span className="font-bold text-foreground uppercase tracking-wider text-[10px] block">
                  Packing Lines (one per bag type)
                </span>
                {packingLines.map((line) => (
                  <div key={line.key} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`packing-bag-type-${line.key}`}>Bag Type (Bardana)</label>
                      <select id={`packing-bag-type-${line.key}`}
                        value={line.packagingId}
                        onChange={(e) => setPackingLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, packagingId: e.target.value } : l)))}
                        className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                      >
                        <option value="">Select bag type</option>
                        {packaging.map((pkg) => (
                          <option key={pkg.id} value={pkg.id}>
                            {pkg.name} ({pkg.capacity_kg}kg) - Avail: {pkg.current_stock} bags
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`packing-line-bags-${line.key}`}>Bags</label>
                      <input id={`packing-line-bags-${line.key}`}
                        type="number"
                        value={line.bags}
                        onChange={(e) => setPackingLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, bags: Number(e.target.value) } : l)))}
                        min="0"
                        className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`packing-line-kg-${line.key}`}>Packed Weight (kg)</label>
                      <div className="flex gap-2">
                        <input id={`packing-line-kg-${line.key}`}
                          type="number"
                          value={line.packedKg}
                          onChange={(e) => setPackingLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, packedKg: Number(e.target.value) } : l)))}
                          min="0"
                          className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                          required
                        />
                        {packingLines.length > 1 && (
                          <button type="button" onClick={() => setPackingLines((lines) => lines.filter((l) => l.key !== line.key))} className="px-2 rounded-md bg-muted text-muted-foreground text-xs font-bold cursor-pointer" title="Remove this packing line">✕</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setPackingLines((lines) => [...lines, { key: Date.now(), packagingId: "", bags: 0, packedKg: 0 }])} className="px-3 py-1.5 rounded-md bg-background border border-border text-foreground text-[11px] font-semibold cursor-pointer">+ Add packing line</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <label className="block font-medium text-foreground mb-1" htmlFor="packing-net-weight-kg">Net Weight (kg)</label>
                  <input id="packing-net-weight-kg"
                    type="number"
                    value={netWeightKg ?? totalPackedKg}
                    onChange={(e) => setNetWeightKg(Number(e.target.value))}
                    min="0"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="packing-processing-amount">Processing Amount (PKR)</label>
                  <input id="packing-processing-amount"
                    type="number"
                    value={processingAmount}
                    onChange={(e) => setProcessingAmount(Number(e.target.value))}
                    min="0"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="packing-manual-fee">Manual Packing Fee (PKR) — optional, overrides computed charge</label>
                <input id="packing-manual-fee"
                  type="number"
                  value={manualFee ?? ""}
                  onChange={(e) => setManualFee(e.target.value === "" ? null : Number(e.target.value))}
                  min="0"
                  placeholder={`Computed: ${formatCurrency(computedCharge)} — leave blank to use it`}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Only used when you enter a value; otherwise the charge is bags × rate.</p>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="packing-notes">Notes</label>
                <input id="packing-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Packing notes"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Weigh the packed output. Packing uses bardana only — seed stock is unchanged. To move seed stock, pack from a production batch in Production.</p>
              </div>

              {/* Treatment inputs: recorded only — does not affect stock */}
              <div className="p-3 rounded-lg bg-muted border border-border space-y-2">
                <span className="font-bold text-foreground uppercase tracking-wider text-[10px] block">
                  Treatment Inputs — recorded only, does not affect stock
                </span>
                <p className="text-[11px] text-muted-foreground">Treatment material used on this packing run. Nothing here deducts stock or writes a ledger row.</p>
                {treatmentInputs.map((t) => (
                  <div key={t.key} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`treatment-material-${t.key}`}>Material</label>
                      <input id={`treatment-material-${t.key}`} type="text" value={t.materialName}
                        onChange={(e) => setTreatmentInputs((rows) => rows.map((r) => (r.key === t.key ? { ...r, materialName: e.target.value } : r)))}
                        className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`treatment-qty-${t.key}`}>Qty</label>
                      <input id={`treatment-qty-${t.key}`} type="number" value={t.qty}
                        onChange={(e) => setTreatmentInputs((rows) => rows.map((r) => (r.key === t.key ? { ...r, qty: Number(e.target.value) } : r)))}
                        min="0" className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`treatment-unit-${t.key}`}>Unit</label>
                      <input id={`treatment-unit-${t.key}`} type="text" value={t.unit}
                        onChange={(e) => setTreatmentInputs((rows) => rows.map((r) => (r.key === t.key ? { ...r, unit: e.target.value } : r)))}
                        className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`treatment-note-${t.key}`}>Note</label>
                      <div className="flex gap-2">
                        <input id={`treatment-note-${t.key}`} type="text" value={t.note}
                          onChange={(e) => setTreatmentInputs((rows) => rows.map((r) => (r.key === t.key ? { ...r, note: e.target.value } : r)))}
                          className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground" />
                        <button type="button" onClick={() => setTreatmentInputs((rows) => rows.filter((r) => r.key !== t.key))} className="px-2 rounded-md bg-muted text-muted-foreground text-xs font-bold cursor-pointer" title="Remove this treatment input">✕</button>
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setTreatmentInputs((rows) => [...rows, { key: Date.now(), materialName: "", qty: 0, unit: "kg", note: "" }])} className="px-3 py-1.5 rounded-md bg-background border border-border text-foreground text-[11px] font-semibold cursor-pointer">+ Add treatment input</button>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Packed Weight:</span>
                  <strong className="text-foreground font-mono">{formatWeight(totalPackedKg)}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Bags Deducted:</span>
                  <strong className="text-destructive font-mono">{totalBagsPacked + damagedBags} bags</strong>
                </div>
                <div className="flex justify-between pt-1 border-t border-emerald-500/20">
                  <span className="text-muted-foreground font-bold">Labor Charge{manualFee !== null ? " (manual)" : ""}:</span>
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
