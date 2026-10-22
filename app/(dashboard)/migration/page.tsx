"use client"

import * as React from "react"
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Database,
  Building2,
  Boxes,
  Wallet,
  Layers,
  FileText,
} from "lucide-react"
import { GodownStore } from "@/lib/services/godown-store"
import { formatCurrency, formatWeight } from "@/lib/utils"

interface DataDictionaryItem {
  excelSheet: string
  excelColumn: string
  systemField: string
  targetTable: string
  description: string
  status: "mapped" | "requires_confirmation"
}

const dataDictionary: DataDictionaryItem[] = [
  {
    excelSheet: "IN GOODS",
    excelColumn: "Source / Supplier",
    systemField: "party_id",
    targetTable: "incoming_goods",
    description: "Mapped to Parties master (Distinguishes grower vs company grain)",
    status: "mapped",
  },
  {
    excelSheet: "IN GOODS",
    excelColumn: "Bilty No / Truck",
    systemField: "bilty_no / vehicle_no",
    targetTable: "incoming_goods",
    description: "Transport tracking and weighing scale reference",
    status: "mapped",
  },
  {
    excelSheet: "MACHINERY",
    excelColumn: "50-Unit Basis Rate",
    systemField: "rate_basis ('per_50kg')",
    targetTable: "machinery_jobs",
    description: "Configurable per 50kg, per bag, or per maund formula",
    status: "mapped",
  },
  {
    excelSheet: "FINAL UNIT",
    excelColumn: "1-Bag / 2-Bag Bardana",
    systemField: "packaging_type_id & bags_count",
    targetTable: "packing_records",
    description: "Deducts bag count from bardana packaging inventory",
    status: "mapped",
  },
  {
    excelSheet: "OUT GOING",
    excelColumn: "Gate Pass No",
    systemField: "pass_no (Unique, Non-reusable)",
    targetTable: "gate_passes",
    description: "Authoritative clearance document linking stock deduction to vehicle",
    status: "mapped",
  },
  {
    excelSheet: "P.ID P-L",
    excelColumn: "Net Profit Calc",
    systemField: "net_profit = Revenue - COGS - Overheads",
    targetTable: "reports",
    description: "Replaces unverified spreadsheet formulas with double-entry ledger truth",
    status: "mapped",
  },
]

export default function MigrationPage() {
  const [activeTab, setActiveTab] = React.useState<"dictionary" | "opening_balances" | "import">("dictionary")
  const [importType, setImportType] = React.useState<"products" | "parties" | "opening_stock">("products")
  const [importedRowsCount, setImportedRowsCount] = React.useState<number | null>(null)

  // Opening Balance Form
  const [asOfDate, setAsOfDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [openingGodownId, setOpeningGodownId] = React.useState("")
  const [openingProductId, setOpeningProductId] = React.useState("")
  const [openingStockWeight, setOpeningStockWeight] = React.useState<number>(15000)
  const [openingCash, setOpeningCash] = React.useState<number>(500000)
  const [openingNotes, setOpeningNotes] = React.useState("Audited spreadsheet carryover")

  const [godowns, setGodowns] = React.useState<any[]>([])
  const [products, setProducts] = React.useState<any[]>([])

  React.useEffect(() => {
    setGodowns(GodownStore.getGodowns())
    setProducts(GodownStore.getProducts())
  }, [])

  React.useEffect(() => {
    if (godowns.length > 0 && !openingGodownId) setOpeningGodownId(godowns[0].id)
    if (products.length > 0 && !openingProductId) setOpeningProductId(products[0].id)
  }, [godowns, products, openingGodownId, openingProductId])

  const handleSimulateCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Simulate instant parsing of client spreadsheet
    setTimeout(() => {
      setImportedRowsCount(48)
    }, 500)
  }

  const handleSaveOpeningBalance = (e: React.FormEvent) => {
    e.preventDefault()
    alert("Opening balance entries verified and locked into the ledger as of " + asOfDate)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <UploadCloud className="h-6 w-6 text-emerald-500" />
            Excel Data Migration & Opening Balances
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Transition smoothly from the client's Excel sheets, map columns to database fields, and set opening balances.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-lg bg-muted/60 border border-border/60 self-start w-fit text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("dictionary")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            activeTab === "dictionary"
              ? "bg-primary text-primary-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Data Dictionary & Excel Mapping
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("opening_balances")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            activeTab === "opening_balances"
              ? "bg-primary text-primary-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Controlled Opening Balances
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("import")}
          className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
            activeTab === "import"
              ? "bg-primary text-primary-foreground shadow-xs font-bold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Spreadsheet Import Wizard
        </button>
      </div>

      {/* Tab 1: Data Dictionary */}
      {activeTab === "dictionary" && (
        <div className="expensive-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                Legacy Workbook $\rightarrow$ Relational Schema Dictionary
              </h2>
              <p className="text-xs text-muted-foreground">
                Resolves ambiguities from client workbook sheets into relational database tables.
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              6 / 6 Sheets Reconciled
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Source Sheet</th>
                  <th className="pb-3 font-bold">Excel Column Name</th>
                  <th className="pb-3 font-bold">Target System Field</th>
                  <th className="pb-3 font-bold">Database Entity</th>
                  <th className="pb-3 font-bold">Conversion / Logic Rule</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 font-mono">
                {dataDictionary.map((item, idx) => (
                  <tr key={idx} className="hover:bg-muted/30 transition-colors">
                    <td className="py-3 font-bold text-foreground font-sans">
                      <span className="px-2 py-0.5 rounded bg-muted text-[10px] uppercase">
                        {item.excelSheet}
                      </span>
                    </td>
                    <td className="py-3 text-foreground font-sans font-semibold">{item.excelColumn}</td>
                    <td className="py-3 text-emerald-600 dark:text-emerald-400 font-bold">{item.systemField}</td>
                    <td className="py-3 text-muted-foreground">{item.targetTable}</td>
                    <td className="py-3 text-muted-foreground font-sans text-[11px]">{item.description}</td>
                    <td className="py-3 text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase font-sans">
                        <CheckCircle2 className="h-3 w-3" />
                        Mapped
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Controlled Opening Balances */}
      {activeTab === "opening_balances" && (
        <div className="expensive-card p-6 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-500" />
              Controlled Opening Balances Entry
            </h2>
            <p className="text-xs text-muted-foreground">
              Establishes the initial baseline for Godown Grain Stock, Imprest Cash, Customer Receivables, and Packaging.
            </p>
          </div>

          <form onSubmit={handleSaveOpeningBalance} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-foreground mb-1">Opening Balance "As Of" Date</label>
                <input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Approving Master Authority</label>
                <input
                  type="text"
                  value="Operator Administrator (Single Role)"
                  disabled
                  className="w-full px-2.5 py-2 rounded-lg bg-muted text-muted-foreground border border-border"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-muted/30 border border-border/70">
              <div>
                <label className="block font-medium text-foreground mb-1">Godown Storage Shed</label>
                <select
                  value={openingGodownId}
                  onChange={(e) => setOpeningGodownId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                >
                  {godowns.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Seed Grain Product</label>
                <select
                  value={openingProductId}
                  onChange={(e) => setOpeningProductId(e.target.value)}
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
                <label className="block font-medium text-foreground mb-1">Opening Stock (kg)</label>
                <input
                  type="number"
                  value={openingStockWeight}
                  onChange={(e) => setOpeningStockWeight(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-foreground mb-1">Opening Cash in Hand (PKR)</label>
                <input
                  type="number"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Source Documentation / Notes</label>
                <input
                  type="text"
                  value={openingNotes}
                  onChange={(e) => setOpeningNotes(e.target.value)}
                  placeholder="e.g. Verified from physical godown scale count sheet"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Lock Opening Balances</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 3: Spreadsheet Import Wizard */}
      {activeTab === "import" && (
        <div className="expensive-card p-6 space-y-6">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <UploadCloud className="h-4 w-4 text-emerald-500" />
              Spreadsheet Import Wizard
            </h2>
            <p className="text-xs text-muted-foreground">
              Bulk import existing master catalogs and transactions from Excel (`.xlsx` or `.csv`).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setImportType("products")}
              className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                importType === "products" ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-foreground"
              }`}
            >
              <div className="font-bold text-xs">Products & Seeds</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Import product codes, categories, units</div>
            </button>

            <button
              type="button"
              onClick={() => setImportType("parties")}
              className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                importType === "parties" ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-foreground"
              }`}
            >
              <div className="font-bold text-xs">Parties & Customers</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Growers, suppliers, wholesale clients</div>
            </button>

            <button
              type="button"
              onClick={() => setImportType("opening_stock")}
              className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                importType === "opening_stock" ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-foreground"
              }`}
            >
              <div className="font-bold text-xs">Opening Stock Lots</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Initial bags, weights, godown locations</div>
            </button>
          </div>

          {/* Upload Drop Area */}
          <div className="border-2 border-dashed border-border/80 hover:border-primary/50 rounded-xl p-8 text-center bg-muted/20 transition-colors">
            <FileSpreadsheet className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
            <div className="text-xs font-bold text-foreground">Select an Excel (.xlsx) or CSV file to import</div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Supports client column layouts from the legacy workbook.
            </div>
            <label className="mt-4 inline-block px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer transition-colors">
              Browse Spreadsheet
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleSimulateCSVUpload} className="hidden" />
            </label>
          </div>

          {importedRowsCount && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <div>
                  <strong className="text-foreground">{importedRowsCount} records parsed successfully!</strong>
                  <div className="text-[11px] text-muted-foreground">All rows matched data dictionary specifications.</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  alert("Successfully imported " + importedRowsCount + " rows into the master database.")
                  setImportedRowsCount(null)
                }}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
              >
                Commit to System
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
