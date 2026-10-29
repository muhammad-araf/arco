"use client"

import { postToken } from "@/lib/idempotency"

import * as React from "react"
import {
  Cog,
  Plus,
  Printer,
} from "lucide-react"
import { listJobs, getJob, postJob, reverseJob, deleteJobDraft, getMachineryInitData } from "@/app/actions/machinery"
import { listMachines, listParties, listProducts, listGodowns } from "@/app/actions/masters"
import { listProcessingTypes } from "@/app/actions/processing-types"
import { MachineryJobPrint } from "@/components/print/machinery-job-print"
import { PrintButton } from "@/components/print/print-button"
import { MachineryJob, Machine, Party, Product } from "@/lib/types/database"
import { formatCurrency, formatWeight, formatDate } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  ReversalDialog,
} from "@/components/erp-ui"
import { MachineryJobDialog } from "@/components/machinery-job-dialog"
import { MachinerySkeleton } from "@/components/route-skeletons"

export default function MachineryJobsPage() {
  const [jobs, setJobs] = React.useState<MachineryJob[]>([])
  const [machines, setMachines] = React.useState<Machine[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [godowns, setGodowns] = React.useState<any[]>([])
  const [reversalTarget, setReversalTarget] = React.useState<any | null>(null)
  const [isReversing, setIsReversing] = React.useState(false)

  // Modal State
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [deleteTarget, setDeleteTarget] = React.useState<any | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [isPostingDraft, setIsPostingDraft] = React.useState(false)
  const [processingTypes, setProcessingTypes] = React.useState<string[]>([])
  const [selectedJobForPrint, setSelectedJobForPrint] = React.useState<any | null>(null)

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const initRes = await getMachineryInitData()
      if (!initRes.success) {
        setFormError(initRes.error ?? "Could not load machinery data.")
        return
      }
      const data = initRes.data as any
      setProcessingTypes(Array.isArray(data.processingTypes) ? data.processingTypes : [])
      const machineList = (Array.isArray(data.machines) ? data.machines : []) as Machine[]
      const partyList = (Array.isArray(data.parties) ? data.parties : []) as Party[]
      const productList = (Array.isArray(data.products) ? data.products : []) as Product[]
      setMachines(machineList); setCustomers(partyList.filter((x) => x.type === "customer" || x.type === "both")); setProducts(productList)
      setGodowns(Array.isArray(data.godowns) ? data.godowns : [])
      const jList = Array.isArray(data.jobs) ? data.jobs : []
      setJobs(jList.map((row: any) => ({
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

      <MachineryJobDialog
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        machines={machines}
        customers={customers}
        products={products}
        godowns={godowns}
        processingTypes={processingTypes}
        recordCount={jobs.length}
        onPosted={async (notice, jobId) => {
          setFormNotice(notice)
          await loadData()
          await handlePrintJob({ id: jobId })
        }}
        onDraftSaved={(notice) => {
          setFormNotice(notice)
          void loadData()
        }}
        onRefresh={() => void loadData()}
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
