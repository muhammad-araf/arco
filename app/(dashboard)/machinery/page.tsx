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
import { GodownStore } from "@/lib/services/godown-store"
import { MachineryJob, Machine, Party, Product, RateBasis } from "@/lib/types/database"
import { formatCurrency, formatWeight, formatDate } from "@/lib/utils"

export default function MachineryJobsPage() {
  const [jobs, setJobs] = React.useState<MachineryJob[]>([])
  const [machines, setMachines] = React.useState<Machine[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])
  const [products, setProducts] = React.useState<Product[]>([])

  // Modal State
  const [isModalOpen, setIsModalOpen] = React.useState(false)
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

  const loadData = React.useCallback(() => {
    setJobs(GodownStore.getMachineryJobs())
    setMachines(GodownStore.getMachines())
    setCustomers(GodownStore.getParties().filter((p) => p.type === "customer" || p.type === "both"))
    setProducts(GodownStore.getProducts())
  }, [])

  React.useEffect(() => {
    loadData()
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

  React.useEffect(() => {
    if (machines.length > 0 && !machineId) setMachineId(machines[0].id)
    if (customers.length > 0 && !customerId) setCustomerId(customers[0].id)
    if (products.length > 0 && !inputProductId) setInputProductId(products[0].id)
  }, [machines, customers, products, machineId, customerId, inputProductId])

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
    if (!customerId || !machineId || !inputProductId) return

    const selectedCust = customers.find((c) => c.id === customerId)
    const selectedMach = machines.find((m) => m.id === machineId)
    const selectedProd = products.find((p) => p.id === inputProductId)
    const jobNo = `JOB-2026-${String(jobs.length + 1).padStart(3, "0")}`

    const newJob: MachineryJob = {
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
    }

    const state = (GodownStore as any).getState()
    state.machineryJobs = [newJob, ...state.machineryJobs]
    ;(GodownStore as any).saveState(state)

    setIsModalOpen(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Cog className="h-6 w-6 text-emerald-500" />
            Machinery Processing Jobs & Customer Services
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Process customer-owned seed, apply rate bases (per 50kg, per bag, maund, or fixed), and calculate service charges.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>New Machinery Service Job</span>
        </button>
      </div>

      {/* Jobs Table */}
      <div className="expensive-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Cog className="h-4 w-4 text-emerald-500" />
            Completed Machinery Service Jobs ({jobs.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
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
            <tbody className="divide-y divide-border/40">
              {jobs.map((j) => (
                <tr key={j.id} className="hover:bg-muted/30 transition-colors">
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
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase">
                      Posted
                    </span>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted-foreground">
                    No machinery jobs recorded yet. Click "New Machinery Service Job" to log processing.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="expensive-card w-full max-w-xl p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-muted/40 border border-border">
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
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Save & Record Service Job</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
