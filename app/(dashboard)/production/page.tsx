"use client"

import * as React from "react"
import {
  ScrollText,
  Boxes,
  Plus,
  Play,
  CheckCircle2,
  AlertTriangle,
  Cog,
  Percent,
  Warehouse,
  Printer,
  ChevronRight,
} from "lucide-react"
import { GodownStore } from "@/lib/services/godown-store"
import { ProductionBatch, Godown, Product, Machine, Recipe } from "@/lib/types/database"
import { formatWeight, formatDate } from "@/lib/utils"
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

export default function ProductionPage() {
  const [batches, setBatches] = React.useState<ProductionBatch[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [machines, setMachines] = React.useState<Machine[]>([])

  // Modal State
  const [isBatchModalOpen, setIsBatchModalOpen] = React.useState(false)
  const [selectedBatchForPrint, setSelectedBatchForPrint] = React.useState<ProductionBatch | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showPostConfirm, setShowPostConfirm] = React.useState(false)
  const [draftBatch, setDraftBatch] = React.useState<ProductionBatch | null>(null)
  const [reversalTarget, setReversalTarget] = React.useState<ProductionBatch | null>(null)
  const [isReversing, setIsReversing] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const postGuard = React.useRef(false)

  // Batch Form State
  const [machineId, setMachineId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [inputProductId, setInputProductId] = React.useState("")
  const [outputProductId, setOutputProductId] = React.useState("")
  const [byProductId, setByProductId] = React.useState("")
  const [inputWeightKg, setInputWeightKg] = React.useState<number>(10000)
  const [outputWeightKg, setOutputWeightKg] = React.useState<number>(9200)
  const [byProductKg, setByProductKg] = React.useState<number>(550)
  const [wasteKg, setWasteKg] = React.useState<number>(250)
  const [batchNotes, setBatchNotes] = React.useState("")

  const loadData = React.useCallback(() => {
    setBatches(GodownStore.getBatches())
    setGodowns(GodownStore.getGodowns())
    setProducts(GodownStore.getProducts())
    setMachines(GodownStore.getMachines())
  }, [])

  React.useEffect(() => {
    loadData()
    setDrillFilter(getUrlFilter())
    setIsLoading(false)
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

  React.useEffect(() => {
    if (machines.length > 0 && !machineId) setMachineId(machines[0].id)
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
    const rawSeeds = products.filter((p) => p.category === "raw_seed")
    const finSeeds = products.filter((p) => p.category === "finished_seed")
    const byProds = products.filter((p) => p.category === "by_product")

    if (rawSeeds.length > 0 && !inputProductId) setInputProductId(rawSeeds[0].id)
    if (finSeeds.length > 0 && !outputProductId) setOutputProductId(finSeeds[0].id)
    if (byProds.length > 0 && !byProductId) setByProductId(byProds[0].id)
  }, [machines, godowns, products, machineId, godownId, inputProductId, outputProductId, byProductId])

  const calculatedYield = inputWeightKg > 0 ? Math.round((outputWeightKg / inputWeightKg) * 100) : 0
  const availableInputStock = inputProductId ? GodownStore.getProductStock(inputProductId, godownId) : 0

  const handlePostBatch = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §6.2/§6.4: required fields, positive input, mass balance, and
    // the stock guard — each failure names the fix, never a silent return.
    if (!machineId) return setFormError("Select the machine / cleaning plant for this batch.")
    if (!godownId) return setFormError("Select the target godown for this batch.")
    if (!inputProductId) return setFormError("Select the raw seed input product.")
    if (!outputProductId) return setFormError("Select the finished output product.")
    if (!isPositive(inputWeightKg)) return setFormError("Input weight must be greater than zero.")
    if (outputWeightKg < 0 || byProductKg < 0 || wasteKg < 0) return setFormError("Output, by-product and waste weights cannot be negative.")
    if (outputWeightKg + byProductKg + wasteKg > inputWeightKg) return setFormError(`Mass balance check failed: output (${outputWeightKg} kg) + by-product (${byProductKg} kg) + waste (${wasteKg} kg) exceeds input (${inputWeightKg} kg). Correct the weights before posting.`)
    if (inputWeightKg > availableInputStock) return setFormError(`Insufficient input stock in this godown: ${availableInputStock} kg available, but ${inputWeightKg} kg requested. Reduce the batch size or choose another godown.`)
    setFormError("")
    const selectedMachine = machines.find((m) => m.id === machineId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const batchNo = `BAT-2026-${String(batches.length + 1).padStart(3, "0")}`
    setDraftBatch({
      id: `bat-${Date.now()}`,
      batch_no: batchNo,
      date: new Date().toISOString(),
      machine_id: machineId,
      machine_name: selectedMachine?.name,
      godown_id: godownId,
      godown_name: selectedGodown?.name,
      planned_size_kg: inputWeightKg,
      actual_input_kg: inputWeightKg,
      actual_output_kg: outputWeightKg,
      byproduct_kg: byProductKg,
      waste_kg: wasteKg,
      yield_pct: calculatedYield,
      status: "posted",
      notes: batchNotes || undefined,
      created_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
    })
    setShowPostConfirm(true)
  }

  const handleConfirmPost = () => {
    if (!draftBatch || postGuard.current) return
    postGuard.current = true
    setIsPending(true)
    try {
      GodownStore.postProductionBatch(draftBatch, inputProductId, outputProductId, byProductId)
      setFormNotice(`${draftBatch.batch_no} posted — ${formatWeight(draftBatch.actual_input_kg)} input deducted, ${formatWeight(draftBatch.actual_output_kg)} output added at ${draftBatch.yield_pct}% yield.`)
      setSelectedBatchForPrint(draftBatch)
    } finally {
      setIsPending(false)
      postGuard.current = false
      setShowPostConfirm(false)
      setIsBatchModalOpen(false)
      setDraftBatch(null)
    }
  }

  // Spec §1.1: reversal never deletes. The batch keeps its row as
  // "reversed" and every ledger row it posted is inverted (consumed
  // input is restored, produced output is removed), with reason recorded.
  // Ledger rows are the source of truth here because the batch record
  // itself does not store input/output product ids.
  const handleConfirmReversal = (reasonCode: string, reason: string) => {
    if (!reversalTarget || isReversing) return
    setIsReversing(true)
    try {
      const state = (GodownStore as any).getState()
      const now = new Date().toISOString()
      const postedRows = state.stockLedger.filter((e: any) => e.voucher_id === reversalTarget.id)
      const runningByProduct: Record<string, number> = {}
      const rows = postedRows.map((e: any, idx: number) => {
        if (runningByProduct[e.product_id] === undefined) {
          runningByProduct[e.product_id] = GodownStore.getProductStock(e.product_id, reversalTarget.godown_id)
        }
        const net = (e.inward_qty || 0) - (e.outward_qty || 0)
        runningByProduct[e.product_id] -= net
        return {
          id: `stk-batrev-${Date.now()}-${idx}`,
          date: now,
          voucher_type: "adjustment",
          voucher_id: reversalTarget.id,
          voucher_no: reversalTarget.batch_no,
          godown_id: reversalTarget.godown_id,
          godown_name: reversalTarget.godown_name,
          product_id: e.product_id,
          product_name: e.product_name,
          inward_qty: e.outward_qty || 0,
          outward_qty: e.inward_qty || 0,
          unit: "kg",
          running_balance: runningByProduct[e.product_id],
          notes: `Reversal of ${reversalTarget.batch_no} [${reasonCode}]: ${reason}`,
          created_at: now,
        }
      })
      state.stockLedger = [...rows, ...state.stockLedger]
      state.batches = state.batches.map((b: ProductionBatch) =>
        b.id === reversalTarget.id
          ? { ...b, status: "reversed" as const, notes: `${b.notes ? b.notes + " | " : ""}Reversed [${reasonCode}]: ${reason}` }
          : b
      )
      ;(GodownStore as any).saveState(state)
      setFormNotice(`${reversalTarget.batch_no} reversed — posted stock movements inverted. Reason recorded: ${reasonCode}.`)
      setReversalTarget(null)
    } finally {
      setIsReversing(false)
    }
  }

  const visibleBatches = drillFilter === "today"
    ? batches.filter((b) => isTodayISO(b.date))
    : drillFilter === "posted"
      ? batches.filter((b) => b.status === "posted")
      : batches

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
            <ScrollText className="h-6 w-6 text-emerald-500" />
            Seed Recipes & Production Batches
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Execute machine runs, calculate graded seed yield %, track by-products and automatically deduct input inventory.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsBatchModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Play className="h-4 w-4" />
          <span>Execute Production Batch</span>
        </button>
      </div>

      {/* Production Batches Run History Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Boxes className="h-4 w-4 text-emerald-500" />
            Executed Processing Batches ({visibleBatches.length})
          </h2>
          <span className="text-xs text-muted-foreground">Immutable Ledger Stock Deductions & Output Additions</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Batch No</th>
                <th className="pb-3 font-bold">Date</th>
                <th className="pb-3 font-bold">Machine Plant</th>
                <th className="pb-3 font-bold">Godown</th>
                <th className="pb-3 font-bold text-right">Raw Input</th>
                <th className="pb-3 font-bold text-right">Graded Output</th>
                <th className="pb-3 font-bold text-right">By-Product</th>
                <th className="pb-3 font-bold text-center">Yield %</th>
                <th className="pb-3 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {visibleBatches.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4">
                    <EmptyState
                      title={drillFilter ? "No batches match this filter" : "No production batches yet"}
                      hint={drillFilter ? "Clear the dashboard filter above to see the full run history." : "Execute your first batch — input is deducted and graded output is added to stock on posting."}
                      actionLabel="Execute Production Batch"
                      onAction={() => setIsBatchModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
              {visibleBatches.map((b) => (
                <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 font-bold text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{b.batch_no}</span>
                      <span className={b.status === "reversed" ? "px-1.5 py-0.2 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-bold uppercase" : "px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold uppercase"}>
                        {b.status === "reversed" ? "Reversed" : "Posted"}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 text-muted-foreground">{formatDate(b.date)}</td>
                  <td className="py-3 font-medium text-foreground">{b.machine_name}</td>
                  <td className="py-3 text-muted-foreground">{b.godown_name}</td>
                  <td className="py-3 text-right font-semibold text-foreground">
                    {formatWeight(b.actual_input_kg)}
                  </td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                    {formatWeight(b.actual_output_kg)}
                  </td>
                  <td className="py-3 text-right text-muted-foreground font-mono">
                    {formatWeight(b.byproduct_kg)}
                  </td>
                  <td className="py-3 text-center">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-400 font-bold font-mono">
                      <Percent className="h-3 w-3" />
                      {b.yield_pct}%
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedBatchForPrint(b)}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Print Production Batch Sheet"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      {b.status === "posted" && (
                        <button
                          type="button"
                          onClick={() => setReversalTarget(b)}
                          className="px-2 py-1 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer"
                          title="Reverse this posted batch (requires a reason)"
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

      {/* Batch Execution Modal */}
      {isBatchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 my-8 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Play className="h-4 w-4 text-emerald-500" />
                  Execute Production / Cleaning Batch
                </h3>
                <p className="text-xs text-muted-foreground">
                  Deducts raw input grain and produces clean graded seed & by-products into inventory.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsBatchModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePostBatch} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Machine / Cleaning Plant</label>
                  <select
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.processing_type})
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
              </div>

              {/* Input Grain Selection & Stock Checker */}
              <div className="p-3 rounded-lg bg-muted/40 border border-border/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground uppercase tracking-wider text-[10px]">
                    Input Grain (Stock Deduction)
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Godown Stock: <strong className="text-foreground">{formatWeight(availableInputStock)}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">Raw Seed Product</label>
                    <select
                      value={inputProductId}
                      onChange={(e) => setInputProductId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                    >
                      {products
                        .filter((p) => p.category === "raw_seed" || p.category === "intermediate")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">Input Weight (kg)</label>
                    <input
                      type="number"
                      value={inputWeightKg}
                      onChange={(e) => setInputWeightKg(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                      min="1"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Output & By-Product Recovery */}
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-3">
                <span className="font-bold text-foreground uppercase tracking-wider text-[10px] block">
                  Graded Output & Recovery (Stock Increment)
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">Finished Output Seed</label>
                    <select
                      value={outputProductId}
                      onChange={(e) => setOutputProductId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                    >
                      {products
                        .filter((p) => p.category === "finished_seed" || p.category === "intermediate")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">Usable Output (kg)</label>
                    <input
                      type="number"
                      value={outputWeightKg}
                      onChange={(e) => setOutputWeightKg(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                      min="0"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">By-Product (Phok/Chhilka)</label>
                    <select
                      value={byProductId}
                      onChange={(e) => setByProductId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                    >
                      {products
                        .filter((p) => p.category === "by_product")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">By-Product Weight (kg)</label>
                    <input
                      type="number"
                      value={byProductKg}
                      onChange={(e) => setByProductKg(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                      min="0"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5">Process Wastage / Loss (kg)</label>
                    <input
                      type="number"
                      value={wasteKg}
                      onChange={(e) => setWasteKg(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-md bg-background border border-border">
                    <span className="text-muted-foreground">Calculated Yield:</span>
                    <strong className="text-base text-teal-600 dark:text-teal-400 font-mono">
                      {calculatedYield}%
                    </strong>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Batch Run Notes</label>
                <input
                  type="text"
                  value={batchNotes}
                  onChange={(e) => setBatchNotes(e.target.value)}
                  placeholder="Operator notes, moisture test result, screen size used"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBatchModalOpen(false)}
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
                  <span>{isPending ? "Posting…" : "Post Batch Run & Update Ledgers"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Batch Run Sheet */}
      {selectedBatchForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-4 sm:p-8 bg-white text-black shadow-2xl rounded-xl printable-document space-y-6 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <h2 className="text-xl font-extrabold tracking-tight">ARCO SEED PROCESSING PLANT</h2>
                <div className="text-xs text-gray-500">Official Production Run & Yield Certificate</div>
              </div>
              <div className="text-right">
                <div className="text-base font-mono font-bold">{selectedBatchForPrint.batch_no}</div>
                <div className="text-xs text-gray-500">{formatDate(selectedBatchForPrint.date)}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-gray-500 block">Plant Machinery:</span>
                <strong className="text-sm">{selectedBatchForPrint.machine_name}</strong>
              </div>
              <div>
                <span className="text-gray-500 block">Processing Godown:</span>
                <strong className="text-sm">{selectedBatchForPrint.godown_name}</strong>
              </div>
              <div>
                <span className="text-gray-500 block">Calculated Yield Efficiency:</span>
                <strong className="text-sm text-emerald-700">{selectedBatchForPrint.yield_pct}%</strong>
              </div>
              <div>
                <span className="text-gray-500 block">Status:</span>
                <strong className="text-xs uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">Posted</strong>
              </div>
            </div>

            {/* Reconciliation Table */}
            <table className="w-full text-left border-collapse text-xs mt-4">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="py-2">Stage Description</th>
                  <th className="py-2 text-right">Quantity (kg)</th>
                  <th className="py-2 text-right">Percentage %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="py-2 font-medium">Total Raw Input Consumed</td>
                  <td className="py-2 text-right font-mono font-bold">{selectedBatchForPrint.actual_input_kg} kg</td>
                  <td className="py-2 text-right font-mono">100%</td>
                </tr>
                <tr>
                  <td className="py-2 text-emerald-800 font-bold">Finished Graded Seed Output</td>
                  <td className="py-2 text-right font-mono font-bold text-emerald-800">{selectedBatchForPrint.actual_output_kg} kg</td>
                  <td className="py-2 text-right font-mono font-bold text-emerald-800">{selectedBatchForPrint.yield_pct}%</td>
                </tr>
                <tr>
                  <td className="py-2 text-gray-700">By-Product (Phok / Chhilka) Recovered</td>
                  <td className="py-2 text-right font-mono">{selectedBatchForPrint.byproduct_kg} kg</td>
                  <td className="py-2 text-right font-mono">
                    {Math.round((selectedBatchForPrint.byproduct_kg / selectedBatchForPrint.actual_input_kg) * 100)}%
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-gray-500">Cleaning Loss / Wastage</td>
                  <td className="py-2 text-right font-mono text-red-600">{selectedBatchForPrint.waste_kg} kg</td>
                  <td className="py-2 text-right font-mono text-red-600">
                    {Math.round((selectedBatchForPrint.waste_kg / selectedBatchForPrint.actual_input_kg) * 100)}%
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Signature Blocks */}
            <div className="grid grid-cols-2 gap-8 pt-12 text-center text-xs text-gray-500">
              <div className="border-t pt-2">Machine Plant Master</div>
              <div className="border-t pt-2">Quality & Processing Incharge</div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t no-print">
              <button
                type="button"
                onClick={() => setSelectedBatchForPrint(null)}
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
                <span>Print Certificate</span>
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showPostConfirm}
        title="Post this production batch?"
        description={draftBatch ? `${draftBatch.batch_no} will deduct ${formatWeight(draftBatch.actual_input_kg)} of input, add ${formatWeight(draftBatch.actual_output_kg)} of graded output (${draftBatch.yield_pct}% yield) and ${formatWeight(draftBatch.byproduct_kg)} of by-product. A posted batch can only be changed by reversal.` : ""}
        confirmLabel="Post Batch Run & Update Ledgers"
        pending={isPending}
        onConfirm={handleConfirmPost}
        onCancel={() => { setShowPostConfirm(false); setDraftBatch(null) }}
      />
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.batch_no ?? ""}
        note="Every stock movement this batch posted will be inverted."
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
    </div>
  )
}
