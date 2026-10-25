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
import { listBatches, createBatchDraft, postBatch, reverseBatch, listRecipes, createRecipe, createRecipeVersion } from "@/app/actions/production"
import { getStockSummary } from "@/app/actions/inventory"
import { listGodowns, listProducts, listMachines } from "@/app/actions/masters"
import { BatchSheetPrint } from "@/components/print/batch-sheet-print"
import { PrintButton } from "@/components/print/print-button"
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
  const [recipes, setRecipes] = React.useState<any[]>([])
  const [summaryRows, setSummaryRows] = React.useState<any[]>([])
  const [recipeCode, setRecipeCode] = React.useState("")
  const [recipeName, setRecipeName] = React.useState("")
  const [recipeOutputId, setRecipeOutputId] = React.useState("")
  const [recipeYield, setRecipeYield] = React.useState<number>(92)
  const [recipeInputId, setRecipeInputId] = React.useState("")
  const [recipeRatio, setRecipeRatio] = React.useState<number>(100)
  const [recipePending, setRecipePending] = React.useState(false)

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

  // "Today" for the today-only filter, from client-side effect state (see
  // isTodayISO): never read new Date() during render.
  const [todayStr, setTodayStr] = React.useState<string | null>(null)
  React.useEffect(() => { setTodayStr(new Date().toISOString().slice(0, 10)) }, [])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [b, g, pr, m, r, sm] = await Promise.all([listBatches(), listGodowns(), listProducts(), listMachines(), listRecipes(), getStockSummary()])
      const failed = [b, g, pr, m, r, sm].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load production data.")
      const godownList = (Array.isArray(g.data) ? g.data : []) as Godown[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      const machineList = (Array.isArray(m.data) ? m.data : []) as Machine[]
      setGodowns(godownList); setProducts(productList); setMachines(machineList)
      setRecipes(Array.isArray(r.data) ? r.data : [])
      setSummaryRows(Array.isArray(sm.data) ? sm.data : [])
      setBatches((Array.isArray(b.data) ? b.data : []).map((row: any) => ({
        ...row,
        machine_name: machineList.find((x) => x.id === row.machine_id)?.name ?? row.machine_id,
        godown_name: godownList.find((x) => x.id === row.godown_id)?.name ?? row.godown_id,
        output_product_name: productList.find((x) => x.id === row.output_product_id)?.name,
      })))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load production data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Mount load: without this the page never leaves its skeleton —
  // isLoading starts true and only post-action handlers reloaded before.
  React.useEffect(() => { loadData() }, [loadData])

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
  const availableInputStock = inputProductId ? summaryRows.filter((r) => r.product_id === inputProductId && r.godown_id === godownId).reduce((a, r) => a + (Number(r.balance_kg) || 0), 0) : 0

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

  const handleConfirmPost = async () => {
    if (!draftBatch || postGuard.current) return
    postGuard.current = true
    setIsPending(true)
    try {
      const created = await createBatchDraft({
        machineId, godownId, plannedSizeKg: inputWeightKg,
        inputs: [{ productId: inputProductId, actualQtyKg: inputWeightKg }],
        outputProductId, actualOutputKg: outputWeightKg,
        byproductProductId: byProductId || undefined, byproductKg: byProductKg, wasteKg,
        notes: batchNotes || undefined,
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the batch draft.")
        return
      }
      const posted = await postBatch((created.data as any).id, `batch-${Date.now()}`)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the batch.")
        return
      }
      const row: any = posted.data ?? created.data
      setFormNotice(`${row.batch_no ?? draftBatch.batch_no} posted — ${formatWeight(row.actual_input_kg ?? draftBatch.actual_input_kg)} input deducted, ${formatWeight(row.actual_output_kg ?? draftBatch.actual_output_kg)} output added at ${row.yield_pct ?? draftBatch.yield_pct}% yield.`)
      setSelectedBatchForPrint({ ...draftBatch, batch_no: row.batch_no ?? draftBatch.batch_no, status: "posted" })
      setShowPostConfirm(false)
      setIsBatchModalOpen(false)
      setDraftBatch(null)
      await loadData()
    } finally {
      setIsPending(false)
      postGuard.current = false
    }
  }

  const handleCreateRecipe = async (e: React.FormEvent) => {
    e.preventDefault()
    if (recipePending) return
    if (!recipeCode.trim() || !recipeName.trim() || !recipeOutputId || !recipeInputId) {
      setFormError("Recipe code, name, output product and at least one input product are required.")
      return
    }
    setRecipePending(true)
    try {
      const exists = recipes.find((r) => r.code === recipeCode.trim())
      const res = exists
        ? await createRecipeVersion({ code: recipeCode.trim(), name: recipeName.trim(), outputProductId: recipeOutputId, expectedYieldPct: recipeYield, items: [{ productId: recipeInputId, ratioPct: recipeRatio }] })
        : await createRecipe({ code: recipeCode.trim(), name: recipeName.trim(), outputProductId: recipeOutputId, expectedYieldPct: recipeYield, items: [{ productId: recipeInputId, ratioPct: recipeRatio }] })
      if (!res.success) {
        setFormError(res.error ?? "Could not save the recipe.")
        return
      }
      setFormNotice(exists ? `New version of recipe ${recipeCode.trim()} created.` : `Recipe ${recipeCode.trim()} created.`)
      await loadData()
    } finally {
      setRecipePending(false)
    }
  }

  // Spec §1.1: reversal never deletes. The batch keeps its row as
  // "reversed" and every ledger row it posted is inverted (consumed
  // input is restored, produced output is removed), with reason recorded.
  // Ledger rows are the source of truth here because the batch record
  // itself does not store input/output product ids.
  const handleConfirmReversal = async (reasonCode: string, reason: string) => {
    if (!reversalTarget || isReversing) return
    setIsReversing(true)
    try {
      const res = await reverseBatch(reversalTarget.id, `${reasonCode}: ${reason}`, `batch-rev-${Date.now()}`)
      if (!res.success) {
        setFormError(res.error ?? "Could not reverse the batch.")
        return
      }
      setFormNotice(`${reversalTarget.batch_no} reversed — posted stock movements inverted. Reason recorded: ${reasonCode}.`)
      setReversalTarget(null)
      await loadData()
    } finally {
      setIsReversing(false)
    }
  }

  const visibleBatches = drillFilter === "today"
    ? batches.filter((b) => isTodayISO(b.date, todayStr))
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
            Production
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setIsBatchModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Play className="h-4 w-4" />
          <span>New Batch</span>
        </button>
      </div>

      {/* Production Batches Run History Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Boxes className="h-4 w-4 text-emerald-500" />
            Batches ({visibleBatches.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
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
            <tbody className="divide-y divide-border">
              {visibleBatches.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4">
                    <EmptyState
                      title={drillFilter ? "No batches match this filter" : "No production batches yet"}
                      hint={drillFilter ? "Clear the filter to see all batches." : "Run your first batch."}
                      actionLabel="New Batch"
                      onAction={() => setIsBatchModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
              {visibleBatches.map((b) => (
                <tr key={b.id} className="hover:bg-muted transition-colors">
                  <td className="py-3 font-bold text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{b.batch_no}</span>
                      <span className={b.status === "reversed" ? "px-1.5 py-0.2 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-bold uppercase" : "px-1.5 py-0.2 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold uppercase"}>
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
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-teal-500/15 text-teal-600 dark:text-teal-400 font-bold font-mono">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-6 bg-card border border-border shadow-md rounded-md space-y-4 my-8 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
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
              <div className="p-3 rounded-lg bg-muted border border-border space-y-2">
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
                  placeholder="Notes, moisture result, screen size"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-4 sm:p-8 bg-white text-black shadow-md rounded-md printable-document space-y-6 max-h-[90dvh] overflow-y-auto">
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
              <PrintButton label="Print Certificate" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
            </div>
          </div>
        </div>
      )}
      {selectedBatchForPrint && selectedBatchForPrint.status === "posted" && (
        <div className="hidden print:block">
          <BatchSheetPrint
            batchNo={selectedBatchForPrint.batch_no}
            date={selectedBatchForPrint.date}
            machine={selectedBatchForPrint.machine_name}
            godown={selectedBatchForPrint.godown_name}
            plannedSizeKg={selectedBatchForPrint.planned_size_kg}
            actualInputs={[{ product: products.find((p) => p.id === inputProductId)?.name, actualQtyKg: selectedBatchForPrint.actual_input_kg }]}
            outputProduct={products.find((p) => p.id === outputProductId)?.name}
            actualOutputKg={selectedBatchForPrint.actual_output_kg}
            byProductKg={selectedBatchForPrint.byproduct_kg}
            wasteKg={selectedBatchForPrint.waste_kg}
          />
        </div>
      )}
      {/* Recipes (listRecipes / createRecipe / createRecipeVersion) */}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Seed Recipes</h2>
        <p className="text-xs text-muted-foreground mb-4">Saving with an existing code creates a new version. Old versions are kept, never overwritten.</p>
        <div className="overflow-x-auto mb-4"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Code</th><th className="pb-2">Name</th><th className="pb-2">Version</th><th className="pb-2">Expected yield</th></tr></thead>
          <tbody className="divide-y divide-border">
            {recipes.length === 0 && <tr><td colSpan={4} className="py-4 text-muted-foreground">No recipes yet — create the first one below.</td></tr>}
            {recipes.map((r: any) => (<tr key={r.id}><td className="py-2 font-mono">{r.code}</td><td className="py-2 font-semibold">{r.name}</td><td className="py-2">{r.version}</td><td className="py-2">{r.expected_yield_pct ?? "—"}%</td></tr>))}
          </tbody></table></div>
        <form onSubmit={handleCreateRecipe} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1">Code *</label><input value={recipeCode} onChange={(e) => setRecipeCode(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1">Name *</label><input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1">Output product *</label><select value={recipeOutputId} onChange={(e) => setRecipeOutputId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select output</option>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Input product *</label><select value={recipeInputId} onChange={(e) => setRecipeInputId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select input</option>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div>
          <div><label className="block font-medium text-foreground mb-1">Input ratio (%)</label><input type="number" value={recipeRatio} onChange={(e) => setRecipeRatio(Number(e.target.value))} min="0" max="100" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1">Expected yield (%)</label><input type="number" value={recipeYield} onChange={(e) => setRecipeYield(Number(e.target.value))} min="0" max="100" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end"><button type="submit" disabled={recipePending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{recipePending ? "Saving…" : "Save recipe / new version"}</button></div>
        </form>
      </div>
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
