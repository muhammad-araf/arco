"use client"

/**
 * Production batch dialog on the shared Modal kit (POS pattern: the
 * dialog owns its form state; the page keeps only the register and
 * the inline recipe form).
 *
 * Moved verbatim from the Production page's hand-rolled batch modal:
 * same fields, same validation (including the mass-balance and
 * owner-pool stock pre-checks), same createBatchDraft / postBatch
 * payload, same draft → post-confirm → batch-sheet print flow. The
 * only intentional changes are the ones the shared kit requires: the
 * form resets on a fresh open (it used to keep typed values across
 * closes), and errors show in the dialog's own banner.
 *
 * Note: the packaging fields (packagingTypeId, bagsConsumed,
 * packingRatePerBag, damagedBags) still travel in the draft payload
 * exactly as before, although the dialog shows no inputs for them —
 * batch packing lives on the Packing page. That pre-existing gap is
 * left as-is, not invented around.
 */
import Link from "next/link"
import * as React from "react"
import { CheckCircle2, ChevronRight } from "lucide-react"
import { postToken } from "@/lib/idempotency"
import { createBatchDraft, postBatch } from "@/app/actions/production"
import { listGodowns, listProducts, listMachines, listParties, createParty, createGodown, createProduct, createMachine } from "@/app/actions/masters"
import { InlineAdd, PARTY_FIELDS, GODOWN_FIELDS, PRODUCT_FIELDS, MACHINE_FIELDS } from "@/components/print/inline-add"
import type { ProductionBatch, Godown, Product, Machine } from "@/lib/types/database"
import { formatWeight } from "@/lib/utils"
import { lineSharePct } from "@/lib/dialog-calcs"
import { AlertBanner, ConfirmDialog, SubmitSpinner, isPositive } from "@/components/erp-ui"
import { Modal, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/erp-form"

export function ProductionBatchDialog({
  open,
  onClose,
  godowns,
  products,
  machines,
  recipes,
  parties,
  summaryRows,
  batchCount,
  setGodowns,
  setProducts,
  setMachines,
  setParties,
  onSaved,
  onPrinted,
}: {
  open: boolean
  onClose: () => void
  godowns: Godown[]
  products: Product[]
  machines: Machine[]
  recipes: any[]
  parties: any[]
  summaryRows: any[]
  /** Register length, used only for the pre-post batch-number preview
   *  (the server assigns the real number, as before). */
  batchCount: number
  setGodowns: (g: Godown[]) => void
  setProducts: (p: Product[]) => void
  setMachines: (m: Machine[]) => void
  setParties: (p: any[]) => void
  /** Page sets the notice banner and reloads the register. */
  onSaved: (notice: string) => Promise<void> | void
  /** Page shows the batch sheet for this posted batch. */
  onPrinted: (b: { id: string; batch_no: string }) => Promise<void> | void
}) {
  const [machineId, setMachineId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [recipeId, setRecipeId] = React.useState("")
  const [inputLines, setInputLines] = React.useState<{ key: number; productId: string; qty: number }[]>([{ key: 1, productId: "", qty: 10000 }])
  const [outputProductId, setOutputProductId] = React.useState("")
  const [byProductId, setByProductId] = React.useState("")
  const [outputWeightKg, setOutputWeightKg] = React.useState<number>(9200)
  const [byProductKg, setByProductKg] = React.useState<number>(550)
  const [wasteKg, setWasteKg] = React.useState<number>(250)
  const [packagingTypeId] = React.useState("")
  const [bagsConsumed] = React.useState<number>(0)
  const [packingRatePerBag] = React.useState<number>(0)
  const [damagedBags] = React.useState<number>(0)
  const [batchNotes, setBatchNotes] = React.useState("")
  const [batchCustomerId, setBatchCustomerId] = React.useState("")
  const [batchOrderRef, setBatchOrderRef] = React.useState("")
  const [batchOperatorName, setBatchOperatorName] = React.useState("")
  const [isCustomerOwned, setIsCustomerOwned] = React.useState(false)
  const [batchOwnerPartyId, setBatchOwnerPartyId] = React.useState("")
  const [varianceReason, setVarianceReason] = React.useState("")
  const [error, setError] = React.useState("")
  const [batchFieldErr, setBatchFieldErr] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showPostConfirm, setShowPostConfirm] = React.useState(false)
  const [draftBatch, setDraftBatch] = React.useState<ProductionBatch | null>(null)
  const postGuard = React.useRef(false)

  React.useEffect(() => {
    if (!open) return
    const rawSeeds = products.filter((p) => p.category === "raw_seed")
    const finSeeds = products.filter((p) => p.category === "finished_seed")
    const byProds = products.filter((p) => p.category === "by_product")
    setMachineId(machines[0]?.id ?? "")
    setGodownId(godowns[0]?.id ?? "")
    setRecipeId("")
    setInputLines([{ key: 1, productId: rawSeeds[0]?.id ?? "", qty: 10000 }])
    setOutputProductId(finSeeds[0]?.id ?? "")
    setByProductId(byProds[0]?.id ?? "")
    setOutputWeightKg(9200)
    setByProductKg(550)
    setWasteKg(250)
    setBatchNotes("")
    setBatchCustomerId("")
    setBatchOrderRef("")
    setBatchOperatorName("")
    setIsCustomerOwned(false)
    setBatchOwnerPartyId("")
    setVarianceReason("")
    setError("")
    setBatchFieldErr("")
    setIsPending(false)
    setShowPostConfirm(false)
    setDraftBatch(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const inlineErr = (key: string, current: string) =>
    current === key && error ? (
      <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{error}</p>
    ) : null

  const totalInputKg = inputLines.reduce((s, l) => s + (Number(l.qty) || 0), 0)
  const calculatedYield = totalInputKg > 0 ? Math.round((outputWeightKg / totalInputKg) * 100) : 0
  const effectiveOwnerPartyId = isCustomerOwned ? (batchOwnerPartyId || batchCustomerId || null) : null
  const stockForProduct = (productId: string) =>
    summaryRows
      .filter((r) => r.product_id === productId && r.godown_id === godownId && (r.party_id ?? null) === effectiveOwnerPartyId)
      .reduce((a, r) => a + (Number(r.balance_kg) || 0), 0)

  const handleRecipeSelect = (id: string) => {
    setRecipeId(id)
    if (!id) return
    const recipe = recipes.find((r: any) => r.id === id)
    if (!recipe) return
    if (recipe.output_product_id) setOutputProductId(recipe.output_product_id)
    const items = (recipe.recipe_items ?? []) as { product_id: string; required_ratio_pct: number }[]
    if (items.length) {
      setInputLines(
        items.map((item, i) => ({
          key: Date.now() + i,
          productId: item.product_id,
          qty: totalInputKg > 0 ? Math.round((totalInputKg * Number(item.required_ratio_pct)) / 100) : 0,
        })),
      )
    }
  }

  const validateBatchForm = (): { field: string; message: string } | null => {
    if (!machineId) return { field: "machine", message: "Select the machine / cleaning plant for this batch." }
    if (!godownId) return { field: "godown", message: "Select the target godown for this batch." }
    if (!inputLines.length) return { field: "inputs", message: "Add at least one input line." }
    const badProduct = inputLines.find((l) => !l.productId)
    if (badProduct) return { field: `input-product-${badProduct.key}`, message: "Every input line needs a product." }
    const badQty = inputLines.find((l) => (Number(l.qty) || 0) < 0)
    if (badQty) return { field: `input-qty-${badQty.key}`, message: "Input quantities cannot be negative." }
    if (!outputProductId) return { field: "output-product", message: "Select the finished output product." }
    if (!isPositive(totalInputKg)) return { field: "total-input", message: "Input weight must be greater than zero." }
    if (outputWeightKg < 0 || byProductKg < 0 || wasteKg < 0) return { field: "output", message: "Output, by-product and waste weights cannot be negative." }
    if (outputWeightKg + byProductKg + wasteKg > totalInputKg)
      return { field: "output", message: `Mass balance check failed: output (${outputWeightKg} kg) + by-product (${byProductKg} kg) + waste (${wasteKg} kg) exceeds input (${totalInputKg} kg). Correct the weights before posting.` }
    if (bagsConsumed < 0 || packingRatePerBag < 0 || damagedBags < 0) return { field: "output", message: "Bags consumed, packing rate and damaged bags cannot be negative." }
    const aggregated = new Map<string, number>()
    for (const l of inputLines) aggregated.set(l.productId, (aggregated.get(l.productId) ?? 0) + (Number(l.qty) || 0))
    for (const [productId, qty] of aggregated) {
      const available = stockForProduct(productId)
      if (qty > available) {
        const name = products.find((x) => x.id === productId)?.name ?? productId
        const pool = isCustomerOwned ? "for this owner" : "in company stock"
        return { field: "total-input", message: `Insufficient input stock in this godown ${pool}: ${available} kg of ${name} available, but ${qty} kg requested. Reduce the batch size or choose another godown.` }
      }
    }
    return null
  }

  const batchDraftPayload = () => ({
    recipeId: recipeId || undefined,
    machineId,
    godownId,
    plannedSizeKg: totalInputKg,
    inputs: inputLines.map((l) => ({ productId: l.productId, actualQtyKg: Number(l.qty) || 0 })),
    outputProductId,
    actualOutputKg: outputWeightKg,
    byproductProductId: byProductId || undefined,
    byproductKg: byProductKg,
    wasteKg,
    packagingTypeId: packagingTypeId || undefined,
    bagsConsumed,
    packingRatePerBag,
    damagedBags,
    notes: batchNotes || undefined,
    isCustomerOwned,
    ownerPartyId: effectiveOwnerPartyId ?? undefined,
    customerId: batchCustomerId || undefined,
    orderRef: batchOrderRef || undefined,
    operatorName: batchOperatorName || undefined,
    varianceReason: varianceReason || undefined,
  })

  const handlePostBatch = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    const problem = validateBatchForm()
    if (problem) {
      setBatchFieldErr(problem.field)
      setError(problem.message)
      return
    }
    setBatchFieldErr("")
    setError("")
    const selectedMachine = machines.find((m) => m.id === machineId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const batchNo = `BAT-2026-${String(batchCount + 1).padStart(3, "0")}`
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

  const handleSaveBatchDraft = async () => {
    if (isPending) return
    const problem = validateBatchForm()
    if (problem) {
      setBatchFieldErr(problem.field)
      setError(problem.message)
      return
    }
    setBatchFieldErr("")
    setError("")
    setIsPending(true)
    try {
      const created = await createBatchDraft(batchDraftPayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not save the batch draft.")
        return
      }
      await onSaved(`${(created.data as any)?.batch_no ?? "Batch"} saved as draft — post it from the list below.`)
      onClose()
    } finally {
      setIsPending(false)
    }
  }

  const handleConfirmPost = async () => {
    if (!draftBatch || postGuard.current) return
    postGuard.current = true
    setIsPending(true)
    try {
      const created = await createBatchDraft(batchDraftPayload())
      if (!created.success || !(created.data as any)?.id) {
        // Close the confirm so the error is visible in the form banner
        // (it would otherwise sit behind the confirm overlay).
        setShowPostConfirm(false)
        setError(created.error ?? "Could not create the batch draft.")
        return
      }
      const posted = await postBatch((created.data as any).id, postToken("batch:post", (created.data as any).id))
      if (!posted.success) {
        setShowPostConfirm(false)
        setError(posted.error ?? "Could not post the batch. The draft is kept below — post it again or delete it.")
        return
      }
      const row: any = posted.data ?? created.data
      const notice = `${row.batch_no ?? draftBatch.batch_no} posted — ${formatWeight(row.actual_input_kg ?? draftBatch.actual_input_kg)} input deducted, ${formatWeight(row.actual_output_kg ?? draftBatch.actual_output_kg)} output added at ${row.yield_pct ?? draftBatch.yield_pct}% yield.`
      setShowPostConfirm(false)
      setDraftBatch(null)
      await onSaved(notice)
      onClose()
      await onPrinted({ id: row.id ?? (created.data as any).id, batch_no: row.batch_no ?? draftBatch.batch_no })
    } finally {
      setIsPending(false)
      postGuard.current = false
    }
  }

  if (!open) return null
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        wide
        title="Execute Production / Cleaning Batch"
        description="Deducts raw input grain and produces clean graded seed & by-products into inventory."
      >
        <form onSubmit={handlePostBatch} className="space-y-4 text-xs">
          <AlertBanner tone="error" message={error} onDismiss={() => setError("")} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="machine-cleaning-plant">Machine / Cleaning Plant *</label>
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
              {inlineErr("machine", batchFieldErr)}
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="target-godown">Target Godown *</label>
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
              {inlineErr("godown", batchFieldErr)}
            </div>
          </div>

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
              <input id="batch-order-ref" type="text" value={batchOrderRef} onChange={(e) => setBatchOrderRef(e.target.value)} placeholder="Customer order reference" className={inputClass} />
            </div>
            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="batch-operator">Operator</label>
              <input id="batch-operator" type="text" value={batchOperatorName} onChange={(e) => setBatchOperatorName(e.target.value)} placeholder="Operator who runs this batch" className={inputClass} />
            </div>
            <div>
              <label className="block font-medium text-foreground mb-1" htmlFor="batch-ownership">Stock Owner Pool</label>
              <select id="batch-ownership" value={isCustomerOwned ? "customer" : "company"} onChange={(e) => setIsCustomerOwned(e.target.value === "customer")} className={inputClass}>
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

          <div>
            <label className="block font-medium text-foreground mb-1" htmlFor="recipe-optional">Recipe (optional)</label>
            <select id="recipe-optional" value={recipeId} onChange={(e) => handleRecipeSelect(e.target.value)} className={inputClass}>
              <option value="">No recipe — enter inputs by hand</option>
              {recipes.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.code} v{r.version} — {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="p-3 rounded-lg bg-muted border border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-foreground uppercase tracking-wider text-[10px]">Input Grain (Stock Deduction)</span>
              <span className="text-muted-foreground text-[11px]">
                Total Input: <strong className="text-foreground">{formatWeight(totalInputKg)}</strong>
              </span>
            </div>

            {inputLines.map((line, idx) => (
              <div key={line.key} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`raw-seed-product-${line.key}`}>Raw Seed Product *</label>
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
                  {inlineErr(`input-product-${line.key}`, batchFieldErr)}
                </div>

                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`production-input-weight-kg-${line.key}`}>Input Weight (kg) *{line.productId ? ` — in godown: ${formatWeight(stockForProduct(line.productId))}` : ""}</label>
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
                  <p className="mt-1 text-[11px] text-muted-foreground">Share of total input: {totalInputKg > 0 ? `${lineSharePct(Number(line.qty) || 0, totalInputKg)}%` : "—"}</p>
                  {inlineErr(`input-qty-${line.key}`, batchFieldErr)}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setInputLines((lines) => [...lines, { key: Date.now(), productId: "", qty: 0 }])} className="px-3 py-1.5 rounded-md bg-background border border-border text-foreground text-[11px] font-semibold cursor-pointer">+ Add input line</button>
          </div>

          <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-3">
            <span className="font-bold text-foreground uppercase tracking-wider text-[10px] block">Graded Output & Recovery (Stock Increment)</span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor="finished-output-seed">Finished Output Seed *</label>
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
                {inlineErr("output-product", batchFieldErr)}
              </div>

              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor="usable-output-kg">Usable Output (kg) *</label>
                <input id="usable-output-kg" type="number" value={outputWeightKg} onChange={(e) => setOutputWeightKg(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" min="0" required />
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
                <input id="by-product-weight-kg" type="number" value={byProductKg} onChange={(e) => setByProductKg(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" min="0" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor="process-wastage-loss-kg">Process Wastage / Loss (kg)</label>
                <input id="process-wastage-loss-kg" type="number" value={wasteKg} onChange={(e) => setWasteKg(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" />
              </div>

              <div className="flex items-center justify-between p-2 rounded-md bg-background border border-border">
                <span className="text-muted-foreground">Calculated Yield:</span>
                <strong className="text-base text-teal-600 dark:text-teal-400 font-mono">{calculatedYield}%</strong>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
            <span>Output: <strong className="text-foreground font-mono">{calculatedYield}% of input</strong></span>
            <span>By-product: <strong className="text-foreground font-mono">{totalInputKg > 0 ? Math.round((byProductKg / totalInputKg) * 100) : 0}% of input</strong></span>
            <span>Waste: <strong className="text-foreground font-mono">{totalInputKg > 0 ? Math.round((wasteKg / totalInputKg) * 100) : 0}% of input</strong></span>
          </div>
          {inlineErr("output", batchFieldErr)}
          {inlineErr("total-input", batchFieldErr)}
          {inlineErr("inputs", batchFieldErr)}

          <div className="p-3 rounded-lg bg-muted border border-border space-y-2">
            <span className="font-bold text-foreground uppercase tracking-wider text-[10px] block">Packaging (Bardana)</span>
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
            <input id="batch-variance-reason" type="text" value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} placeholder="Required before posting when an input variance exceeds the configured tolerance" className={inputClass} />
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1" htmlFor="batch-run-notes">Batch Run Notes</label>
            <input id="batch-run-notes" type="text" value={batchNotes} onChange={(e) => setBatchNotes(e.target.value)} placeholder="Notes, moisture result, screen size" className={inputClass} />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={() => { onClose(); setBatchFieldErr("") }} className={secondaryButtonClass}>Cancel</button>
            <button type="button" onClick={handleSaveBatchDraft} disabled={isPending} className="px-4 py-2 rounded-lg bg-background border border-border text-foreground text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
              <span>{isPending ? "Saving…" : "Save as draft"}</span>
            </button>
            <button type="submit" disabled={isPending} className={primaryButtonClass}>
              {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{isPending ? "Posting…" : "Post Batch Run & Update Ledgers"}</span>
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={showPostConfirm}
        title="Post this production batch?"
        description={draftBatch ? `${draftBatch.batch_no} will deduct ${formatWeight(draftBatch.actual_input_kg)} of input, add ${formatWeight(draftBatch.actual_output_kg)} of graded output (${draftBatch.yield_pct}% yield) and ${formatWeight(draftBatch.byproduct_kg)} of by-product. A posted batch can only be changed by reversal.` : ""}
        confirmLabel="Post Batch Run & Update Ledgers"
        pending={isPending}
        onConfirm={handleConfirmPost}
        onCancel={() => { setShowPostConfirm(false); setDraftBatch(null) }}
      />
    </>
  )
}
