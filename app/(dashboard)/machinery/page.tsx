"use client"

import { postToken } from "@/lib/idempotency"

import * as React from "react"
import {
  Cog,
  Plus,
  Printer,
  CheckCircle2,
  DollarSign,
  User,
  Building2,
  Boxes,
} from "lucide-react"
import { listJobs, getJob, createJobDraft, postJob, reverseJob, deleteJobDraft } from "@/app/actions/machinery"
import { listMachines, listParties, listProducts, listGodowns, createParty, createGodown, createProduct, createMachine } from "@/app/actions/masters"
import { InlineAdd, PARTY_FIELDS, GODOWN_FIELDS, PRODUCT_FIELDS, MACHINE_FIELDS } from "@/components/print/inline-add"
import { listProcessingTypes } from "@/app/actions/processing-types"
import { MachineryJobPrint } from "@/components/print/machinery-job-print"
import { PrintButton } from "@/components/print/print-button"
import { MachineryJob, Machine, Party, Product, RateBasis } from "@/lib/types/database"
import { machineryCharge } from "@/lib/calc"
import { formatCurrency, formatWeight, formatDate } from "@/lib/utils"
import { lineUnaccountedKg, lineYieldPct } from "@/lib/dialog-calcs"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  ReversalDialog,
  SubmitSpinner,
  isPositive,
} from "@/components/erp-ui"
import { MachinerySkeleton } from "@/components/route-skeletons"

export default function MachineryJobsPage() {
  const [jobs, setJobs] = React.useState<MachineryJob[]>([])
  const [machines, setMachines] = React.useState<Machine[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [godowns, setGodowns] = React.useState<any[]>([])
  const [godownId, setGodownId] = React.useState("")
  const [reversalTarget, setReversalTarget] = React.useState<any | null>(null)
  const [isReversing, setIsReversing] = React.useState(false)

  // Modal State
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [jobFieldErr, setJobFieldErr] = React.useState("")
  const inlineErr = (key: string, current: string) =>
    current === key && formError ? (
      <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{formError}</p>
    ) : null
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftJob, setDraftJob] = React.useState<MachineryJob | null>(null)
  const jobGuard = React.useRef(false)
  const [customerId, setCustomerId] = React.useState("")
  const [machineId, setMachineId] = React.useState("")
  const [deleteTarget, setDeleteTarget] = React.useState<any | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [isPostingDraft, setIsPostingDraft] = React.useState(false)
  const [processingType, setProcessingType] = React.useState("Grading & Cleaning")
  const [processingTypes, setProcessingTypes] = React.useState<string[]>([])
  // Multi-line job editor. One line = the legacy single-line job;
  // extra lines add input / output / by-product rows to the same job.
  // The charge stays job-level (total input weight, or bag count).
  const [jobLines, setJobLines] = React.useState<{ key: number; inputProductId: string; inputQty: number; outputProductId: string; outputQty: number; byproductProductId: string; byproductQty: number }[]>([{ key: 1, inputProductId: "", inputQty: 5000, outputProductId: "", outputQty: 4600, byproductProductId: "", byproductQty: 0 }])
  const [operatorName, setOperatorName] = React.useState("")
  const [wasteWeight, setWasteWeight] = React.useState<number>(0)
  const [selectedJobForPrint, setSelectedJobForPrint] = React.useState<any | null>(null)
  const [bagCount, setBagCount] = React.useState<number>(0)
  const [maundKg, setMaundKg] = React.useState<number>(0)
  const [rateBasis, setRateBasis] = React.useState<RateBasis>("per_50kg")
  const [rate, setRate] = React.useState<number>(85)
  const [isCustomerOwned, setIsCustomerOwned] = React.useState(true)
  const [notes, setNotes] = React.useState("")

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [j, m, pa, pr, g, pt] = await Promise.all([listJobs(), listMachines(), listParties(), listProducts(), listGodowns(), listProcessingTypes()])
      const failed = [j, m, pa, pr, g].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load machinery data.")
      // Processing types come from the master table; an empty or
      // failed result means the form falls back to free text.
      setProcessingTypes(pt.success && Array.isArray(pt.data) ? (pt.data as any[]).map((t) => t.name).filter(Boolean) : [])
      const machineList = (Array.isArray(m.data) ? m.data : []) as Machine[]
      const partyList = (Array.isArray(pa.data) ? pa.data : []) as Party[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      setMachines(machineList); setCustomers(partyList.filter((x) => x.type === "customer" || x.type === "both")); setProducts(productList)
      setGodowns(Array.isArray(g.data) ? g.data : [])
      setJobs((Array.isArray(j.data) ? j.data : []).map((row: any) => ({
        ...row,
        customer_name: partyList.find((x) => x.id === row.customer_id)?.name ?? "Not set",
        machine_name: machineList.find((x) => x.id === row.machine_id)?.name ?? "Not set",
        input_product_name: productList.find((x) => x.id === row.input_product_id)?.name ?? "Not set",
      })))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load machinery data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Mount load: without this the page never leaves its skeleton —
  // isLoading starts true and only post-action handlers reloaded before.
  React.useEffect(() => { loadData() }, [loadData])

  React.useEffect(() => {
    if (machines.length > 0 && !machineId) setMachineId(machines[0].id)
    if (customers.length > 0 && !customerId) setCustomerId(customers[0].id)
    if (products.length > 0 && !jobLines[0]?.inputProductId) {
      setJobLines((lines) => lines.map((l, i) => (i === 0 ? { ...l, inputProductId: products[0].id, outputProductId: products[0].id } : l)))
    }
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
  }, [machines, customers, products, godowns, machineId, customerId, jobLines, godownId])

  const totalInputWeight = jobLines.reduce((s, l) => s + (Number(l.inputQty) || 0), 0)
  const totalOutputWeight = jobLines.reduce((s, l) => s + (Number(l.outputQty) || 0), 0)
  const totalByproductWeight = jobLines.reduce((s, l) => s + (Number(l.byproductQty) || 0), 0)

  // Preview charge from the same helper the server uses. Per-bag bills
  // the ENTERED bag count (never weight / 50); every other basis bills
  // the TOTAL input weight across all lines; per-maund bills with
  // the ENTERED kg per maund (never a hardcoded value).
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

  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §7: required fields, positive weights, non-negative waste and
    // rate — output + by-product + waste may not exceed input. Each
    // failure names its field, shown under the field and in the banner.
    const failJob = (field: string, message: string) => {
      setJobFieldErr(field)
      setFormError(message)
    }
    if (!customerId) { failJob("customer", "Select the customer / grain owner for this job."); return }
    if (!machineId) { failJob("machine", "Select the machine that will run this job."); return }
    if (!godownId) { failJob("godown", "Select the godown where this job runs."); return }
    if (!processingType.trim()) { failJob("processing-type", "Select or enter the processing type."); return }
    if (!jobLines.length) { failJob("job-lines", "Add at least one job line."); return }
    const badLine = jobLines.find((l) => !l.inputProductId)
    if (badLine) { failJob(`job-input-product-${badLine.key}`, "Every job line needs an input product."); return }
    if (!isPositive(totalInputWeight)) { failJob("total-input", "Input weight must be greater than zero."); return }
    if (totalOutputWeight < 0 || totalByproductWeight < 0 || wasteWeight < 0) { failJob("totals", "Output, by-product and waste weights cannot be negative."); return }
    if (totalOutputWeight + totalByproductWeight + wasteWeight > totalInputWeight) { failJob("totals", `Output (${totalOutputWeight} kg) + by-product (${totalByproductWeight} kg) + waste (${wasteWeight} kg) exceeds input (${totalInputWeight} kg). Correct the weights before saving.`); return }
    if (rate < 0) { failJob("rate", "Rate cannot be negative."); return }
    if (rateBasis === "per_bag" && !(bagCount > 0)) { failJob("bag-count", "Enter the actual bag count for per-bag billing."); return }
    if (bagCount < 0) { failJob("bag-count", "Bag count cannot be negative."); return }
    if (rateBasis === "per_maund" && !(maundKg > 0)) { failJob("maund-kg", "Enter the client-approved kg per maund for per-maund billing."); return }
    setJobFieldErr("")
    setFormError("")
    const selectedCust = customers.find((c) => c.id === customerId)
    const selectedMach = machines.find((m) => m.id === machineId)
    const first = jobLines[0]
    const selectedProd = products.find((p) => p.id === first?.inputProductId)
    const selectedOut = products.find((p) => p.id === first?.outputProductId)
    const jobNo = `JOB-2026-${String(jobs.length + 1).padStart(3, "0")}`
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
    } as any)
    setShowConfirm(true)
  }

  const handleConfirmJob = async () => {
    if (!draftJob || jobGuard.current) return
    jobGuard.current = true
    setIsPending(true)
    try {
      const first = jobLines[0]
      const created = await createJobDraft({
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
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the machinery job draft.")
        return
      }
      const posted = await postJob((created.data as any).id, postToken("machinery:post", (created.data as any).id))
      if (!posted.success) {
        // The draft stays in the list as Draft, with Post / Delete
        // actions — it is not lost, and it is not shown as posted.
        setFormError(posted.error ?? "Could not post the machinery job. The draft is kept below — post it again or delete it.")
        await loadData()
        return
      }
      const row: any = posted.data ?? created.data
      setFormNotice(`${row.job_no ?? draftJob.job_no} recorded — service charge ${formatCurrency(row.service_charge ?? draftJob.service_charge)} (${draftJob.rate_basis.replace("_", " ")}). Customer-owned stock is not counted as company inventory.`)
      setShowConfirm(false)
      setIsModalOpen(false)
      setDraftJob(null)
      await loadData()
      await handlePrintJob({ id: (created.data as any).id })
    } finally {
      setIsPending(false)
      jobGuard.current = false
    }
  }

  const handlePostDraft = async (job: any) => {
    if (isPostingDraft) return
    setIsPostingDraft(true)
    try {
      const res = await postJob(job.id, postToken("machinery:post", job.id))
      if (!res.success) {
        setFormError(res.error ?? "Could not post the job.")
        return
      }
      setFormNotice(`${job.job_no} posted.`)
      await loadData()
      await handlePrintJob(job)
    } finally {
      setIsPostingDraft(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return
    setIsDeleting(true)
    try {
      const res = await deleteJobDraft(deleteTarget.id)
      if (!res.success) {
        setFormError(res.error ?? "Could not delete the draft job.")
        return
      }
      setFormNotice(`${deleteTarget.job_no} draft deleted.`)
      setDeleteTarget(null)
      await loadData()
    } finally {
      setIsDeleting(false)
    }
  }

  // Print from the job's own stored lines, fetched fresh — never the
  // current form state's products or a fixed badge.
  const handlePrintJob = async (j: any) => {
    const res = await getJob(j.id)
    if (res.success && res.data) {
      const full: any = res.data
      const lines = (full.machinery_job_lines ?? []).map((l: any) => ({
        ...l,
        input_product_name: products.find((p) => p.id === l.input_product_id)?.name ?? "Not set",
        output_product_name: l.output_product_id ? products.find((p) => p.id === l.output_product_id)?.name ?? l.output_product_id : undefined,
        byproduct_product_name: l.byproduct_product_id ? products.find((p) => p.id === l.byproduct_product_id)?.name ?? l.byproduct_product_id : undefined,
      }))
      setSelectedJobForPrint({
        ...j,
        ...full,
        customer_name: customers.find((c) => c.id === full.customer_id)?.name ?? j.customer_name,
        machine_name: machines.find((m) => m.id === full.machine_id)?.name ?? j.machine_name,
        godown_name: godowns.find((g: any) => g.id === full.godown_id)?.name,
        input_product_name: products.find((p) => p.id === full.input_product_id)?.name ?? j.input_product_name,
        output_product_name: full.output_product_id ? products.find((p) => p.id === full.output_product_id)?.name : undefined,
        byproduct_product_name: full.byproduct_product_id ? products.find((p) => p.id === full.byproduct_product_id)?.name : undefined,
        machinery_job_lines: lines,
      })
    } else {
      setSelectedJobForPrint(j)
    }
  }

  const handleConfirmReversal = async (reasonCode: string, reason: string) => {
    if (!reversalTarget || isReversing) return
    setIsReversing(true)
    try {
      const res = await reverseJob(reversalTarget.id, `${reasonCode}: ${reason}`, postToken("machinery:reverse", reversalTarget.id))
      if (!res.success) {
        setFormError(res.error ?? "Could not reverse the job.")
        return
      }
      setFormNotice(`${reversalTarget.job_no} reversed. Reason recorded: ${reasonCode}.`)
      setReversalTarget(null)
      await loadData()
    } finally {
      setIsReversing(false)
    }
  }

  if (isLoading) return <MachinerySkeleton />

  return (
    <div className="space-y-6">
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Cog className="h-6 w-6 text-emerald-500" />
            Machinery
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>New Job</span>
        </button>
      </div>

      {/* Jobs Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Cog className="h-4 w-4 text-emerald-500" />
            Jobs ({jobs.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                <th className="pb-3 font-bold">Job No</th>
                <th className="pb-3 font-bold">Date</th>
                <th className="pb-3 font-bold">Client / Owner</th>
                <th className="pb-3 font-bold">Machine Plant</th>
                <th className="pb-3 font-bold">Input Grain</th>
                <th className="pb-3 font-bold text-right">Processed Weight</th>
                <th className="pb-3 font-bold">Billing Basis</th>
                <th className="pb-3 font-bold text-right">Rate</th>
                <th className="pb-3 font-bold text-right">Total Charge</th>
                <th className="pb-3 font-bold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-muted transition-colors">
                  <td className="py-3 font-mono font-bold text-foreground">{j.job_no}</td>
                  <td className="py-3 text-muted-foreground">{formatDate(j.date)}</td>
                  <td className="py-3 font-semibold text-foreground">{j.customer_name}</td>
                  <td className="py-3 text-muted-foreground">{j.machine_name}</td>
                  <td className="py-3 text-foreground">{j.input_product_name}</td>
                  <td className="py-3 text-right font-bold text-foreground">{formatWeight(j.input_weight_kg)}</td>
                  <td className="py-3 text-muted-foreground capitalize">{j.rate_basis.replace("_", " ")}</td>
                  <td className="py-3 text-right font-mono">{formatCurrency(j.rate)}</td>
                  <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(j.service_charge)}
                  </td>
                  <td className="py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handlePrintJob(j)}
                      className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer align-middle"
                      title="Print Machinery Job Ticket"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                    <span className={j.status === "reversed" ? "px-2 py-0.5 rounded-md bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] font-bold uppercase" : j.status === "draft" ? "px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase" : "px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase"}>
                      {j.status ?? "draft"}
                    </span>
                    {j.status === "draft" && (
                      <>
                        <button type="button" onClick={() => handlePostDraft(j)} disabled={isPostingDraft} className="ml-2 px-2 py-0.5 rounded-md hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer disabled:opacity-60">Post</button>
                        <button type="button" onClick={() => setDeleteTarget(j)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Delete</button>
                      </>
                    )}
                    {j.status === "posted" && (
                      <button type="button" onClick={() => setReversalTarget(j)} className="ml-2 px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Reverse</button>
                    )}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-4">
                    <EmptyState
                      title="No machinery jobs recorded yet"
                      hint="Log a grading, cleaning or treatment job."
                      actionLabel="New Machinery Service Job"
                      onAction={() => setIsModalOpen(true)}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-2xl p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Cog className="h-4 w-4 text-emerald-500" />
                Record Machinery Service Job
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateJob} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="customer-grain-owner">Customer / Grain Owner *</label>
                  <div className="flex flex-wrap items-start gap-2"><select id="customer-grain-owner"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select> <InlineAdd label="Party" fields={PARTY_FIELDS} createAction={async (v) => createParty({ code: v.code, name: v.name, type: v.type || "customer" })} onCreated={async (id) => { const r = await listParties(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setCustomers(list.filter((x) => x.type === "customer" || x.type === "both")); } setCustomerId(id); }} /></div>
                  {inlineErr("customer", jobFieldErr)}
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="machine-cleaner-grader">Machine Cleaner / Grader *</label>
                  <div className="flex flex-wrap items-start gap-2"><select id="machine-cleaner-grader"
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select> <InlineAdd label="Machine" fields={MACHINE_FIELDS} createAction={async (v) => createMachine({ code: v.code, name: v.name, processing_type: v.processing_type })} onCreated={async (id) => { const r = await listMachines(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setMachines(list); } setMachineId(id); }} /></div>
                  {inlineErr("machine", jobFieldErr)}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="godown">Godown *</label>
                  <div className="flex flex-wrap items-start gap-2"><select id="godown" value={godownId} onChange={(e) => setGodownId(e.target.value)} className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
                    {godowns.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                  </select> <InlineAdd label="Godown" fields={GODOWN_FIELDS} createAction={async (v) => createGodown({ code: v.code, name: v.name })} onCreated={async (id) => { const r = await listGodowns(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setGodowns(list); } setGodownId(id); }} /></div>
                  {inlineErr("godown", jobFieldErr)}
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="processing-type">Processing Type *</label>{inlineErr("processing-type", jobFieldErr)}
                  {processingTypes.length > 0 ? (
                    <select id="processing-type"
                      value={processingTypes.includes(processingType) ? processingType : ""}
                      onChange={(e) => setProcessingType(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                      required
                    >
                      <option value="">Select processing type</option>
                      {processingTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  ) : (
                    <input id="processing-type"
                      type="text"
                      value={processingType}
                      onChange={(e) => setProcessingType(e.target.value)}
                      placeholder="e.g. Grading & Cleaning"
                      className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                      required
                    />
                  )}
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="job-operator">Operator</label>
                  <input id="job-operator"
                    type="text"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    placeholder="Operator who runs this job"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  />
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="ownership">Ownership</label>
                  <select id="ownership"
                    value={isCustomerOwned ? "customer" : "company"}
                    onChange={(e) => setIsCustomerOwned(e.target.value === "customer")}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="customer">Customer-owned</option>
                    <option value="company">Company-owned</option>
                  </select>
                </div>
              </div>

              {/* Job lines: one line = the legacy single-line job.
                  By-product lines are stocked on post; waste below is
                  job-level and never stocked. */}
              <div className="p-3 rounded-lg bg-muted border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground uppercase tracking-wider text-[10px]">
                    Job Lines
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Total input: <strong className="text-foreground">{formatWeight(totalInputWeight)}</strong>
                  </span>
                </div>
                {jobLines.map((line) => (
                  <div key={line.key} className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-2 rounded-md bg-background border border-border">
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-input-product-${line.key}`}>Input Product *</label>
                      <div className="flex flex-wrap items-start gap-2"><select id={`job-input-product-${line.key}`}
                        value={line.inputProductId}
                        onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, inputProductId: e.target.value } : l)))}
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                      >
                        <option value="">Select product</option>
                        {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                      </select> <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } setJobLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, inputProductId: id } : l))); }} /></div>
                      {inlineErr(`job-input-product-${line.key}`, jobFieldErr)}
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-input-qty-${line.key}`}>Input (kg) *</label>
                      <input id={`job-input-qty-${line.key}`} type="number" value={line.inputQty}
                        onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, inputQty: Number(e.target.value) } : l)))}
                        min="0" className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" required />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-output-product-${line.key}`}>Output Product</label>
                      <div className="flex flex-wrap items-start gap-2"><select id={`job-output-product-${line.key}`}
                        value={line.outputProductId}
                        onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, outputProductId: e.target.value } : l)))}
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                      >
                        <option value="">No output product</option>
                        {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                      </select> <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } setJobLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, outputProductId: id } : l))); }} /></div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-output-qty-${line.key}`}>Output (kg)</label>
                      <input id={`job-output-qty-${line.key}`} type="number" value={line.outputQty}
                        onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, outputQty: Number(e.target.value) } : l)))}
                        min="0" className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground font-mono" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-0.5" htmlFor={`job-byproduct-product-${line.key}`}>By-Product (stocked)</label>
                      <div className="flex flex-wrap items-start gap-2"><select id={`job-byproduct-product-${line.key}`}
                        value={line.byproductProductId}
                        onChange={(e) => setJobLines((lines) => lines.map((l) => (l.key === line.key ? { ...l, byproductProductId: e.target.value } : l)))}
                        className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground"
                      >
                        <option value="">No by-product</option>
                        {products.filter((p) => p.category === "by_product").map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                      </select> <InlineAdd label="Product" fields={PRODUCT_FIELDS} createAction={async (v) => createProduct({ code: v.code, name: v.name, category: v.category || "raw_seed" })} onCreated={async (id) => { const r = await listProducts(); if (r.success && Array.isArray(r.data)) { const list = r.data as any[]; setProducts(list); } setJobLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, byproductProductId: id } : l))); }} /></div>
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
                  {inlineErr("totals", jobFieldErr)}
                  {inlineErr("total-input", jobFieldErr)}
                  {inlineErr("job-lines", jobFieldErr)}
                  <label className="block font-medium text-foreground mb-1" htmlFor="waste-weight-kg">Waste Weight (kg, job-level — never stocked)</label>
                  <input id="waste-weight-kg"
                    type="number"
                    value={wasteWeight}
                    onChange={(e) => setWasteWeight(Number(e.target.value))}
                    min="0"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="actual-bag-count">Actual Bag Count</label>{inlineErr("bag-count", jobFieldErr)}
                  <input id="actual-bag-count"
                    type="number"
                    value={bagCount}
                    onChange={(e) => setBagCount(Number(e.target.value))}
                    min="0"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Count the bags. Required for per-bag billing.</p>
                </div>

                {rateBasis === "per_maund" && (
                  <div>
                    <label className="block font-medium text-foreground mb-1" htmlFor="kg-per-maund-client-approved">Kg per Maund (client-approved) *</label>{inlineErr("maund-kg", jobFieldErr)}
                    <input id="kg-per-maund-client-approved"
                      type="number"
                      value={maundKg}
                      onChange={(e) => setMaundKg(Number(e.target.value))}
                      min="1"
                      step="0.01"
                      className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                      required
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-muted border border-border">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="rate-basis-formula">Rate Basis (Formula)</label>
                  <select id="rate-basis-formula"
                    value={rateBasis}
                    onChange={(e) => setRateBasis(e.target.value as RateBasis)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="per_50kg">Per 50 kg Bag Basis (Standard)</option>
                    <option value="per_bag">Per Bag Count Basis</option>
                    <option value="per_maund">Per Maund</option>
                    <option value="per_kg">Per Kg</option>
                    <option value="fixed">Fixed Lump-Sum Fee</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="unit-service-rate-pkr">Unit Service Rate (PKR) *</label>{inlineErr("rate", jobFieldErr)}
                  <input id="unit-service-rate-pkr"
                    type="number"
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>
              </div>

              {/* Total Calculation Display */}
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Calculated Service Charge:</span>
                <strong className="text-base text-emerald-600 dark:text-emerald-400 font-mono font-bold">
                  {formatCurrency(serviceCharge)}
                </strong>
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
                  <span>{isPending ? "Saving…" : "Save & Record Service Job"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showConfirm}
        title="Record this machinery job?"
        description={draftJob ? `${draftJob.job_no} for ${draftJob.customer_name || "the customer"}: ${formatWeight(draftJob.input_weight_kg)} in, ${formatWeight(draftJob.output_weight_kg)} of ${draftJob.output_product_name || "output"} out, service charge ${formatCurrency(draftJob.service_charge)}. ${draftJob.is_customer_owned ? "The grain is customer-owned, so company stock is untouched." : "Company-owned input stock is used."}` : ""}
        confirmLabel="Save & Record Service Job"
        pending={isPending}
        onConfirm={handleConfirmJob}
        onCancel={() => { setShowConfirm(false); setDraftJob(null) }}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this draft job?"
        description={deleteTarget ? `${deleteTarget.job_no} never posted, so deleting it changes no stock. Posted jobs cannot be deleted.` : ""}
        confirmLabel="Delete Draft"
        destructive
        pending={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.job_no ?? ""}
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
      {/* Printable Machinery Job Ticket */}
      {selectedJobForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-4 sm:p-8 bg-white text-black shadow-md rounded-md printable-document space-y-6 max-h-[90dvh] overflow-y-auto">
            <MachineryJobPrint
              jobNo={selectedJobForPrint.job_no}
              date={formatDate(selectedJobForPrint.date)}
              status={selectedJobForPrint.status}
              customerName={selectedJobForPrint.customer_name}
              machine={selectedJobForPrint.machine_name}
              godown={selectedJobForPrint.godown_name}
              operator={selectedJobForPrint.operator_name}
              processingType={selectedJobForPrint.processing_type}
              ownership={selectedJobForPrint.is_customer_owned ? "Customer-owned" : "Company-owned"}
              lines={(selectedJobForPrint.machinery_job_lines ?? []).map((l: any) => ({
                inputProduct: l.input_product_name,
                inputQtyKg: l.input_qty_kg,
                outputProduct: l.output_product_name,
                outputQtyKg: l.output_qty_kg,
                byproductProduct: l.byproduct_product_name,
                byproductQtyKg: l.byproduct_qty_kg,
              }))}
              inputProduct={selectedJobForPrint.input_product_name}
              inputWeightKg={selectedJobForPrint.input_weight_kg}
              outputProduct={selectedJobForPrint.output_product_name}
              outputWeightKg={selectedJobForPrint.output_weight_kg}
              byproductProduct={selectedJobForPrint.byproduct_product_name}
              byproductWeightKg={selectedJobForPrint.byproduct_weight_kg}
              wasteKg={selectedJobForPrint.waste_weight_kg}
              rateBasis={selectedJobForPrint.rate_basis?.replace("_", " ")}
              rate={selectedJobForPrint.rate}
              serviceCharge={selectedJobForPrint.service_charge}
              notes={selectedJobForPrint.notes}
            />
            <div className="flex items-center justify-end gap-3 pt-4 border-t no-print">
              <button
                type="button"
                onClick={() => setSelectedJobForPrint(null)}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              <PrintButton label="Print Ticket" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold cursor-pointer" />
            </div>
          </div>
        </div>
      )}
      {selectedJobForPrint && (
        <div className="hidden print:block">
          <MachineryJobPrint
            jobNo={selectedJobForPrint.job_no}
            date={formatDate(selectedJobForPrint.date)}
            status={selectedJobForPrint.status}
            customerName={selectedJobForPrint.customer_name}
            machine={selectedJobForPrint.machine_name}
            godown={selectedJobForPrint.godown_name}
            operator={selectedJobForPrint.operator_name}
            processingType={selectedJobForPrint.processing_type}
            ownership={selectedJobForPrint.is_customer_owned ? "Customer-owned" : "Company-owned"}
            lines={(selectedJobForPrint.machinery_job_lines ?? []).map((l: any) => ({
              inputProduct: l.input_product_name,
              inputQtyKg: l.input_qty_kg,
              outputProduct: l.output_product_name,
              outputQtyKg: l.output_qty_kg,
              byproductProduct: l.byproduct_product_name,
              byproductQtyKg: l.byproduct_qty_kg,
            }))}
            inputProduct={selectedJobForPrint.input_product_name}
            inputWeightKg={selectedJobForPrint.input_weight_kg}
            outputProduct={selectedJobForPrint.output_product_name}
            outputWeightKg={selectedJobForPrint.output_weight_kg}
            byproductProduct={selectedJobForPrint.byproduct_product_name}
            byproductWeightKg={selectedJobForPrint.byproduct_weight_kg}
            wasteKg={selectedJobForPrint.waste_weight_kg}
            rateBasis={selectedJobForPrint.rate_basis?.replace("_", " ")}
            rate={selectedJobForPrint.rate}
            serviceCharge={selectedJobForPrint.service_charge}
            notes={selectedJobForPrint.notes}
          />
        </div>
      )}
    </div>
  )
}
