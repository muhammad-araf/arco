"use client"

import { postToken } from "@/lib/idempotency"

import * as React from "react"
import {
  ScrollText,
  Boxes,
  Play,
  Percent,
  Printer,
} from "lucide-react"
import { listBatches, getBatch, postBatch, reverseBatch, deleteBatchDraft, listRecipes, createRecipe, createRecipeVersion, getProductionInitData } from "@/app/actions/production"
import { getStockSummary } from "@/app/actions/inventory"
import { listGodowns, listProducts, listMachines, listPackagingTypes, listParties } from "@/app/actions/masters"
import { BatchSheetPrint } from "@/components/print/batch-sheet-print"
import { PrintButton } from "@/components/print/print-button"
import { ProductionBatch, Godown, Product, Machine, Recipe } from "@/lib/types/database"
import { formatWeight, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  FilterBanner,
  ReversalDialog,
  getUrlFilter,
  isTodayISO,
} from "@/components/erp-ui"
import { ProductionSkeleton } from "@/components/route-skeletons"
import { ProductionBatchDialog } from "@/components/production-batch-dialog"
import { ProductionVarianceDialog } from "@/components/production-variance-dialog"

export default function ProductionPage() {
  const [batches, setBatches] = React.useState<ProductionBatch[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [machines, setMachines] = React.useState<Machine[]>([])
  const [recipes, setRecipes] = React.useState<any[]>([])
  const [packagingTypes, setPackagingTypes] = React.useState<any[]>([])
  const [parties, setParties] = React.useState<any[]>([])
  const [summaryRows, setSummaryRows] = React.useState<any[]>([])
  const [recipeCode, setRecipeCode] = React.useState("")
  const [recipeName, setRecipeName] = React.useState("")
  const [recipeOutputId, setRecipeOutputId] = React.useState("")
  const [recipeYield, setRecipeYield] = React.useState<number>(92)
  const [recipeEffectiveFrom, setRecipeEffectiveFrom] = React.useState("")
  const [recipeItems, setRecipeItems] = React.useState<{ key: number; productId: string; ratioPct: number }[]>([{ key: 1, productId: "", ratioPct: 100 }])
  const [recipePending, setRecipePending] = React.useState(false)

  // Modal State
  const [isBatchModalOpen, setIsBatchModalOpen] = React.useState(false)
  const [selectedBatchForPrint, setSelectedBatchForPrint] = React.useState<ProductionBatch | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [recipeFieldErr, setRecipeFieldErr] = React.useState("")
  // Inline error under one field: rendered only when the latest
  // validation failure names that field (banner keeps the message too).
  const inlineErr = (key: string, current: string) =>
    current === key && formError ? (
      <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{formError}</p>
    ) : null
  const [reversalTarget, setReversalTarget] = React.useState<ProductionBatch | null>(null)
  const [isReversing, setIsReversing] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ProductionBatch | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [isPostingDraft, setIsPostingDraft] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)

  // Draft blocked by the tolerance gate: record a reason, then post.
  const [varianceTarget, setVarianceTarget] = React.useState<any | null>(null)

  // "Today" for the today-only filter, from client-side effect state (see
  // isTodayISO): never read new Date() during render.
  const [todayStr, setTodayStr] = React.useState<string | null>(null)
  React.useEffect(() => { setTodayStr(new Date().toISOString().slice(0, 10)) }, [])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const initRes = await getProductionInitData()
      if (!initRes.success) {
        setFormError(initRes.error ?? "Could not load production data.")
        return
      }
      const data = initRes.data as any
      const godownList = (Array.isArray(data.godowns) ? data.godowns : []) as Godown[]
      const productList = (Array.isArray(data.products) ? data.products : []) as Product[]
      const machineList = (Array.isArray(data.machines) ? data.machines : []) as Machine[]
      setGodowns(godownList); setProducts(productList); setMachines(machineList)
      setPackagingTypes(Array.isArray(data.packagingTypes) ? data.packagingTypes : [])
      setParties(Array.isArray(data.parties) ? data.parties : [])
      setRecipes(Array.isArray(data.recipes) ? data.recipes : [])
      setSummaryRows(Array.isArray(data.summary) ? data.summary : [])
      const bList = Array.isArray(data.batches) ? data.batches : []
      setBatches(bList.map((row: any) => ({
        ...row,
        machine_name: machineList.find((x) => x.id === row.machine_id)?.name ?? "Not set",
        godown_name: godownList.find((x) => x.id === row.godown_id)?.name ?? "Not set",
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

  // Dashboard drill-down links (?filter=today / posted) apply as the
  // initial filter on mount, matching the other list pages.
  React.useEffect(() => { setDrillFilter(getUrlFilter()) }, [])

  const handleCreateRecipe = async (e: React.FormEvent) => {
    e.preventDefault()
    if (recipePending) return
    const failRecipe = (field: string, message: string) => {
      setRecipeFieldErr(field)
      setFormError(message)
    }
    if (!recipeCode.trim() || !recipeName.trim() || !recipeOutputId) {
      if (!recipeCode.trim()) failRecipe("recipe-code", "Recipe code is required.")
      else if (!recipeName.trim()) failRecipe("recipe-name", "Recipe name is required.")
      else failRecipe("recipe-output", "Recipe output product is required.")
      return
    }
    const items = recipeItems.filter((i) => i.productId)
    if (!items.length) {
      failRecipe("recipe-items", "A recipe needs at least one input product.")
      return
    }
    const ratioSum = items.reduce((acc, i) => acc + (Number(i.ratioPct) || 0), 0)
    if (Math.abs(ratioSum - 100) > 0.01) {
      failRecipe("recipe-ratio", `Recipe input ratios must sum to 100 (got ${ratioSum}).`)
      return
    }
    setRecipeFieldErr("")
    setRecipePending(true)
    try {
      const exists = recipes.find((r) => r.code === recipeCode.trim())
      const payload = items.map((i) => ({ productId: i.productId, ratioPct: Number(i.ratioPct) || 0 }))
      const res = exists
        ? await createRecipeVersion({ code: recipeCode.trim(), name: recipeName.trim(), outputProductId: recipeOutputId, expectedYieldPct: recipeYield, effectiveFrom: recipeEffectiveFrom || undefined, items: payload })
        : await createRecipe({ code: recipeCode.trim(), name: recipeName.trim(), outputProductId: recipeOutputId, expectedYieldPct: recipeYield, effectiveFrom: recipeEffectiveFrom || undefined, items: payload })
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
      const res = await reverseBatch(reversalTarget.id, `${reasonCode}: ${reason}`, postToken("batch:reverse", reversalTarget.id))
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

  // Print from the batch's own stored lines + true status, fetched
  // fresh — never the current form state's product or a fixed badge.
  const handlePrintBatch = async (b: any) => {
    const res = await getBatch(b.id)
    if (res.success && res.data) {
      const full: any = res.data
      const inputs = (full.production_batch_inputs ?? []).map((i: any) => ({
        ...i,
        product_name: products.find((p) => p.id === i.product_id)?.name ?? "Not set",
      }))
      const outputs = (full.production_batch_outputs ?? []).map((o: any) => ({
        ...o,
        product_name: products.find((p) => p.id === o.product_id)?.name ?? o.product_id,
      }))
      setSelectedBatchForPrint({
        ...b,
        ...full,
        machine_name: machines.find((m) => m.id === full.machine_id)?.name ?? b.machine_name,
        godown_name: godowns.find((g) => g.id === full.godown_id)?.name ?? b.godown_name,
        output_product_name: products.find((p) => p.id === full.output_product_id)?.name,
        byproduct_product_name: products.find((p) => p.id === full.byproduct_product_id)?.name,
        packaging_name: packagingTypes.find((p: any) => p.id === full.packaging_type_id)?.name,
        customer_name: full.customer_id ? parties.find((p: any) => p.id === full.customer_id)?.name : undefined,
        production_batch_inputs: inputs,
        production_batch_outputs: outputs,
      })
    } else {
      setSelectedBatchForPrint(b)
    }
  }

  const handlePostDraft = async (batch: any) => {
    if (isPostingDraft) return
    setIsPostingDraft(true)
    try {
      const res = await postBatch(batch.id, postToken("batch:post", batch.id))
      if (!res.success) {
        // Tolerance gate: the draft needs a variance reason first.
        if ((res.error ?? "").includes("variance reason")) {
          setVarianceTarget(batch)
          return
        }
        setFormError(res.error ?? "Could not post the batch.")
        return
      }
      setFormNotice(`${batch.batch_no} posted.`)
      await loadData()
      await handlePrintBatch(batch)
    } finally {
      setIsPostingDraft(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return
    setIsDeleting(true)
    try {
      const res = await deleteBatchDraft(deleteTarget.id)
      if (!res.success) {
        setFormError(res.error ?? "Could not delete the draft batch.")
        return
      }
      setFormNotice(`${deleteTarget.batch_no} draft deleted.`)
      setDeleteTarget(null)
      await loadData()
    } finally {
      setIsDeleting(false)
    }
  }

  // Dialog callbacks: notice banner + register reload.
  const handleDialogSaved = (notice: string) => {
    if (notice) setFormNotice(notice)
    void loadData()
  }

  const visibleBatches = drillFilter === "today"
    ? batches.filter((b) => isTodayISO(b.date, todayStr))
    : drillFilter === "posted"
      ? batches.filter((b) => b.status === "posted")
      : batches

  if (isLoading) return <ProductionSkeleton />

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
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
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
                      <span className={b.status === "reversed" ? "px-1.5 py-0.2 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-bold uppercase" : b.status === "draft" ? "px-1.5 py-0.2 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[9px] font-bold uppercase" : "px-1.5 py-0.2 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold uppercase"}>
                        {b.status ?? "draft"}
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
                        onClick={() => handlePrintBatch(b)}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Print Production Batch Sheet"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      {b.status === "draft" && (
                        <>
                          <button
                            type="button"
                            onClick={() => handlePostDraft(b)}
                            disabled={isPostingDraft}
                            className="px-2 py-1 rounded-md hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                          >
                            Post
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(b)}
                            className="px-2 py-1 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer"
                          >
                            Delete
                          </button>
                        </>
                      )}
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

      {/* Printable Batch Run Sheet */}
      {selectedBatchForPrint && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
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
                <span className="text-gray-500 block">Customer:</span>
                <strong className="text-sm">{(selectedBatchForPrint as any).customer_name ?? "—"}</strong>
              </div>
              <div>
                <span className="text-gray-500 block">Order Ref:</span>
                <strong className="text-sm">{(selectedBatchForPrint as any).order_ref ?? "—"}</strong>
              </div>
              <div>
                <span className="text-gray-500 block">Operator:</span>
                <strong className="text-sm">{(selectedBatchForPrint as any).operator_name ?? "—"}</strong>
              </div>
              <div>
                <span className="text-gray-500 block">Calculated Yield Efficiency:</span>
                <strong className="text-sm text-emerald-700">{selectedBatchForPrint.yield_pct}%</strong>
              </div>
              <div>
                <span className="text-gray-500 block">Status:</span>
                <strong className="text-xs uppercase bg-gray-100 text-gray-800 px-2 py-0.5 rounded">{(selectedBatchForPrint as any).status ?? "draft"}</strong>
              </div>
            </div>

            {/* The batch's own input lines, fetched with the batch */}
            {((selectedBatchForPrint as any).production_batch_inputs ?? []).length > 0 && (
              <table className="w-full text-left border-collapse text-xs mt-4">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="py-2">Input Product</th>
                    <th className="py-2 text-right">Planned (kg)</th>
                    <th className="py-2 text-right">Actual (kg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {((selectedBatchForPrint as any).production_batch_inputs ?? []).map((i: any) => (
                    <tr key={i.id ?? i.product_id}>
                      <td className="py-2 font-medium">{i.product_name ?? "Not set"}</td>
                      <td className="py-2 text-right font-mono">{i.planned_qty_kg} kg</td>
                      <td className="py-2 text-right font-mono font-bold">{i.actual_qty_kg} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {((selectedBatchForPrint as any).variances ?? []).length > 0 && (
              <div className="text-xs mt-2">
                <span className="text-gray-500 block">Variances (actual − planned):</span>
                {((selectedBatchForPrint as any).variances ?? []).map((v: any) => (
                  <div key={v.product_id} className="flex justify-between">
                    <span>{products.find((p) => p.id === v.product_id)?.name ?? v.product_id}</span>
                    <strong className="font-mono">{v.qty} kg ({v.pct}%)</strong>
                  </div>
                ))}
              </div>
            )}

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
      {selectedBatchForPrint && (
        <div className="hidden print:block">
          <BatchSheetPrint
            batchNo={selectedBatchForPrint.batch_no}
            date={formatDate(selectedBatchForPrint.date)}
            status={(selectedBatchForPrint as any).status}
            recipeName={(selectedBatchForPrint as any).recipe_id ? recipes.find((r: any) => r.id === (selectedBatchForPrint as any).recipe_id)?.name : undefined}
            recipeVersion={(selectedBatchForPrint as any).recipe_version_used ?? undefined}
            customerName={(selectedBatchForPrint as any).customer_name}
            orderRef={(selectedBatchForPrint as any).order_ref}
            operator={(selectedBatchForPrint as any).operator_name}
            machine={selectedBatchForPrint.machine_name}
            godown={selectedBatchForPrint.godown_name}
            plannedSizeKg={selectedBatchForPrint.planned_size_kg}
            plannedInputs={((selectedBatchForPrint as any).production_batch_inputs ?? []).map((i: any) => ({ product: i.product_name ?? products.find((p) => p.id === i.product_id)?.name ?? "Not set", plannedQtyKg: i.planned_qty_kg, actualQtyKg: i.actual_qty_kg }))}
            actualInputs={((selectedBatchForPrint as any).production_batch_inputs ?? []).map((i: any) => ({ product: i.product_name ?? products.find((p) => p.id === i.product_id)?.name ?? "Not set", plannedQtyKg: i.planned_qty_kg, actualQtyKg: i.actual_qty_kg }))}
            outputProduct={(selectedBatchForPrint as any).output_product_name ?? products.find((p) => p.id === (selectedBatchForPrint as any).output_product_id)?.name}
            actualOutputKg={selectedBatchForPrint.actual_output_kg}
            byProductName={(selectedBatchForPrint as any).byproduct_product_name}
            byProductKg={selectedBatchForPrint.byproduct_kg}
            wasteKg={selectedBatchForPrint.waste_kg}
            yieldPct={selectedBatchForPrint.yield_pct}
            packagingConsumed={(selectedBatchForPrint as any).packaging_type_id ? [{ packagingType: (selectedBatchForPrint as any).packaging_name ?? packagingTypes.find((p: any) => p.id === (selectedBatchForPrint as any).packaging_type_id)?.name, bags: (selectedBatchForPrint as any).bags_consumed, capacityKg: packagingTypes.find((p: any) => p.id === (selectedBatchForPrint as any).packaging_type_id)?.capacity_kg }] : []}
            notes={selectedBatchForPrint.notes}
          />
        </div>
      )}
      {/* Recipes (listRecipes / createRecipe / createRecipeVersion) */}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Seed Recipes</h2>
        <p className="text-xs text-muted-foreground mb-4">Saving with an existing code creates a new version. Old versions are kept, never overwritten.</p>
        <div className="overflow-x-auto mb-4"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Code</th><th className="pb-2">Name</th><th className="pb-2">Version</th><th className="pb-2">Expected yield</th></tr></thead>
          <tbody className="divide-y divide-border">
            {recipes.length === 0 && (<tr><td colSpan={4} className="py-4"><EmptyState title="No recipes yet" hint="A recipe sets the input mix for a batch. Fill in the form below to create the first one." /></td></tr>)}
            {recipes.map((r: any) => (<tr key={r.id}><td className="py-2 font-mono">{r.code}</td><td className="py-2 font-semibold">{r.name}</td><td className="py-2">{r.version}</td><td className="py-2">{r.expected_yield_pct ?? "—"}%</td></tr>))}
          </tbody></table></div>
        <form onSubmit={handleCreateRecipe} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="code">Code *</label>{inlineErr("recipe-code", recipeFieldErr)}<input id="code" value={recipeCode} onChange={(e) => setRecipeCode(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="name">Name *</label>{inlineErr("recipe-name", recipeFieldErr)}<input id="name" value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="output-product">Output product *</label>{inlineErr("recipe-output", recipeFieldErr)}<select id="output-product" value={recipeOutputId} onChange={(e) => setRecipeOutputId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select output</option>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div>
          <div className="sm:col-span-2 lg:col-span-3 space-y-2">
            <span className="block font-medium text-foreground">Input items * (ratios must sum to 100)</span>{inlineErr("recipe-items", recipeFieldErr)}
            {recipeItems.map((item) => (
              <div key={item.key} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select value={item.productId} onChange={(e) => setRecipeItems((items) => items.map((i) => (i.key === item.key ? { ...i, productId: e.target.value } : i)))} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select input</option>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select>
                <div className="flex gap-2">
                  <input type="number" value={item.ratioPct} onChange={(e) => setRecipeItems((items) => items.map((i) => (i.key === item.key ? { ...i, ratioPct: Number(e.target.value) } : i)))} min="0" max="100" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" />
                  {recipeItems.length > 1 && (<button type="button" onClick={() => setRecipeItems((items) => items.filter((i) => i.key !== item.key))} className="px-2 rounded-lg bg-muted text-muted-foreground text-xs font-bold cursor-pointer" title="Remove this input item">✕</button>)}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setRecipeItems((items) => [...items, { key: Date.now(), productId: "", ratioPct: 0 }])} className="px-3 py-1.5 rounded-md bg-background border border-border text-foreground text-[11px] font-semibold cursor-pointer">+ Add input item</button>
              <span className="text-muted-foreground">Total: {recipeItems.reduce((s, i) => s + (Number(i.ratioPct) || 0), 0)}%</span>{inlineErr("recipe-ratio", recipeFieldErr)}
            </div>
          </div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="expected-yield">Expected yield (%)</label><input id="expected-yield" type="number" value={recipeYield} onChange={(e) => setRecipeYield(Number(e.target.value))} min="0" max="100" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="effective-from">Effective from</label><input id="effective-from" type="date" value={recipeEffectiveFrom} onChange={(e) => setRecipeEffectiveFrom(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end"><button type="submit" disabled={recipePending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{recipePending ? "Saving…" : "Save recipe / new version"}</button></div>
        </form>
      </div>
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this draft batch?"
        description={deleteTarget ? `${deleteTarget.batch_no} never posted, so deleting it changes no stock. Posted batches cannot be deleted.` : ""}
        confirmLabel="Delete Draft"
        destructive
        pending={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.batch_no ?? ""}
        note="Every stock movement this batch posted will be inverted."
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
      <ProductionBatchDialog
        open={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        godowns={godowns}
        products={products}
        machines={machines}
        recipes={recipes}
        parties={parties}
        summaryRows={summaryRows}
        batchCount={batches.length}
        setGodowns={setGodowns}
        setProducts={setProducts}
        setMachines={setMachines}
        setParties={setParties}
        onSaved={handleDialogSaved}
        onPrinted={handlePrintBatch}
      />
      <ProductionVarianceDialog
        open={varianceTarget !== null}
        target={varianceTarget}
        onClose={() => setVarianceTarget(null)}
        onSaved={handleDialogSaved}
      />
    </div>
  )
}
