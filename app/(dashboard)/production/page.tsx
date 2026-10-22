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

export default function ProductionPage() {
  const [batches, setBatches] = React.useState<ProductionBatch[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [products, setProducts] = React.useState<Product[]>([])
  const [machines, setMachines] = React.useState<Machine[]>([])

  // Modal State
  const [isBatchModalOpen, setIsBatchModalOpen] = React.useState(false)
  const [selectedBatchForPrint, setSelectedBatchForPrint] = React.useState<ProductionBatch | null>(null)

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
    if (!machineId || !godownId || !inputProductId || !outputProductId) return

    if (inputWeightKg > availableInputStock) {
      alert(`Insufficient input stock in godown. Available: ${availableInputStock} kg`)
      return
    }

    const selectedMachine = machines.find((m) => m.id === machineId)
    const selectedGodown = godowns.find((g) => g.id === godownId)
    const batchNo = `BAT-2026-${String(batches.length + 1).padStart(3, "0")}`

    const newBatch: ProductionBatch = {
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
    }

    GodownStore.postProductionBatch(newBatch, inputProductId, outputProductId, byProductId)
    setIsBatchModalOpen(false)
    setSelectedBatchForPrint(newBatch)
  }

  return (
    <div className="space-y-6">
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
            Executed Processing Batches ({batches.length})
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
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                  <td className="py-3 font-bold text-foreground">
                    <div className="flex items-center gap-1.5">
                      <span>{b.batch_no}</span>
                      <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold uppercase">
                        Posted
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
                    <button
                      type="button"
                      onClick={() => setSelectedBatchForPrint(b)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title="Print Production Batch Sheet"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
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
          <div className="expensive-card w-full max-w-2xl p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 my-8">
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

                <div className="grid grid-cols-2 gap-3 pt-1">
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
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Post Batch Run & Update Ledgers</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Batch Run Sheet */}
      {selectedBatchForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs overflow-y-auto">
          <div className="expensive-card w-full max-w-2xl p-8 bg-white text-black shadow-2xl rounded-xl printable-document space-y-6">
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
    </div>
  )
}
