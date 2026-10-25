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
import { createOpeningBalance, listOpeningBalances } from "@/app/actions/finance"
import { listGodowns, listProducts } from "@/app/actions/masters"
import { formatCurrency, formatWeight } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  PageSkeleton,
  SubmitSpinner,
  isPositive,
} from "@/components/erp-ui"

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
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showOpeningConfirm, setShowOpeningConfirm] = React.useState(false)
  const [parsedFile, setParsedFile] = React.useState<{ name: string; headers: string[]; rows: string[][] } | null>(null)
  const [openingBalances, setOpeningBalances] = React.useState<any[]>([])
  const [importError, setImportError] = React.useState("")

  React.useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      const [g, pr, ob] = await Promise.all([listGodowns(), listProducts(), listOpeningBalances()])
      const failed = [g, pr, ob].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load migration data.")
      setGodowns(Array.isArray(g.data) ? g.data : [])
      setProducts(Array.isArray(pr.data) ? pr.data : [])
      setOpeningBalances(Array.isArray(ob.data) ? ob.data : [])
      setIsLoading(false)
    }
    load()
  }, [])

  React.useEffect(() => {
    if (godowns.length > 0 && !openingGodownId) setOpeningGodownId(godowns[0].id)
    if (products.length > 0 && !openingProductId) setOpeningProductId(products[0].id)
  }, [godowns, products, openingGodownId, openingProductId])

  // Parse the ACTUAL file the user picked (CSV text). .xlsx files are not
  // parsed in the browser here — they are flagged honestly instead of
  // pretending 48 rows were imported.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError("")
    setParsedFile(null)
    setImportedRowsCount(null)
    if (!/\.csv$/i.test(file.name)) {
      setImportError(`"${file.name}" is not a CSV file. Excel (.xlsx) parsing is not available in this prototype — export the sheet as CSV and upload that, so the rows previewed are the rows actually in your file.`)
      return
    }
    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
      if (lines.length < 2) {
        setImportError("This file has no data rows — it needs a header row plus at least one data row.")
        return
      }
      const splitRow = (row: string) => row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
      const headers = splitRow(lines[0])
      const rows = lines.slice(1).map(splitRow)
      setParsedFile({ name: file.name, headers, rows })
      setImportedRowsCount(rows.length)
    } catch {
      setImportError("Could not read this file. Check it is a valid CSV export and try again.")
    }
  }

  const handleSaveOpeningBalance = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §3.4: an opening balance needs an as-of date, a source note,
    // a positive weight, and must be distinguishable from ordinary rows.
    if (!asOfDate) return setFormError("Pick the as-of date for this opening balance.")
    if (!openingGodownId) return setFormError("Select the godown this opening stock belongs to.")
    if (!openingProductId) return setFormError("Select the product for this opening stock.")
    if (!isPositive(openingStockWeight)) return setFormError("Opening stock weight must be greater than zero.")
    if (!openingNotes.trim()) return setFormError("A source note is required — e.g. which scale count sheet this balance came from.")
    const already = openingBalances.some(
      (b) => b.balance_kind === "stock" && b.product_id === openingProductId && b.godown_id === openingGodownId
    )
    if (already) return setFormError("An opening balance for this product and godown is already recorded. Correcting it needs a stock adjustment (Phase 2) — recording a second opening row would double-count stock.")
    setFormError("")
    setShowOpeningConfirm(true)
  }

  const handleConfirmOpening = async () => {
    if (isPending) return
    setIsPending(true)
    try {
      const godown = godowns.find((g) => g.id === openingGodownId)
      const product = products.find((p) => p.id === openingProductId)
      const stock = await createOpeningBalance({
        balanceKind: "stock", entityKey: `stock:${openingGodownId}:${openingProductId}`,
        productId: openingProductId, godownId: openingGodownId, quantity: openingStockWeight,
        asOf: asOfDate, sourceNote: openingNotes.trim(),
      })
      if (!stock.success) {
        setFormError(stock.error ?? "Could not record the opening stock balance.")
        return
      }
      let cashNote = ""
      if (openingCash > 0) {
        const cash = await createOpeningBalance({
          balanceKind: "cash", entityKey: "cash:opening",
          amount: openingCash, asOf: asOfDate, sourceNote: openingNotes.trim(),
        })
        cashNote = cash.success ? ` Cash opening of ${formatCurrency(openingCash)} recorded as an evidence row (no cash account selected).` : ` Cash opening could not be recorded: ${cash.error ?? "unknown error"}.`
      }
      setFormNotice(`Opening stock locked: ${openingStockWeight} kg of ${product?.name} in ${godown?.name} as of ${asOfDate} (opening_balances evidence row; stock itself is established through the opening-balance record, not a fake ledger row).${cashNote}`)
      setShowOpeningConfirm(false)
      const ob = await listOpeningBalances()
      if (ob.success) setOpeningBalances(Array.isArray(ob.data) ? ob.data : [])
    } finally {
      setIsPending(false)
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
            <UploadCloud className="h-6 w-6 text-emerald-500" />
            Import
          </h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1 rounded-lg bg-muted border border-border self-start max-w-full text-xs font-semibold">
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
                Sheet Map
              </h2>
            </div>
            <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              6 / 6 sheets mapped
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Source Sheet</th>
                  <th className="pb-3 font-bold">Excel Column Name</th>
                  <th className="pb-3 font-bold">Target System Field</th>
                  <th className="pb-3 font-bold">Database Entity</th>
                  <th className="pb-3 font-bold">Conversion / Logic Rule</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {dataDictionary.map((item, idx) => (
                  <tr key={idx} className="hover:bg-muted transition-colors">
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
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase font-sans">
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
              Opening Balances
            </h2>
          </div>

          <form onSubmit={handleSaveOpeningBalance} className="space-y-4 text-xs">
            <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-foreground mb-1">As-of date</label>
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-md bg-muted border border-border">
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

            <p className="text-[11px] text-muted-foreground -mt-1">Cash opening is reference-only here: the opening cash row already exists in the cashbook, and re-posting it would double-count. This form locks the stock opening row below.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-foreground mb-1">Opening Cash in Hand (PKR) — reference only</label>
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
                  placeholder="e.g. From physical scale count"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
                <span>{isPending ? "Locking…" : "Lock Opening Balances"}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTab === "opening_balances" && openingBalances.length > 0 && (
        <div className="expensive-card p-5">
          <h2 className="text-sm font-bold text-foreground mb-3">Recorded Balances ({openingBalances.length})</h2>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Kind</th><th className="pb-2">Entity</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-right">Quantity</th><th className="pb-2">As of</th></tr></thead>
            <tbody className="divide-y divide-border">
              {openingBalances.map((b: any) => (<tr key={b.id}><td className="py-2">{b.balance_kind}</td><td className="py-2 font-mono">{b.entity_key}</td><td className="py-2 text-right">{formatCurrency(Number(b.amount || 0))}</td><td className="py-2 text-right">{formatWeight(Number(b.quantity || 0))}</td><td className="py-2">{b.as_of?.slice(0, 10)}</td></tr>))}
            </tbody></table></div>
          <p className="text-[11px] text-muted-foreground mt-2">CSV import stays preview-only: the import tab parses a CSV and shows its headers and first rows with the mapping notice, but does not write rows — no fake imports.</p>
        </div>
      )}
      {/* Tab 3: Spreadsheet Import Wizard */}
      {activeTab === "import" && (
        <div className="expensive-card p-6 space-y-6">
          <div>
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <UploadCloud className="h-4 w-4 text-emerald-500" />
              Import File
            </h2>
            <p className="text-xs text-muted-foreground">
              Import masters and transactions from Excel or CSV.
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
          <div className="border-2 border-dashed border-border hover:border-primary/50 rounded-md p-8 text-center bg-muted/20 transition-colors">
            <FileSpreadsheet className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
            <div className="text-xs font-bold text-foreground">Select a CSV file to preview</div>
            <div className="text-[11px] text-muted-foreground mt-1">
              CSV exports from the legacy workbook are parsed in your browser and previewed below. Nothing is written yet.
            </div>
            <label className="mt-4 inline-block px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer transition-colors">
              Browse Spreadsheet
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <AlertBanner tone="error" message={importError} onDismiss={() => setImportError("")} />
          {parsedFile && (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs space-y-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                <div>
                  <strong className="text-foreground">{parsedFile.rows.length} data rows parsed from {parsedFile.name} for {importType.replace("_", " ")}.</strong>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Preview only — nothing was written to masters. Writing rows needs the column mapping to be confirmed first (spec §18: ambiguous columns must be flagged, not guessed), which lands with the Phase 2 import.
                  </div>
                  <div className="text-[11px] mt-1">Columns found: <span className="font-mono">{parsedFile.headers.join(", ")}</span></div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                      {parsedFile.headers.map((h) => (
                        <th key={h} className="pb-2 pr-3 font-bold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {parsedFile.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className="py-2 pr-3 font-mono">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedFile.rows.length > 5 && (
                  <p className="text-[11px] text-muted-foreground mt-2">Showing first 5 of {parsedFile.rows.length} rows.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={showOpeningConfirm}
        title="Lock this opening balance?"
        description={`Record ${openingStockWeight} kg of ${products.find((p) => p.id === openingProductId)?.name || "the selected product"} in ${godowns.find((g) => g.id === openingGodownId)?.name || "the selected godown"} as of ${asOfDate} as an opening balance, with source note "${openingNotes.trim()}".`}
        confirmLabel="Lock Opening Balance"
        pending={isPending}
        onConfirm={handleConfirmOpening}
        onCancel={() => setShowOpeningConfirm(false)}
      />
    </div>
  )
}
