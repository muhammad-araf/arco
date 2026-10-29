"use client"

/**
 * Machinery job create dialog, POS-style: one modal form that owns its
 * own state, on the shared Modal kit — replacing the hand-rolled
 * `fixed inset-0 ... bg-black/60` modal that lived on the Machinery
 * page. Same fields, same validation, same server actions, same
 * draft → post → print behaviour as the old modal.
 *
 * One confirmed error fixed here: the old form carried a `notes`
 * value into its draft payload but had no Notes input, so notes could
 * never be entered. A Notes field is added; the payload is unchanged.
 * Everything else is presentation only: the create → post sequence,
 * the exact-once token, and the charge math (machineryCharge) are
 * untouched, and the job print still comes from the page after post.
 */
import * as React from "react"
import { CheckCircle2 } from "lucide-react"
import { postToken } from "@/lib/idempotency"
import { createJobDraft, postJob } from "@/app/actions/machinery"
import {
  listMachines,
  listParties,
  listProducts,
  listGodowns,
  createParty,
  createGodown,
  createProduct,
  createMachine,
} from "@/app/actions/masters"
import {
  InlineAdd,
  PARTY_FIELDS,
  GODOWN_FIELDS,
  PRODUCT_FIELDS,
  MACHINE_FIELDS,
} from "@/components/print/inline-add"
import type { Machine, Party, Product, RateBasis } from "@/lib/types/database"
import { machineryCharge } from "@/lib/calc"
import { formatCurrency, formatWeight } from "@/lib/utils"
import { lineUnaccountedKg, lineYieldPct } from "@/lib/dialog-calcs"
import { ConfirmDialog, SubmitSpinner, isPositive } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

export type MachineryJobLine = {
  key: number
  inputProductId: string
  inputQty: number
  outputProductId: string
  outputQty: number
  byproductProductId: string
  byproductQty: number
}

const DEFAULT_LINES: MachineryJobLine[] = [
  {
    key: 1,
    inputProductId: "",
    inputQty: 5000,
    outputProductId: "",
    outputQty: 4600,
    byproductProductId: "",
    byproductQty: 0,
  },
]

export function MachineryJobDialog({
  open,
  onClose,
  machines: machinesProp,
  customers: customersProp,
  products: productsProp,
  godowns: godownsProp,
  processingTypes,
  recordCount,
  onPosted,
  onDraftSaved,
  onRefresh,
}: {
  open: boolean
  onClose: () => void
  machines: Machine[]
  customers: Party[]
  products: Product[]
  godowns: any[]
  processingTypes: string[]
  /** jobs.length — only used for the draft preview number. */
  recordCount: number
  /** (notice, created job id) — the page reloads and opens the print ticket. */
  onPosted: (notice: string, jobId: string) => void
  onDraftSaved: (notice: string) => void
  /** Called when a draft was created but posting failed, so the page reloads and the draft shows in the list. */
  onRefresh: () => void
}) {
  const [machines, setMachines] = React.useState<Machine[]>(machinesProp)
  const [customers, setCustomers] = React.useState<Party[]>(customersProp)
  const [products, setProducts] = React.useState<Product[]>(productsProp)
  const [godowns, setGodowns] = React.useState<any[]>(godownsProp)
  const [customerId, setCustomerId] = React.useState("")
  const [machineId, setMachineId] = React.useState("")
  const [godownId, setGodownId] = React.useState("")
  const [processingType, setProcessingType] = React.useState("Grading & Cleaning")
  const [operatorName, setOperatorName] = React.useState("")
  const [isCustomerOwned, setIsCustomerOwned] = React.useState(true)
  const [jobLines, setJobLines] = React.useState<MachineryJobLine[]>(DEFAULT_LINES)
  const [wasteWeight, setWasteWeight] = React.useState<number>(0)
  const [bagCount, setBagCount] = React.useState<number>(0)
  const [maundKg, setMaundKg] = React.useState<number>(0)
  const [rateBasis, setRateBasis] = React.useState<RateBasis>("per_50kg")
  const [rate, setRate] = React.useState<number>(85)
  const [notes, setNotes] = React.useState("")
  const [error, setError] = React.useState("")
  const [fieldErr, setFieldErr] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftJob, setDraftJob] = React.useState<any | null>(null)
  const jobGuard = React.useRef(false)

  // Fresh create on every open, with the same first-item defaults the
  // old page effect applied (first machine / customer / godown /
  // product). Closing without saving discards edits.
  React.useEffect(() => {
    if (!open) return
    setMachines(machinesProp)
    setCustomers(customersProp)
    setProducts(productsProp)
    setGodowns(godownsProp)
    setCustomerId(customersProp[0]?.id ?? "")
    setMachineId(machinesProp[0]?.id ?? "")
    setGodownId(godownsProp[0]?.id ?? "")
    setProcessingType("Grading & Cleaning")
    setOperatorName("")
    setIsCustomerOwned(true)
    setJobLines(
      productsProp.length > 0
        ? [{ ...DEFAULT_LINES[0], inputProductId: productsProp[0].id, outputProductId: productsProp[0].id }]
        : DEFAULT_LINES,
    )
    setWasteWeight(0)
    setBagCount(0)
    setMaundKg(0)
    setRateBasis("per_50kg")
    setRate(85)
    setNotes("")
    setError("")
    setFieldErr("")
    setIsPending(false)
    setShowConfirm(false)
    setDraftJob(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const totalInputWeight = jobLines.reduce((s, l) => s + (Number(l.inputQty) || 0), 0)
  const totalOutputWeight = jobLines.reduce((s, l) => s + (Number(l.outputQty) || 0), 0)
  const totalByproductWeight = jobLines.reduce((s, l) => s + (Number(l.byproductQty) || 0), 0)

  let serviceCharge = 0
  try {
    serviceCharge = machineryCharge(
      rateBasis === "per_bag" ? bagCount : totalInputWeight,
      rateBasis,
      rate,
      rateBasis === "per_maund" ? (maundKg > 0 ? maundKg : undefined) : undefined,
    )
  } catch {
    serviceCharge = 0
  }

  const validateJobForm = (): { field: string; message: string } | null => {
    if (!customerId) return { field: "customer", message: "Select the customer / grain owner for this job." }
    if (!machineId) return { field: "machine", message: "Select the machine that will run this job." }
    if (!godownId) return { field: "godown", message: "Select the godown where this job runs." }
    if (!processingType.trim()) return { field: "processing-type", message: "Select or enter the processing type." }
    if (!jobLines.length) return { field: "job-lines", message: "Add at least one job line." }
    const badLine = jobLines.find((l) => !l.inputProductId)
    if (badLine) return { field: `job-input-product-${badLine.key}`, message: "Every job line needs an input product." }
    if (!isPositive(totalInputWeight)) return { field: "total-input", message: "Input weight must be greater than zero." }
    if (totalOutputWeight < 0 || totalByproductWeight < 0 || wasteWeight < 0) return { field: "totals", message: "Output, by-product and waste weights cannot be negative." }
    if (totalOutputWeight + totalByproductWeight + wasteWeight > totalInputWeight) return { field: "totals", message: `Output (${totalOutputWeight} kg) + by-product (${totalByproductWeight} kg) + waste (${wasteWeight} kg) exceeds input (${totalInputWeight} kg). Correct the weights before saving.` }
    if (rate < 0) return { field: "rate", message: "Rate cannot be negative." }
    if (rateBasis === "per_bag" && !(bagCount > 0)) return { field: "bag-count", message: "Enter the actual bag count for per-bag billing." }
    if (bagCount < 0) return { field: "bag-count", message: "Bag count cannot be negative." }
    if (rateBasis === "per_maund" && !(maundKg > 0)) return { field: "maund-kg", message: "Enter the client-approved kg per maund for per-maund billing." }
    return null
  }

  const fieldError = (key: string) =>
    fieldErr === key && error ? error : undefined

  const jobDraftPayload = () => {
    const first = jobLines[0]
    return {
      customerId, machineId, godownId, processingType,
      operatorName: operatorName || undefined,
      inputProductId: first?.inputProductId ?? "", inputWeightKg: totalInputWeight,
      outputProductId: first?.outputProductId || undefined, outputWeightKg: totalOutputWeight,
      byproductProductId: first?.byproductProductId || undefined, byproductWeightKg: totalByproductWeight,
      wasteWeightKg: wasteWeight,
      lines: jobLines.map((l) => ({
        inputProductId: l.inputProductId, inputQtyKg: Number(l.inputQty) || 0,
        outputProductId: l.outputProductId || undefined, outputQtyKg: Number(l.outputQty) || 0,
        byproductProductId: l.byproductProductId || undefined, byproductQtyKg: Number(l.byproductQty) || 0,
      })),
      bags: bagCount > 0 ? bagCount : undefined,
      maundKg: maundKg > 0 ? maundKg : undefined,
      rateBasis, rate, isCustomerOwned, notes: notes || undefined,
    }
  }

  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    const problem = validateJobForm()
    if (problem) {
      setFieldErr(problem.field)
      setError(problem.message)
      return
    }
    setFieldErr("")
    setError("")
    const selectedCust = customers.find((c) => c.id === customerId)
    const selectedMach = machines.find((m) => m.id === machineId)
    const first = jobLines[0]
    const selectedProd = products.find((p) => p.id === first?.inputProductId)
    const selectedOut = products.find((p) => p.id === first?.outputProductId)
    const jobNo = `JOB-2026-${String(recordCount + 1).padStart(3, "0")}`
    setDraftJob({
      id: `job-${Date.now()}`,
      job_no: jobNo,
      date: new Date().toISOString(),
      customer_id: customerId,
      customer_name: selectedCust?.name,
      machine_id: machineId,
      machine_name: selectedMach?.name,
      processing_type: processingType,
      operator_name: operatorName || undefined,
      input_product_id: first?.inputProductId ?? "",
      input_product_name: selectedProd?.name,
      input_weight_kg: totalInputWeight,
      output_product_id: first?.outputProductId,
      output_product_name: selectedOut?.name,
      output_weight_kg: totalOutputWeight,
      byproduct_weight_kg: totalByproductWeight,
      waste_weight_kg: wasteWeight,
      bags: bagCount > 0 ? bagCount : null,
      maund_kg: maundKg > 0 ? maundKg : null,
      rate_basis: rateBasis,
      rate,
      service_charge: serviceCharge,
      is_customer_owned: isCustomerOwned,
      status: "draft",
      payment_status: "unbilled",
      notes: notes || undefined,
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const handleSaveJobDraft = async () => {
    if (isPending) return
    const problem = validateJobForm()
    if (problem) {
      setFieldErr(problem.field)
      setError(problem.message)
      return
    }
    setFieldErr("")
    setError("")
    setIsPending(true)
    try {
      const created = await createJobDraft(jobDraftPayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not save the job draft.")
        return
      }
      onDraftSaved(`${(created.data as any)?.job_no ?? "Job"} saved as draft — post it from the list below.`)
      onClose()
    } finally {
      setIsPending(false)
    }
  }

  const handleConfirmJob = async () => {
    if (!draftJob || jobGuard.current) return
    jobGuard.current = true
    setIsPending(true)
    try {
      const created = await createJobDraft(jobDraftPayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not create the machinery job draft.")
        setShowConfirm(false)
        return
      }
      const posted = await postJob((created.data as any).id, postToken("machinery:post", (created.data as any).id))
      if (!posted.success) {
        // The draft stays in the list as Draft, with Post / Delete
        // actions — it is not lost, and it is not shown as posted.
        setError(posted.error ?? "Could not post the machinery job. The draft is kept below — post it again or delete it.")
        setShowConfirm(false)
        onRefresh()
        return
      }
      const row: any = posted.data ?? created.data
      const notice = `${row.job_no ?? draftJob.job_no} recorded — service charge ${formatCurrency(row.service_charge ?? draftJob.service_charge)} (${draftJob.rate_basis.replace("_", " ")}). Customer-owned stock is not counted as company inventory.`
      onClose()
      onPosted(notice, (created.data as any).id)
    } finally {
      setIsPending(false)
      jobGuard.current = false
    }
  }

  if (!open) return null
  return (
    <>
      <Modal
        open={open}
        onClose={showConfirm ? () => {} : onClose}
        title="Record Machinery Service Job"
        description="Log a grading, cleaning or treatment job. Charge is calculated from the rate basis below."
        wide
      >
        <form onSubmit={handleCreateJob} className="space-y-4 text-xs">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="customer-grain-owner" label="Customer / Grain Owner" required error={fieldError("customer")}>
              <div className="flex flex-wrap items-start gap-2">
                <select
                  id="customer-grain-owner"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className={`${inputClass} flex-1 min-w-0`}
                  required
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "customer" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setCustomers(list.filter((x) => x.type === "customer" || x.type === "both")); } setCustomerId(id); }} />
              </div>
            </Field>
            <Field id="machine-cleaner-grader" label="Machine Cleaner / Grader" required error={fieldError("machine")}>
              <div className="flex flex-wrap items-start gap-2">
                <select
                  id="machine-cleaner-grader"
                  value={machineId}
                  onChange={(e) => setMachineId(e.target.value)}
                  className={`${inputClass} flex-1 min-w-0`}
                  required
                >
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <InlineAdd label="Machine" fields={MACHINE_FIELDS} createAction={async (v) => createMachine({ code: v.code, name: v.name, processing_type: v.processing_type })} onCreated={async (id) => { const r = await listMachines(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setMachines(list); } setMachineId(id); }} />
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="godown" label="Godown" required error={fieldError("godown")}>
              <div className="flex flex-wrap items-start gap-2">
                <select id="godown" value={godownId} onChange={(e) => setGodownId(e.target.value)} className={`${inputClass} flex-1 min-w-0`}>
                  {godowns.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                </select>
                <InlineAdd label="Godown" fields={GODOWN_FIELDS} createAction={async (v) => createGodown({ code: v.code, name: v.name })} onCreated={async (id) => { const r = await listGodowns(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setGodowns(list); } setGodownId(id); }} />
              </div>
            </Field>
            <Field id="processing-type" label="Processing Type" required error={fieldError("processing-type")}>
              {processingTypes.length > 0 ? (
                <select
                  id="processing-type"
                  value={processingTypes.includes(processingType) ? processingType : ""}
                  onChange={(e) => setProcessingType(e.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">Select processing type</option>
                  {processingTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="processing-type"
                  type="text"
                  value={processingType}
                  onChange={(e) => setProcessingType(e.target.value)}
                  placeholder="e.g. Grading & Cleaning"
                  className={inputClass}
                  required
                />
              )}
            </Field>
            <Field id="job-operator" label="Operator">
              <input
                id="job-operator"
                type="text"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                placeholder="Operator who runs this job"
                className={inputClass}
              />
            </Field>
            <Field id="ownership" label="Ownership">
              <select
                id="ownership"
                value={isCustomerOwned ? "customer" : "company"}
                onChange={(e) => setIsCustomerOwned(e.target.value === "customer")}
                className={inputClass}
              >
                <option value="customer">Customer-owned</option>
                <option value="company">Company-owned</option>
              </select>
            </Field>
          </div>

          <div className="p-3 rounded-lg bg-muted border border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-foreground uppercase tracking-wider text-[10px]">Job Lines</span>
              <span className="text-muted-foreground text-[11px]">
                Total input: <strong className="text-foreground">{formatWeight(totalInputWeight)}</strong>
              </span>
            </div>
            {jobLines.map((line) => (
              <div key={line.key} className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-2 rounded-md bg-background border border-border">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-input-product-${line.key}`}>Input Product *</label>
                  <div className="flex flex-wrap items-start gap-2">
                    <select
                      id={`job-input-product-${line.key}`}
                      value={line.inputProductId}
                      onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, inputProductId: e.target.value } : l)))}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                    >
                      <option value="">Select product</option>
                      {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                    <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } setJobLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, inputProductId: id } : l))); }} />
                  </div>
                  {fieldError(`job-input-product-${line.key}`) && (
                    <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{fieldError(`job-input-product-${line.key}`)}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-input-qty-${line.key}`}>Input (kg) *</label>
                  <input id={`job-input-qty-${line.key}`} type="number" value={line.inputQty}
                    onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, inputQty: Number(e.target.value) } : l)))}
                    min="0" className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" required />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-output-product-${line.key}`}>Output Product</label>
                  <div className="flex flex-wrap items-start gap-2">
                    <select
                      id={`job-output-product-${line.key}`}
                      value={line.outputProductId}
                      onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, outputProductId: e.target.value } : l)))}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                    >
                      <option value="">No output product</option>
                      {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                    <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } setJobLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, outputProductId: id } : l))); }} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-output-qty-${line.key}`}>Output (kg)</label>
                  <input id={`job-output-qty-${line.key}`} type="number" value={line.outputQty}
                    onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, outputQty: Number(e.target.value) } : l)))}
                    min="0" className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-byproduct-product-${line.key}`}>By-Product (stocked)</label>
                  <div className="flex flex-wrap items-start gap-2">
                    <select
                      id={`job-byproduct-product-${line.key}`}
                      value={line.byproductProductId}
                      onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, byproductProductId: e.target.value } : l)))}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                    >
                      <option value="">No by-product</option>
                      {products.filter((p) => p.category === "by_product").map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                    <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } setJobLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, byproductProductId: id } : l))); }} />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-byproduct-qty-${line.key}`}>By-Product (kg)</label>
                  <div className="flex gap-2">
                    <input id={`job-byproduct-qty-${line.key}`} type="number" value={line.byproductQty}
                      onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, byproductQty: Number(e.target.value) } : l)))}
                      min="0" className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" />
                    {jobLines.length > 1 && (
                      <button type="button" onClick={() => setJobLines((lines) => lines.filter((l) => l.key !== line.key))} className="px-2 rounded-md bg-muted text-muted-foreground text-xs font-bold cursor-pointer" title="Remove this job line">✕</button>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground sm:col-span-2">Line yield: <strong className="text-foreground font-mono">{lineYieldPct(Number(line.outputQty) || 0, Number(line.inputQty) || 0)}%</strong> · Unaccounted (input − output − by-product): <strong className="text-foreground font-mono">{formatWeight(lineUnaccountedKg(Number(line.inputQty) || 0, Number(line.outputQty) || 0, Number(line.byproductQty) || 0))}</strong> — job-level waste below is separate.</p>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setJobLines((lines) => [...lines, { key: Date.now(), inputProductId: "", inputQty: 0, outputProductId: "", outputQty: 0, byproductProductId: "", byproductQty: 0 }])} className="px-3 py-1.5 rounded-md bg-background border border-border text-foreground text-[11px] font-semibold cursor-pointer">+ Add job line</button>
            <div>
              {(fieldError("totals") || fieldError("total-input") || fieldError("job-lines")) && (
                <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{fieldError("totals") ?? fieldError("total-input") ?? fieldError("job-lines")}</p>
              )}
              <label className="block font-medium text-foreground mb-1" htmlFor="waste-weight-kg">Waste Weight (kg, job-level — never stocked)</label>
              <input
                id="waste-weight-kg"
                type="number"
                value={wasteWeight}
                onChange={(e) => setWasteWeight(Number(e.target.value))}
                min="0"
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="actual-bag-count" label="Actual Bag Count" error={fieldError("bag-count")} hint="Count the bags. Required for per-bag billing.">
              <input
                id="actual-bag-count"
                type="number"
                value={bagCount}
                onChange={(e) => setBagCount(Number(e.target.value))}
                min="0"
                className={`${inputClass} font-mono`}
              />
            </Field>
            {rateBasis === "per_maund" && (
              <Field id="kg-per-maund-client-approved" label="Kg per Maund (client-approved)" required error={fieldError("maund-kg")}>
                <input
                  id="kg-per-maund-client-approved"
                  type="number"
                  value={maundKg}
                  onChange={(e) => setMaundKg(Number(e.target.value))}
                  min="1"
                  step="0.01"
                  className={`${inputClass} font-mono`}
                  required
                />
              </Field>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-muted border border-border">
            <Field id="rate-basis-formula" label="Rate Basis (Formula)">
              <select
                id="rate-basis-formula"
                value={rateBasis}
                onChange={(e) => setRateBasis(e.target.value as RateBasis)}
                className={inputClass}
              >
                <option value="per_50kg">Per 50 kg Bag Basis (Standard)</option>
                <option value="per_bag">Per Bag Count Basis</option>
                <option value="per_maund">Per Maund</option>
                <option value="per_kg">Per Kg</option>
                <option value="fixed">Fixed Lump-Sum Fee</option>
              </select>
            </Field>
            <Field id="unit-service-rate-pkr" label="Unit Service Rate (PKR)" required error={fieldError("rate")}>
              <input
                id="unit-service-rate-pkr"
                type="number"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                min="1"
                className={`${inputClass} font-mono`}
                required
              />
            </Field>
          </div>

          <Field id="job-notes" label="Notes">
            <input
              id="job-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Job notes"
              className={inputClass}
            />
          </Field>

          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
            <span className="text-muted-foreground font-medium">Calculated Service Charge:</span>
            <strong className="text-base text-emerald-600 dark:text-emerald-400 font-mono font-bold">
              {formatCurrency(serviceCharge)}
            </strong>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveJobDraft}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-background border border-border text-foreground text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span>{isPending ? "Saving…" : "Save as draft"}</span>
            </button>
            <button type="submit" disabled={isPending} className={primaryButtonClass}>
              {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{isPending ? "Saving…" : "Save & Record Service Job"}</span>
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={showConfirm}
        title="Record this machinery job?"
        description={draftJob ? `${draftJob.job_no} for ${draftJob.customer_name || "the customer"}: ${formatWeight(draftJob.input_weight_kg)} in, ${formatWeight(draftJob.output_weight_kg)} of ${draftJob.output_product_name || "output"} out, service charge ${formatCurrency(draftJob.service_charge)}. ${draftJob.is_customer_owned ? "The grain is customer-owned, so company stock is untouched." : "Company-owned input stock is used."}` : ""}
        confirmLabel="Save & Record Service Job"
        pending={isPending}
        onConfirm={handleConfirmJob}
        onCancel={() => { setShowConfirm(false); setDraftJob(null) }}
      />
    </>
  )
}
