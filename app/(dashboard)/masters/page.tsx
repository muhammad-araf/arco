"use client"

import * as React from "react"
import {
  Database,
  Plus,
  Warehouse,
  Package,
  Building2,
  Cog,
  CheckCircle2,
  Trash2,
} from "lucide-react"
import { GodownStore } from "@/lib/services/godown-store"
import { Product, Godown, Party, Machine } from "@/lib/types/database"
import { formatCurrency, formatWeight } from "@/lib/utils"

export default function MastersPage() {
  const [activeTab, setActiveTab] = React.useState<"products" | "godowns" | "parties" | "machines">("products")
  const [products, setProducts] = React.useState<Product[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [parties, setParties] = React.useState<Party[]>([])
  const [machines, setMachines] = React.useState<Machine[]>([])

  // New Product Form
  const [isNewProdOpen, setIsNewProdOpen] = React.useState(false)
  const [prodName, setProdName] = React.useState("")
  const [prodCategory, setProdCategory] = React.useState<any>("raw_seed")
  const [prodMinStock, setProdMinStock] = React.useState<number>(2000)
  const [weightPerBag, setWeightPerBag] = React.useState<number>(50)

  const loadData = React.useCallback(() => {
    setProducts(GodownStore.getProducts())
    setGodowns(GodownStore.getGodowns())
    setParties(GodownStore.getParties())
    setMachines(GodownStore.getMachines())
  }, [])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault()
    if (!prodName) return

    const newProd: Product = {
      id: `prod-${Date.now()}`,
      code: `PRD-${Date.now().toString().slice(-4)}`,
      name: prodName,
      category: prodCategory,
      default_unit: "kg",
      weight_per_bag: weightPerBag,
      min_stock: prodMinStock,
      is_active: true,
      created_at: new Date().toISOString(),
    }

    const state = (GodownStore as any).getState()
    state.products = [...state.products, newProd]
    ;(GodownStore as any).saveState(state)

    setProducts(state.products)
    setIsNewProdOpen(false)
    setProdName("")
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Database className="h-6 w-6 text-emerald-500" />
            Master Data & Godown Configurations
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure primary entities: Seed Products, Godown Locations, Parties (Growers & Clients), and Machinery.
          </p>
        </div>

        {activeTab === "products" && (
          <button
            type="button"
            onClick={() => setIsNewProdOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Add New Product</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-lg bg-muted/60 border border-border/60 self-start w-fit text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("products")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            activeTab === "products" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          <span>Products ({products.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("godowns")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            activeTab === "godowns" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Warehouse className="h-3.5 w-3.5" />
          <span>Godowns ({godowns.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("parties")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            activeTab === "parties" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span>Parties & Clients ({parties.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("machines")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            activeTab === "machines" ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Cog className="h-3.5 w-3.5" />
          <span>Machinery Plants ({machines.length})</span>
        </button>
      </div>

      {/* Tab: Products */}
      {activeTab === "products" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Code</th>
                  <th className="pb-3 font-bold">Product Name</th>
                  <th className="pb-3 font-bold">Category</th>
                  <th className="pb-3 font-bold">Unit</th>
                  <th className="pb-3 font-bold text-right">Standard Bag Wt</th>
                  <th className="pb-3 font-bold text-right">Safety Stock</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{p.code}</td>
                    <td className="py-3 font-bold text-foreground">{p.name}</td>
                    <td className="py-3 text-muted-foreground capitalize">{p.category.replace("_", " ")}</td>
                    <td className="py-3 font-mono text-muted-foreground uppercase">{p.default_unit}</td>
                    <td className="py-3 text-right font-mono text-foreground">{p.weight_per_bag || 50} kg</td>
                    <td className="py-3 text-right font-mono font-bold text-foreground">{formatWeight(p.min_stock || 0)}</td>
                    <td className="py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Godowns */}
      {activeTab === "godowns" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Godown Code</th>
                  <th className="pb-3 font-bold">Name & Description</th>
                  <th className="pb-3 font-bold">Address / Compound</th>
                  <th className="pb-3 font-bold text-right">Capacity (MT)</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {godowns.map((g) => (
                  <tr key={g.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">{g.code}</td>
                    <td className="py-3 font-bold text-foreground">{g.name}</td>
                    <td className="py-3 text-muted-foreground">{g.address}</td>
                    <td className="py-3 text-right font-mono font-black text-foreground">{g.capacity_metric_tons} MT</td>
                    <td className="py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase">
                        Operational
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Parties */}
      {activeTab === "parties" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Party Code</th>
                  <th className="pb-3 font-bold">Full Name</th>
                  <th className="pb-3 font-bold">Role Type</th>
                  <th className="pb-3 font-bold">Phone Number</th>
                  <th className="pb-3 font-bold text-right">Opening Balance</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {parties.map((pty) => (
                  <tr key={pty.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{pty.code}</td>
                    <td className="py-3 font-bold text-foreground">
                      <div>{pty.name}</div>
                      {pty.contact_person && <div className="text-[10px] text-muted-foreground">Attn: {pty.contact_person}</div>}
                    </td>
                    <td className="py-3 text-muted-foreground capitalize">
                      <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-bold uppercase">
                        {pty.type}
                      </span>
                    </td>
                    <td className="py-3 font-mono text-muted-foreground">{pty.phone || "-"}</td>
                    <td className="py-3 text-right font-mono font-bold text-foreground">
                      {formatCurrency(pty.opening_balance)} ({pty.balance_type})
                    </td>
                    <td className="py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Machines */}
      {activeTab === "machines" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Plant Code</th>
                  <th className="pb-3 font-bold">Machine Name</th>
                  <th className="pb-3 font-bold">Processing Type</th>
                  <th className="pb-3 font-bold text-right">Throughput (kg/hr)</th>
                  <th className="pb-3 font-bold">Assigned Operator</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {machines.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{m.code}</td>
                    <td className="py-3 font-bold text-foreground">{m.name}</td>
                    <td className="py-3 text-muted-foreground">{m.processing_type}</td>
                    <td className="py-3 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">
                      {m.capacity_kg_per_hour?.toLocaleString()} kg/hr
                    </td>
                    <td className="py-3 text-foreground font-semibold">{m.operator_name || "Plant Master"}</td>
                    <td className="py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase">
                        Ready
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Product Modal */}
      {isNewProdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Package className="h-4 w-4 text-emerald-500" />
                Add Product Master
              </h3>
              <button
                type="button"
                onClick={() => setIsNewProdOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddProduct} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-foreground mb-1">Product Title</label>
                <input
                  type="text"
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="e.g. Graded Hybrid Corn (DK-6789)"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Category</label>
                  <select
                    value={prodCategory}
                    onChange={(e) => setProdCategory(e.target.value as any)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="raw_seed">Raw Seed</option>
                    <option value="finished_seed">Finished Seed</option>
                    <option value="intermediate">Intermediate / Grading</option>
                    <option value="by_product">By-Product (Phok/Chhilka)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Standard Bag (kg)</label>
                  <input
                    type="number"
                    value={weightPerBag}
                    onChange={(e) => setWeightPerBag(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Minimum Safety Stock (kg)</label>
                <input
                  type="number"
                  value={prodMinStock}
                  onChange={(e) => setProdMinStock(Number(e.target.value))}
                  min="0"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewProdOpen(false)}
                  className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Create Product</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
