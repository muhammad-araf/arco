"use client"

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
import { listJobs, createJobDraft, postJob, reverseJob } from "@/app/actions/machinery"
import { listMachines, listParties, listProducts, listGodowns } from "@/app/actions/masters"
import { MachineryJob, Machine, Party, Product, RateBasis } from "@/lib/types/database"
import { formatCurrency, formatWeight, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  PageSkeleton,
  ReversalDialog,
  SubmitSpinner,
  isPositive,
} from "@/components/erp-ui"

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
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftJob, setDraftJob] = React.useState<MachineryJob | null>(null)
  const jobGuard = React.useRef(false)
  const [customerId, setCustomerId] = React.useState("")
  const [machineId, setMachineId] = React.useState("")
  const [processingType, setProcessingType] = React.useState("Grading & Cleaning")
  const [inputProductId, setInputProductId] = React.useState("")
  const [inputWeight, setInputWeight] = React.useState<number>(5000)
  const [outputWeight, setOutputWeight] = React.useState<number>(4600)
  const [wasteWeight, setWasteWeight] = React.useState<number>(400)
  const [rateBasis, setRateBasis] = React.useState<RateBasis>("per_50kg")
  const [rate, setRate] = React.useState<number>(85)
  const [isCustomerOwned, setIsCustomerOwned] = React.useState(true)
  const [notes, setNotes] = React.useState("")

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [j, m, pa, pr, g] = await Promise.all([listJobs(), listMachines(), listParties(), listProducts(), listGodowns()])
      const failed = [j, m, pa, pr, g].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load machinery data.")
      const machineList = (Array.isArray(m.data) ? m.data : []) as Machine[]
      const partyList = (Array.isArray(pa.data) ? pa.data : []) as Party[]
      const productList = (Array.isArray(pr.data) ? pr.data : []) as Product[]
      setMachines(machineList); setCustomers(partyList.filter((x) => x.type === "customer" || x.type === "both")); setProducts(productList)
      setGodowns(Array.isArray(g.data) ? g.data : [])
      setJobs((Array.isArray(j.data) ? j.data : []).map((row: any) => ({
        ...row,
        customer_name: partyList.find((x) => x.id === row.customer_id)?.name ?? row.customer_id,
        machine_name: machineList.find((x) => x.id === row.machine_id)?.name ?? row.machine_id,
        input_product_name: productList.find((x) => x.id === row.input_product_id)?.name ?? row.input_product_id,
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
    if (products.length > 0 && !inputProductId) setInputProductId(products[0].id)
    if (godowns.length > 0 && !godownId) setGodownId(godowns[0].id)
  }, [machines, customers, products, godowns, machineId, customerId, inputProductId, godownId])

  // Calculation based on Rate Basis
  let calculatedUnits = 0
  if (rateBasis === "per_50kg") calculatedUnits = inputWeight / 50
  else if (rateBasis === "per_bag") calculatedUnits = Math.round(inputWeight / 50)
  else if (rateBasis === "per_maund") calculatedUnits = inputWeight / 40
  else if (rateBasis === "per_kg") calculatedUnits = inputWeight
  else calculatedUnits = 1 // fixed

  const serviceCharge = Math.round(calculatedUnits * rate)

  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §7: required fields, positive weights, non-negative waste and
    // rate — output + waste may not exceed input for a grading job.
    if (!customerId) return setFormError("Select the customer / grain owner for this job.")
    if (!machineId) return setFormError("Select the machine that will run this job.")
    if (!inputProductId) return setFormError("Select the input product.")
    if (!godownId) return setFormError("Select the godown where this job runs.")
    if (!isPositive(inputWeight)) return setFormError("Input weight must be greater than zero.")
    if (outputWeight < 0 || wasteWeight < 0) return setFormError("Output and waste weights cannot be negative.")
    if (outputWeight + wasteWeight > inputWeight) return setFormError(`Output (${outputWeight} kg) + waste (${wasteWeight} kg) exceeds input (${inputWeight} kg). Correct the weights before saving.`)
    if (rate < 0) return setFormError("Rate cannot be negative.")
    setFormError("")
    const selectedCust = customers.find((c) => c.id === customerId)
    const selectedMach = machines.find((m) => m.id === machineId)
    const selectedProd = products.find((p) => p.id === inputProductId)
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
      input_product_id: inputProductId,
      input_product_name: selectedProd?.name,
      input_weight_kg: inputWeight,
      output_weight_kg: outputWeight,
      waste_weight_kg: wasteWeight,
      rate_basis: rateBasis,
      rate,
      service_charge: serviceCharge,
      is_customer_owned: isCustomerOwned,
      status: "posted",
      payment_status: "unbilled",
      notes: notes || undefined,
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const handleConfirmJob = async () => {
    if (!draftJob || jobGuard.current) return
    jobGuard.current = true
    setIsPending(true)
    try {
      const created = await createJobDraft({
        customerId, machineId, godownId, processingType,
        inputProductId, inputWeightKg: inputWeight, outputWeightKg: outputWeight, wasteWeightKg: wasteWeight,
        bags: rateBasis === "per_bag" ? Math.round(inputWeight / 50) : undefined,
        rateBasis, rate, isCustomerOwned, notes: notes || undefined,
      })
      if (!created.success || !(created.data as any)?.id) {
        setFormError(created.error ?? "Could not create the machinery job draft.")
        return
      }
      const posted = await postJob((created.data as any).id, `job-${Date.now()}`)
      if (!posted.success) {
        setFormError(posted.error ?? "Could not post the machinery job.")
        return
      }
      const row: any = posted.data ?? created.data
      setFormNotice(`${row.job_no ?? draftJob.job_no} recorded — service charge ${formatCurrency(row.service_charge ?? draftJob.service_charge)} (${draftJob.rate_basis.replace("_", " ")}). Customer-owned stock is not counted as company inventory.`)
      setShowConfirm(false)
      setIsModalOpen(false)
      setDraftJob(null)
      await loadData()
    } finally {
      setIsPending(false)
      jobGuard.current = false
    }
  }

  const handleConfirmReversal = async (reasonCode: string, reason: string) => {
    if (!reversalTarget || isReversing) return
    setIsReversing(true)
    try {
      const res = await reverseJob(reversalTarget.id, `${reasonCode}: ${reason}`, `job-rev-${Date.now()}`)
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

  if (isLoading) return <PageSkeleton />

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
          <table className="w-full text-left border-collapse text-xs">
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
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase">
                      {j.status ?? "Posted"}
                    </span>
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
          <div className="expensive-card w-full max-w-xl p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
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
                  <label className="block font-medium text-foreground mb-1">Customer / Grain Owner</label>
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Machine Cleaner / Grader</label>
                  <select
                    value={machineId}
                    onChange={(e) => setMachineId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                    required
                  >
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Godown</label>
                  <select value={godownId} onChange={(e) => setGodownId(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
                    {godowns.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1">Input Grain Type</label>
                  <select
                    value={inputProductId}
                    onChange={(e) => setInputProductId(e.target.value)}
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
                  <label className="block font-medium text-foreground mb-1">Total Grain Weight (kg)</label>
                  <input
                    type="number"
                    value={inputWeight}
                    onChange={(e) => setInputWeight(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Graded Output (kg)</label>
                  <input
                    type="number"
                    value={outputWeight}
                    onChange={(e) => setOutputWeight(Number(e.target.value))}
                    min="0"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-muted border border-border">
                <div>
                  <label className="block font-medium text-foreground mb-1">Rate Basis (Formula)</label>
                  <select
                    value={rateBasis}
                    onChange={(e) => setRateBasis(e.target.value as RateBasis)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="per_50kg">Per 50 kg Bag Basis (Standard)</option>
                    <option value="per_bag">Per Bag Count Basis</option>
                    <option value="per_maund">Per Maund (40 kg)</option>
                    <option value="per_kg">Per Kg</option>
                    <option value="fixed">Fixed Lump-Sum Fee</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Unit Service Rate (PKR)</label>
                  <input
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
        description={draftJob ? `${draftJob.job_no} for ${draftJob.customer_name || "the customer"}: ${formatWeight(draftJob.input_weight_kg)} in, ${formatWeight(draftJob.output_weight_kg)} out, service charge ${formatCurrency(draftJob.service_charge)}. ${draftJob.is_customer_owned ? "The grain is customer-owned, so company stock is untouched." : "Company-owned input stock is used."}` : ""}
        confirmLabel="Save & Record Service Job"
        pending={isPending}
        onConfirm={handleConfirmJob}
        onCancel={() => { setShowConfirm(false); setDraftJob(null) }}
      />
      <ReversalDialog
        open={!!reversalTarget}
        voucherLabel={reversalTarget?.job_no ?? ""}
        pending={isReversing}
        onConfirm={handleConfirmReversal}
        onCancel={() => setReversalTarget(null)}
      />
    </div>
  )
}
