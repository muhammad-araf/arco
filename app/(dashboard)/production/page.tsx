"use client"

import Link from "next/link"
import { postToken } from "@/lib/idempotency"

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
import { listBatches, getBatch, createBatchDraft, postBatch, reverseBatch, deleteBatchDraft, listRecipes, createRecipe, createRecipeVersion, setBatchVarianceReason } from "@/app/actions/production"
import { getStockSummary } from "@/app/actions/inventory"
import { listGodowns, listProducts, listMachines, listPackagingTypes, listParties, createParty, createGodown, createProduct, createMachine } from "@/app/actions/masters"
import { InlineAdd, PARTY_FIELDS, GODOWN_FIELDS, PRODUCT_FIELDS, MACHINE_FIELDS } from "@/components/print/inline-add"
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
  SubmitSpinner,
  getUrlFilter,
  isPositive,
  isTodayISO,
} from "@/components/erp-ui"
import { ProductionSkeleton } from "@/components/route-skeletons"

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
  const [isPending, setIsPending] = React.useState(false)
  const [showPostConfirm, setShowPostConfirm] = React.useState(false)
  const [draftBatch, setDraftBatch] = React.useState<ProductionBatch | null>(null)
  const [reversalTarget, setReversalTarget] = React.useState<ProductionBatch | null>(null)
  const [isReversing, setIsReversing] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<ProductionBatch | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [isPostingDraft, setIsPostingDraft] = React.useState(false)
  const [drillFilter, setDrillFilter] = React.useState<string | null>(null)
  const postGuard = React.useRef(false)

  // Batch Form State
  const [machineId, setMachineId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [recipeId, setRecipeId] = React.useState("")
  const [inputLines, setInputLines] = React.useState<{ key: number; productId: string; qty: number }[]>([{ key: 1, productId: "", qty: 10000 }])
  const [outputProductId, setOutputProductId] = React.useState("")
  const [byProductId, setByProductId] = React.useState("")
  const [outputWeightKg, setOutputWeightKg] = React.useState<number>(9200)
  const [byProductKg, setByProductKg] = React.useState<number>(550)
  const [wasteKg, setWasteKg] = React.useState<number>(250)
  const [packagingTypeId, setPackagingTypeId] = React.useState("")
  const [bagsConsumed, setBagsConsumed] = React.useState<number>(0)
  const [packingRatePerBag, setPackingRatePerBag] = React.useState<number>(0)
  const [damagedBags, setDamagedBags] = React.useState<number>(0)
  const [batchNotes, setBatchNotes] = React.useState("")
  // Batch customer / order / operator (shown on the batch sheet) and
  // the owner pool the availability pre-check scopes to.
  const [batchCustomerId, setBatchCustomerId] = React.useState("")
  const [batchOrderRef, setBatchOrderRef] = React.useState("")
  const [batchOperatorName, setBatchOperatorName] = React.useState("")
  const [isCustomerOwned, setIsCustomerOwned] = React.useState(false)
  const [batchOwnerPartyId, setBatchOwnerPartyId] = React.useState("")
  const [varianceReason, setVarianceReason] = React.useState("")
  // Draft blocked by the tolerance gate: record a reason, then post.
  const [varianceTarget, setVarianceTarget] = React.useState<any | null>(null)
  const [varianceReasonText, setVarianceReasonText] = React.useState("")
  const [isPostingWithReason, setIsPostingWithReason] = React.useState(false)

  // "Today" for the today-only filter, from client-side effect state (see
  // isTodayISO): never read new Date() during render.
  const [todayStr, setTodayStr] = React.useState<string | null>(null)
  React.useEffect(() => { setTodayStr(new Date().toISOString().slice(0, 10)) }, [])

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [b, g, pr, m, r, sm, pk, pa] = await Promise.all([listBatches(), listGodowns(), listProducts(), listMachines(), listRecipes(), getStockSummary(), listPackagingTypes(), listParties()])
      const failed = [b, g, pr, m, r, sm, pk].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load production data.")
      const godownList = (Array.isArray(g.data) ? g.data : []) as Godown[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      const machineList = (Array.isArray(m.data) ? m.data : []) as Machine[]
      setGodowns(godownList); setProducts(productList); setMachines(machineList)
      setPackagingTypes(Array.isArray(pk.data) ? pk.data : [])
      setParties(Array.isArray(pa.data) ? pa.data : [])
      setRecipes(Array.isArray(r.data) ? r.data : [])
      setSummaryRows(Array.isArray(sm.data) ? sm.data : [])
      setBatches((Array.isArray(b.data) ? b.data : []).map((row: any) => ({
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

  React.useEffect(() => {
    if (machines.length > 0 && !machineId) setMachineId(machines[0].id)
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
    const rawSeeds = products.filter((p) => p.category === "raw_seed")
    const finSeeds = products.filter((p) => p.category === "finished_seed")
    const byProds = products.filter((p) => p.category === "by_product")

    if (rawSeeds.length > 0 && !inputLines[0]?.productId) {
      setInputLines((lines) => lines.map((l, i) => (i === 0 ? { ...l, productId: rawSeeds[0].id } : l)))
    }
    if (finSeeds.length > 0 && !outputProductId) setOutputProductId(finSeeds[0].id)
    if (byProds.length > 0 && !byProductId) setByProductId(byProds[0].id)
  }, [machines, godowns, products, machineId, godownId, inputLines, outputProductId, byProductId])

  const totalInputKg = inputLines.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const calculatedYield = totalInputKg > 0 ? Math.round((outputWeightKg / totalInputKg) * 100) : 0
  // Availability pre-check, scoped by OWNER POOL like the server guard:
  // a customer-owned batch checks only that owner's pool, a company
  // batch only the company (NULL-party) pool — never all pools summed.
  const effectiveOwnerPartyId = isCustomerOwned ? (batchOwnerPartyId || batchCustomerId || null) : null
  const stockForProduct = (productId: string) => summaryRows
    .filter((r) => r.product_id === productId && r.godown_id === godownId && (r.party_id ?? null) === effectiveOwnerPartyId)
    .reduce((a, r) => a + (Number(r.balance_kg) || 0), 0)

  // Picking a recipe pins it to the batch and fills the input lines
  // from its items, scaled to the current total input (0 until the
  // user enters quantities). The server records recipe_id + the
  // version that was active when the draft was created.
  const handleRecipeSelect = (id: string) => {
    setRecipeId(id)
    if (!id) return
    const recipe = recipes.find((r: any) => r.id === id)
    if (!recipe) return
    if (recipe.output_product_id) setOutputProductId(recipe.output_product_id)
    const items = (recipe.recipe_items ?? []) as { product_id: string; required_ratio_pct: number }[]
    if (items.length) {
      setInputLines(items.map((item, i) => ({
        key: Date.now() + i,
        productId: item.product_id,
        qty: totalInputKg > 0 ? Math.round((totalInputKg * Number(item.required_ratio_pct)) / 100) : 0,
      })))
    }
  }

  const handlePostBatch = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §6.2/§6.4: required fields, positive input, mass balance, and
    // the stock guard — each failure names the fix, never a silent return.
    if (!machineId) return setFormError("Select the machine / cleaning plant for this batch.")
    if (!godownId) return setFormError("Select the target godown for this batch.")
    if (!inputLines.length) return setFormError("Add at least one input line.")
    if (inputLines.some((l) => !l.productId)) return setFormError("Every input line needs a product.")
    if (inputLines.some((l) => (Number(l.qty) || 0) < 0)) return setFormError("Input quantities cannot be negative.")
    if (!outputProductId) return setFormError("Select the finished output product.")
    if (!isPositive(totalInputKg)) return setFormError("Input weight must be greater than zero.")
    if (outputWeightKg < 0 || byProductKg < 0 || wasteKg < 0) return setFormError("Output, by-product and waste weights cannot be negative.")
    if (outputWeightKg + byProductKg + wasteKg > totalInputKg) return setFormError(`Mass balance check failed: output (${outputWeightKg} kg) + by-product (${byProductKg} kg) + waste (${wasteKg} kg) exceeds input (${totalInputKg} kg). Correct the weights before posting.`)
    if (bagsConsumed < 0 || packingRatePerBag < 0 || damagedBags < 0) return setFormError("Bags consumed, packing rate and damaged bags cannot be negative.")
    // Client pre-check, aggregated per product and scoped to the
    // owner pool (the server re-guards the same pool).
    const aggregated = new Map<string, number>()
    for (const l of inputLines) aggregated.set(l.productId, (aggregated.get(l.productId) ?? 0) + (Number(l.qty) || 0))
    for (const [productId, qty] of aggregated) {
      const available = stockForProduct(productId)
      if (qty > available) {
        const name = products.find((p) => p.id === productId)?.name ?? productId
        const pool = isCustomerOwned ? "for this owner" : "in company stock"
        return setFormError(`Insufficient input stock in this godown ${pool}: ${available} kg of ${name} available, but ${qty} kg requested. Reduce the batch size or choose another godown.`)
      }
    }
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
      planned_size_kg: totalInputKg,
      actual_input_kg: totalInputKg,
      actual_output_kg: outputWeightKg,
      byproduct_kg: byProductKg,
      waste_kg: wasteKg,
      yield_pct: calculatedYield,
      status: "draft",
      notes: batchNotes || undefined,
      created_at: new Date().toISOString(),
    })
    setShowPostConfirm(true)
  }

  const handleConfirmPost = async () => {
    if (!draftBatch || postGuard.current) return
    postGuard.current = true
    setIsPending(true)
    try {
      const created = await createBatchDraft({
        recipeId: recipeId || undefined,
        machineId, godownId, plannedSizeKg: totalInputKg,
        inputs: inputLines.map((l) => ({ productId: l.productId, actualQtyKg: Number(l.qty) || 0 })),
        outputProductId, actualOutputKg: outputWeightKg,
        byproductProductId: byProductId || undefined, byproductKg: byProductKg, wasteKg,
        packagingTypeId: packagingTypeId || undefined, bagsConsumed, packingRatePerBag, damagedBags,
        notes: batchNotes || undefined,
        isCustomerOwned, ownerPartyId: effectiveOwnerPartyId ?? undefined,
        customerId: batchCustomerId || undefined, orderRef: batchOrderRef || undefined,
        operatorName: batchOperatorName || undefined, varianceReason: varianceReason || undefined,
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the batch draft.")
        return
      }
      const posted = await postBatch((created.data as any).id, postToken("batch:post", (created.data as any).id))
      if (!posted.success) {
        // The draft stays in the list as Draft, with Post / Delete
        // actions — it is not lost, and it is not shown as posted.
        setFormError(posted.error ?? "Could not post the batch. The draft is kept below — post it again or delete it.")
        await loadData()
        return
      }
      const row: any = posted.data ?? created.data
      setFormNotice(`${row.batch_no ?? draftBatch.batch_no} posted — ${formatWeight(row.actual_input_kg ?? draftBatch.actual_input_kg)} input deducted, ${formatWeight(row.actual_output_kg ?? draftBatch.actual_output_kg)} output added at ${row.yield_pct ?? draftBatch.yield_pct}% yield.`)
      setShowPostConfirm(false)
      setIsBatchModalOpen(false)
      setDraftBatch(null)
      await loadData()
      // Print from the batch's own stored lines, not form state.
      await handlePrintBatch({ id: row.id ?? (created.data as any).id, batch_no: row.batch_no ?? draftBatch.batch_no })
    } finally {
      setIsPending(false)
      postGuard.current = false
    }
  }

  const handleCreateRecipe = async (e: React.FormEvent) => {
    e.preventDefault()
    if (recipePending) return
    if (!recipeCode.trim() || !recipeName.trim() || !recipeOutputId) {
      setFormError("Recipe code, name and output product are required.")
      return
    }
    const items = recipeItems.filter((i) => i.productId)
    if (!items.length) {
      setFormError("A recipe needs at least one input product.")
      return
    }
    const ratioSum = items.reduce((s, i) => s + (Number(i.ratioPct) || 0), 0)
    if (Math.abs(ratioSum - 100) > 0.01) {
      setFormError(`Recipe input ratios must sum to 100 (got ${ratioSum}).`)
      return
    }
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
          setVarianceReasonText("")
          return
        }
        setFormError(res.error ?? "Could not post the batch.")
        return
      }
      setFormNotice(`${batch.batch_no} posted.`)
      await loadData()
    } finally {
      setIsPostingDraft(false)
    }
  }

  const handlePostWithVarianceReason = async () => {
    if (!varianceTarget || isPostingWithReason) return
    if (!varianceReasonText.trim()) {
      setFormError("Enter a variance reason before posting this batch.")
      return
    }
    setIsPostingWithReason(true)
    try {
      const saved = await setBatchVarianceReason(varianceTarget.id, varianceReasonText.trim())
      if (!saved.success) {
        setFormError(saved.error ?? "Could not save the variance reason.")
        return
      }
      const res = await postBatch(varianceTarget.id, postToken("batch:post", varianceTarget.id))
      if (!res.success) {
        setFormError(res.error ?? "Could not post the batch.")
        return
      }
      setFormNotice(`${varianceTarget.batch_no} posted.`)
      setVarianceTarget(null)
      await loadData()
    } finally {
      setIsPostingWithReason(false)
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
                  <label className="block font-medium text-foreground mb-1" htmlFor="machine-cleaning-plant">Machine / Cleaning Plant</label>
                  <div className="flex flex-wrap items-start gap-2"><select id="machine-cleaning-plant"
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.processing_type})
                      </option>
                    ))}
                  </select> <InlineAdd label="Machine" fields={MACHINE_FIELDS} createAction={async (v) => createMachine({ code: v.code, name: v.name, processing_type: v.processing_type })} onCreated={async (id) => { const r = await listMachines(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setMachines(list); } setMachineId(id); }} /></div>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="target-godown">Target Godown</label>
                  <div className="flex flex-wrap items-start gap-2"><select id="target-godown"
                    value={godownId}
                    onChange={(e) => setGodownId(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {godowns.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select> <InlineAdd label="Godown" fields={GODOWN_FIELDS} createAction={async (v) => createGodown({ code: v.code, name: v.name })} onCreated={async (id) => { const r = await listGodowns(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setGodowns(list); } setGodownId(id); }} /></div>
                </div>
              </div>

              {/* Customer / order / operator: shown on the batch sheet */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="batch-customer">Customer</label>
                  <div className="flex flex-wrap items-start gap-2"><select id="batch-customer"
                    value={batchCustomerId}
                    onChange={(e) => setBatchCustomerId(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="">No customer — company batch</option>
                    {parties.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select> <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "customer" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setParties(list); } setBatchCustomerId(id); }} /></div>
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="batch-order-ref">Order Ref</label>
                  <input id="batch-order-ref"
                    type="text"
                    value={batchOrderRef}
                    onChange={(e) => setBatchOrderRef(e.target.value)}
                    placeholder="Customer order reference"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="batch-operator">Operator</label>
                  <input id="batch-operator"
                    type="text"
                    value={batchOperatorName}
                    onChange={(e) => setBatchOperatorName(e.target.value)}
                    placeholder="Operator who runs this batch"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="batch-ownership">Stock Owner Pool</label>
                  <select id="batch-ownership"
                    value={isCustomerOwned ? "customer" : "company"}
                    onChange={(e) => setIsCustomerOwned(e.target.value === "customer")}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="company">Company stock</option>
                    <option value="customer">Customer-owned stock</option>
                  </select>
                </div>
                {isCustomerOwned && (
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-foreground mb-1" htmlFor="batch-owner-party">Owner Party (stock pool)</label>
                    <div className="flex flex-wrap items-start gap-2"><select id="batch-owner-party"
                      value={batchOwnerPartyId}
                      onChange={(e) => setBatchOwnerPartyId(e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    >
                      <option value="">Use the customer above as owner</option>
                      {parties.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select> <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "customer" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setParties(list); } setBatchOwnerPartyId(id); }} /></div>
                  </div>
                )}
              </div>

              {/* Recipe (optional): pins recipe + version to the batch */}
              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="recipe-optional">Recipe (optional)</label>
                <select id="recipe-optional"
                  value={recipeId}
                  onChange={(e) => handleRecipeSelect(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                >
                  <option value="">No recipe — enter inputs by hand</option>
                  {recipes.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.code} v{r.version} — {r.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Input Grain Selection & Stock Checker */}
              <div className="p-3 rounded-lg bg-muted border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground uppercase tracking-wider text-[10px]">
                    Input Grain (Stock Deduction)
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Total Input: <strong className="text-foreground">{formatWeight(totalInputKg)}</strong>
                  </span>
                </div>

                {inputLines.map((line, idx) => (
                  <div key={line.key} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`raw-seed-product-${line.key}`}>Raw Seed Product</label>
                      <div className="flex flex-wrap items-start gap-2"><select id={`raw-seed-product-${line.key}`}
                        value={line.productId}
                        onChange={(e) => setInputLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, productId: e.target.value } : l)))}
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                      >
                        <option value="">Select product</option>
                        {products
                          .filter((p) => p.category === "raw_seed" || p.category === "intermediate")
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select> <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } setInputLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, productId: id } : l))); }} /></div>
                    </div>

                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`production-input-weight-kg-${line.key}`}>Input Weight (kg){line.productId ? ` — in godown: ${formatWeight(stockForProduct(line.productId))}` : ""}</label>
                      <div className="flex gap-2">
                        <input id={`production-input-weight-kg-${line.key}`}
                          type="number"
                          value={line.qty}
                          onChange={(e) => setInputLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, qty: Number(e.target.value) } : l)))}
                          className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                          min="0"
                          required
                        />
                        {inputLines.length > 1 && (
                          <button type="button" onClick={() => setInputLines((lines) => lines.filter((l) => l.key !== line.key))} className="px-2 rounded-md bg-muted text-muted-foreground text-xs font-bold cursor-pointer" title="Remove this input line">✕</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setInputLines((lines) => [...lines, { key: Date.now(), productId: "", qty: 0 }])} className="px-3 py-1.5 rounded-md bg-background border border-border text-foreground text-[11px] font-semibold cursor-pointer">+ Add input line</button>
              </div>

              {/* Output & By-Product Recovery */}
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-3">
                <span className="font-bold text-foreground uppercase tracking-wider text-[10px] block">
                  Graded Output & Recovery (Stock Increment)
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor="finished-output-seed">Finished Output Seed</label>
                    <div className="flex flex-wrap items-start gap-2"><select id="finished-output-seed"
                      value={outputProductId}
                      onChange={(e) => setOutputProductId(e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                    >
                      {products
                        .filter((p) => p.category === "finished_seed" || p.category === "intermediate")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select> <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } setOutputProductId(id); }} /></div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor="usable-output-kg">Usable Output (kg)</label>
                    <input id="usable-output-kg"
                      type="number"
                      value={outputWeightKg}
                      onChange={(e) => setOutputWeightKg(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono"
                      min="0"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor="by-product-phok-chhilka">By-Product (Phok/Chhilka)</label>
                    <div className="flex flex-wrap items-start gap-2"><select id="by-product-phok-chhilka"
                      value={byProductId}
                      onChange={(e) => setByProductId(e.target.value)}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                    >
                      {products
                        .filter((p) => p.category === "by_product")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select> <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } setByProductId(id); }} /></div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor="by-product-weight-kg">By-Product Weight (kg)</label>
                    <input id="by-product-weight-kg"
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
                    <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor="process-wastage-loss-kg">Process Wastage / Loss (kg)</label>
                    <input id="process-wastage-loss-kg"
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

              {/* Batch packing moved to the Packing page: pack a
                  batch's output there instead of inside this form. */}
              <div className="p-3 rounded-lg bg-muted border border-border space-y-2">
                <span className="font-bold text-foreground uppercase tracking-wider text-[10px] block">
                  Packaging (Bardana)
                </span>
                <p className="text-xs text-muted-foreground">
                  Batch packing now lives on the Packing page, with the
                  batch&apos;s output, bag type, bags, rate and damaged
                  bags in one place.
                </p>
                <Link href="/packing?tab=batch-packing" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer">
                  Pack this batch&apos;s output
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="batch-variance-reason">Variance Reason</label>
                <input id="batch-variance-reason"
                  type="text"
                  value={varianceReason}
                  onChange={(e) => setVarianceReason(e.target.value)}
                  placeholder="Required before posting when an input variance exceeds the configured tolerance"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="batch-run-notes">Batch Run Notes</label>
                <input id="batch-run-notes"
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
            date={selectedBatchForPrint.date}
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
            {recipes.length === 0 && <tr><td colSpan={4} className="py-4 text-muted-foreground">No recipes yet — create the first one below.</td></tr>}
            {recipes.map((r: any) => (<tr key={r.id}><td className="py-2 font-mono">{r.code}</td><td className="py-2 font-semibold">{r.name}</td><td className="py-2">{r.version}</td><td className="py-2">{r.expected_yield_pct ?? "—"}%</td></tr>))}
          </tbody></table></div>
        <form onSubmit={handleCreateRecipe} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="code">Code *</label><input id="code" value={recipeCode} onChange={(e) => setRecipeCode(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="name">Name *</label><input id="name" value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="output-product">Output product *</label><select id="output-product" value={recipeOutputId} onChange={(e) => setRecipeOutputId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="">Select output</option>{products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div>
          <div className="sm:col-span-2 lg:col-span-3 space-y-2">
            <span className="block font-medium text-foreground">Input items (ratios must sum to 100)</span>
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
              <span className="text-muted-foreground">Total: {recipeItems.reduce((s, i) => s + (Number(i.ratioPct) || 0), 0)}%</span>
            </div>
          </div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="expected-yield">Expected yield (%)</label><input id="expected-yield" type="number" value={recipeYield} onChange={(e) => setRecipeYield(Number(e.target.value))} min="0" max="100" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          <div><label className="block font-medium text-foreground mb-1" htmlFor="effective-from">Effective from</label><input id="effective-from" type="date" value={recipeEffectiveFrom} onChange={(e) => setRecipeEffectiveFrom(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
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
      {/* Variance reason for a draft blocked by the tolerance gate */}
      {varianceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4">
            <h3 className="text-sm font-bold text-foreground">Variance reason required</h3>
            <p className="text-xs text-muted-foreground">
              {varianceTarget.batch_no} cannot be posted: an input variance exceeds the configured tolerance. Record the reason, then post again.
            </p>
            <div>
              <label className="block font-medium text-foreground mb-1 text-xs" htmlFor="draft-variance-reason">Variance reason</label>
              <input id="draft-variance-reason"
                type="text"
                value={varianceReasonText}
                onChange={(e) => setVarianceReasonText(e.target.value)}
                placeholder="Why the input varied from plan"
                className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground text-xs"
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={() => setVarianceTarget(null)} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Cancel</button>
              <button type="button" onClick={handlePostWithVarianceReason} disabled={isPostingWithReason} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60">
                {isPostingWithReason ? <SubmitSpinner /> : null}
                <span>{isPostingWithReason ? "Posting…" : "Save Reason & Post"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
