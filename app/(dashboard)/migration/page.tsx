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
import { createOpeningBalance, listOpeningBalances, listCashAccounts } from "@/app/actions/finance"
import { listGodowns, listProducts, createProduct, createParty } from "@/app/actions/masters"
import { formatCurrency, formatWeight } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  SubmitSpinner,
  isPositive,
} from "@/components/erp-ui"
import { MigrationSkeleton } from "@/components/route-skeletons"

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
    description: "Net profit from the ledger, not spreadsheet formulas",
    status: "mapped",
  },
]

// ---------------------------------------------------------------- CSV parsing
// A correct CSV parser, not a comma split: quoted fields may contain
// commas and newlines, "" inside a quoted field is one literal quote,
// and a leading UTF-8 BOM is stripped. Ragged rows (wrong column count)
// and duplicate/empty headers are reported, never silently repaired.

export interface ParsedCsv {
  name: string
  headers: string[]
  rows: string[][]
  warnings: string[]
  ambiguousColumns: Set<number>
}

function parseCsvText(text: string, name: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, "")
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field); field = ""
    } else if (ch === "\n") {
      row.push(field); field = ""
      rows.push(row); row = []
    } else if (ch === "\r") {
      // CR or CRLF line ending
      if (clean[i + 1] === "\n") i++
      row.push(field); field = ""
      rows.push(row); row = []
    } else {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0].trim() === ""))
  const headers = (nonEmpty[0] ?? []).map((h) => h.trim())
  const data = nonEmpty.slice(1)
  const warnings: string[] = []
  const ambiguousColumns = new Set<number>()
  const seen = new Map<string, number>()
  headers.forEach((h, idx) => {
    if (!h) { warnings.push(`Column ${idx + 1} has an empty header — it cannot be mapped.`); ambiguousColumns.add(idx) }
    else if (seen.has(h.toLowerCase())) { warnings.push(`Header "${h}" appears more than once (columns ${seen.get(h.toLowerCase())! + 1} and ${idx + 1}) — mapping it is ambiguous.`); ambiguousColumns.add(idx); ambiguousColumns.add(seen.get(h.toLowerCase())!) }
    else seen.set(h.toLowerCase(), idx)
  })
  data.forEach((r, idx) => {
    if (r.length !== headers.length) warnings.push(`Row ${idx + 2} has ${r.length} cells but the header has ${headers.length} — it will be skipped on save.`)
  })
  return { name, headers, rows: data, warnings, ambiguousColumns }
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, "")
}

interface ImportField {
  key: string
  label: string
  required: boolean
}

const IMPORT_FIELDS: Record<"products" | "parties" | "opening_stock", ImportField[]> = {
  products: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "category", label: "Category", required: false },
    { key: "default_unit", label: "Unit", required: false },
    { key: "weight_per_bag", label: "Bag weight (kg)", required: false },
    { key: "min_stock", label: "Minimum stock (kg)", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  parties: [
    { key: "code", label: "Code", required: true },
    { key: "name", label: "Name", required: true },
    { key: "type", label: "Type", required: false },
    { key: "contact_person", label: "Contact person", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "address", label: "Address", required: false },
    { key: "opening_balance", label: "Opening balance", required: false },
    { key: "balance_type", label: "Balance type", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  opening_stock: [
    { key: "product_code", label: "Product code", required: true },
    { key: "godown_code", label: "Godown code", required: true },
    { key: "quantity", label: "Quantity (kg)", required: true },
    { key: "as_of", label: "As-of date", required: false },
    { key: "source_note", label: "Source note", required: false },
  ],
}

function autoMap(headers: string[], fields: ImportField[]): Record<string, number | null> {
  const map: Record<string, number | null> = {}
  for (const f of fields) {
    const idx = headers.findIndex((h) => normHeader(h) === normHeader(f.key) || normHeader(h) === normHeader(f.label))
    map[f.key] = idx >= 0 ? idx : null
  }
  return map
}

export default function MigrationPage() {
  const [activeTab, setActiveTab] = React.useState<"dictionary" | "opening_balances" | "import">("dictionary")
  const [importType, setImportType] = React.useState<"products" | "parties" | "opening_stock">("products")
  const [importedRowsCount, setImportedRowsCount] = React.useState<number | null>(null)

  // Opening Balance Form
  const [asOfDate, setAsOfDate] = React.useState("")
  React.useEffect(() => { setAsOfDate(new Date().toISOString().slice(0, 10)) }, [])
  const [openingGodownId, setOpeningGodownId] = React.useState("")
  const [openingProductId, setOpeningProductId] = React.useState("")
  const [openingStockWeight, setOpeningStockWeight] = React.useState<number>(15000)
  const [openingCash, setOpeningCash] = React.useState<number>(0)
  const [openingCashAccountId, setOpeningCashAccountId] = React.useState("")
  const [openingNotes, setOpeningNotes] = React.useState("Audited spreadsheet carryover")

  const [godowns, setGodowns] = React.useState<any[]>([])
  const [products, setProducts] = React.useState<any[]>([])
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showOpeningConfirm, setShowOpeningConfirm] = React.useState(false)
  const [parsedFile, setParsedFile] = React.useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = React.useState<Record<string, number | null>>({})
  const [importResult, setImportResult] = React.useState("")
  const [importPending, setImportPending] = React.useState(false)
  const [openingBalances, setOpeningBalances] = React.useState<any[]>([])
  const [importError, setImportError] = React.useState("")

  React.useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      try {
        const [g, pr, ob, ca] = await Promise.all([listGodowns(), listProducts(), listOpeningBalances(), listCashAccounts()])
        const failed = [g, pr, ob, ca].find((x) => !x.success)
        if (failed) setFormError(failed.error ?? "Could not load migration data.")
        setGodowns(Array.isArray(g.data) ? g.data : [])
        setProducts(Array.isArray(pr.data) ? pr.data : [])
        setOpeningBalances(Array.isArray(ob.data) ? ob.data : [])
        setCashAccounts(Array.isArray(ca.data) ? ca.data : [])
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Could not load migration data.")
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  React.useEffect(() => {
    if (godowns.length > 0 && !openingGodownId) setOpeningGodownId(godowns[0].id)
    if (products.length > 0 && !openingProductId) setOpeningProductId(products[0].id)
    if (cashAccounts.length > 0 && !openingCashAccountId) setOpeningCashAccountId(cashAccounts[0].id)
  }, [godowns, products, cashAccounts, openingGodownId, openingProductId, openingCashAccountId])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError("")
    setParsedFile(null)
    setImportedRowsCount(null)
    setImportResult("")
    if (!/\.csv$/i.test(file.name)) {
      setImportError(`"${file.name}" is not a CSV file. Excel (.xlsx) parsing is not available — export the sheet as CSV and upload that, so the rows previewed are the rows actually in your file.`)
      return
    }
    try {
      const text = await file.text()
      const parsed = parseCsvText(text, file.name)
      if (parsed.rows.length < 1 || parsed.headers.length === 0) {
        setImportError("This file has no data rows — it needs a header row plus at least one data row.")
        return
      }
      setParsedFile(parsed)
      setMapping(autoMap(parsed.headers, IMPORT_FIELDS[importType]))
      setImportedRowsCount(parsed.rows.length)
    } catch {
      setImportError("Could not read this file. Check it is a valid CSV export and try again.")
    }
  }

  const handleImportType = (t: "products" | "parties" | "opening_stock") => {
    setImportType(t)
    if (parsedFile) setMapping(autoMap(parsedFile.headers, IMPORT_FIELDS[t]))
    setImportResult("")
  }

  const mappingBlockedReason = (): string | null => {
    if (!parsedFile) return "No file parsed yet."
    for (const f of IMPORT_FIELDS[importType]) {
      if (!f.required) continue
      const col = mapping[f.key]
      if (col === null || col === undefined) return `Required column "${f.label}" is not mapped to any file column.`
      if (parsedFile.ambiguousColumns.has(col)) return `Required column "${f.label}" maps to an ambiguous file column (duplicate or empty header) — fix the file headers first.`
    }
    return null
  }

  const handleSaveImport = async () => {
    if (!parsedFile) return
    const blocked = mappingBlockedReason()
    if (blocked) return setImportError(blocked)
    setImportPending(true)
    setImportError("")
    try {
      let saved = 0
      const errors: string[] = []
      const fields = IMPORT_FIELDS[importType]
      for (let i = 0; i < parsedFile.rows.length; i++) {
        const row = parsedFile.rows[i]
        if (row.length !== parsedFile.headers.length) continue // ragged: flagged at parse time, skipped
        const get = (key: string): string => {
          const col = mapping[key]
          return col === null || col === undefined ? "" : (row[col] ?? "").trim()
        }
        try {
          if (importType === "products") {
            const code = get("code"); const name = get("name")
            if (!code || !name) throw new Error("code and name are required")
            const category = get("category") || "raw_seed"
            if (!["raw_seed", "finished_seed", "intermediate", "by_product", "packaging"].includes(category)) throw new Error(`unknown category "${category}"`)
            const unit = get("default_unit") || "kg"
            if (!["kg", "bag", "maund"].includes(unit)) throw new Error(`unknown unit "${unit}"`)
            const res = await createProduct({ code, name, category, default_unit: unit, weight_per_bag: Number(get("weight_per_bag")) || undefined, min_stock: Number(get("min_stock")) || 0, notes: get("notes") || undefined })
            if (!res.success) throw new Error(res.error ?? "create failed")
          } else if (importType === "parties") {
            const code = get("code"); const name = get("name")
            if (!code || !name) throw new Error("code and name are required")
            const balanceType = get("balance_type") || "receivable"
            if (!["receivable", "payable"].includes(balanceType)) throw new Error(`unknown balance_type "${balanceType}"`)
            const res = await createParty({ code, name, type: get("type") || "customer", contact_person: get("contact_person") || undefined, phone: get("phone") || undefined, address: get("address") || undefined, opening_balance: Number(get("opening_balance")) || 0, balance_type: balanceType, notes: get("notes") || undefined })
            if (!res.success) throw new Error(res.error ?? "create failed")
          } else {
            const godown = godowns.find((g: any) => g.code === get("godown_code"))
            const product = products.find((p: any) => p.code === get("product_code"))
            if (!godown) throw new Error(`godown code "${get("godown_code")}" not found in Masters`)
            if (!product) throw new Error(`product code "${get("product_code")}" not found in Masters`)
            const qty = Number(get("quantity"))
            if (!Number.isFinite(qty) || qty <= 0) throw new Error("quantity must be > 0")
            const res = await createOpeningBalance({
              balanceKind: "stock", entityKey: `stock:${godown.id}:${product.id}`,
              productId: product.id, godownId: godown.id, quantity: qty,
              asOf: get("as_of") || undefined, sourceNote: get("source_note") || undefined,
            })
            if (!res.success) throw new Error(res.error ?? "create failed")
          }
          saved++
        } catch (err) {
          errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : "failed"}`)
        }
      }
      setImportResult(`Saved ${saved} of ${parsedFile.rows.length} row(s)${errors.length ? `. ${errors.length} row(s) failed: ${errors.slice(0, 10).join(" | ")}${errors.length > 10 ? ` (+${errors.length - 10} more)` : ""}` : "."}`)
      const ob = await listOpeningBalances()
      if (ob.success) setOpeningBalances(Array.isArray(ob.data) ? ob.data : [])
    } finally {
      setImportPending(false)
    }
  }

  const handleSaveOpeningBalance = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    if (!asOfDate) return setFormError("Pick the as-of date for this opening balance.")
    if (!openingGodownId) return setFormError("Select the godown this opening stock belongs to.")
    if (!openingProductId) return setFormError("Select the product for this opening stock.")
    if (!isPositive(openingStockWeight)) return setFormError("Opening stock weight must be greater than zero.")
    if (!openingNotes.trim()) return setFormError("A source note is required — e.g. which scale count sheet.")
    if (openingCash > 0 && !openingCashAccountId) return setFormError("Select the cash account the opening cash belongs to.")
    if (openingCash < 0) return setFormError("Opening cash cannot be negative.")
    const already = openingBalances.some(
      (b) => b.balance_kind === "stock" && b.product_id === openingProductId && b.godown_id === openingGodownId
    )
    if (already) return setFormError("An opening balance for this product and godown is already recorded. Correcting it needs a stock adjustment — a second opening row would double-count stock.")
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
          balanceKind: "cash", entityKey: `cash:${openingCashAccountId}`,
          cashAccountId: openingCashAccountId,
          amount: openingCash, asOf: asOfDate, sourceNote: openingNotes.trim(),
        })
        const acctName = cashAccounts.find((a: any) => a.id === openingCashAccountId)?.name
        cashNote = cash.success ? ` Cash opening of ${formatCurrency(openingCash)} recorded for ${acctName ?? "the selected cash account"}.` : ` Cash opening could not be recorded: ${cash.error ?? "unknown error"}.`
      }
      setFormNotice(`Opening stock recorded: ${openingStockWeight} kg of ${product?.name} in ${godown?.name} as of ${asOfDate}. These are evidence rows in opening_balances only — they do not change stock or cash balances in reports until the report readers honor opening rows (being wired in parallel).${cashNote}`)
      setShowOpeningConfirm(false)
      const ob = await listOpeningBalances()
      if (ob.success) setOpeningBalances(Array.isArray(ob.data) ? ob.data : [])
    } finally {
      setIsPending(false)
    }
  }

  if (isLoading) return <MigrationSkeleton />

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
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Source Sheet</th>
                  <th className="pb-3 font-bold">Excel Column Name</th>
                  <th className="pb-3 font-bold">Target Field</th>
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
            <p className="text-xs text-muted-foreground mt-1">Rows saved here are evidence in opening_balances. They do not change stock or cash balances in reports until the report readers honor opening rows (being wired in parallel).</p>
          </div>

          <form onSubmit={handleSaveOpeningBalance} className="space-y-4 text-xs">
            <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="as-of-date">As-of date</label>
                <input id="as-of-date"
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="approving-role-enforced-by-the-server">Approving role (enforced by the server)</label>
                <input id="approving-role-enforced-by-the-server"
                  type="text"
                  value="Owner / Admin"
                  disabled
                  className="w-full px-2.5 py-2 rounded-lg bg-muted text-muted-foreground border border-border"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-md bg-muted border border-border">
              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="godown-storage-shed">Godown Storage Shed</label>
                <select id="godown-storage-shed"
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
                <label className="block font-medium text-foreground mb-1" htmlFor="seed-grain-product">Seed Grain Product</label>
                <select id="seed-grain-product"
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
                <label className="block font-medium text-foreground mb-1" htmlFor="opening-stock-kg">Opening Stock (kg)</label>
                <input id="opening-stock-kg"
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
                <label className="block font-medium text-foreground mb-1" htmlFor="opening-cash-pkr-leave-0-to-skip">Opening Cash (PKR) — leave 0 to skip</label>
                <input id="opening-cash-pkr-leave-0-to-skip"
                  type="number"
                  min="0"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="cash-account-for-the-opening-cash">Cash account for the opening cash</label>
                <select id="cash-account-for-the-opening-cash"
                  value={openingCashAccountId}
                  onChange={(e) => setOpeningCashAccountId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                >
                  <option value="">Select a cash account</option>
                  {cashAccounts.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="source-documentation-notes">Source Documentation / Notes</label>
                <input id="source-documentation-notes"
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
          <div className="overflow-x-auto"><table className="w-full text-left text-xs min-w-[640px]"><thead><tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold"><th className="pb-2">Kind</th><th className="pb-2">Entity</th><th className="pb-2 text-right">Amount</th><th className="pb-2 text-right">Quantity</th><th className="pb-2">As of</th></tr></thead>
            <tbody className="divide-y divide-border">
              {openingBalances.map((b: any) => (<tr key={b.id}><td className="py-2">{b.balance_kind}</td><td className="py-2 font-mono">{b.entity_key}</td><td className="py-2 text-right">{formatCurrency(Number(b.amount || 0))}</td><td className="py-2 text-right">{formatWeight(Number(b.quantity || 0))}</td><td className="py-2">{b.as_of?.slice(0, 10)}</td></tr>))}
            </tbody></table></div>
          <p className="text-[11px] text-muted-foreground mt-2">These rows are evidence only until report readers honor them. The import tab now saves mapped CSV rows into Masters or opening balances.</p>
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
              Import products, parties, or opening stock from a CSV file. Excel (.xlsx) files are not parsed — export the sheet as CSV first.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => handleImportType("products")}
              className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                importType === "products" ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-foreground"
              }`}
            >
              <div className="font-bold text-xs">Products & Seeds</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Import product codes, categories, units</div>
            </button>

            <button
              type="button"
              onClick={() => handleImportType("parties")}
              className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                importType === "parties" ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-foreground"
              }`}
            >
              <div className="font-bold text-xs">Parties & Customers</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Growers, suppliers, wholesale clients</div>
            </button>

            <button
              type="button"
              onClick={() => handleImportType("opening_stock")}
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
              CSV exports from the legacy workbook are parsed in your browser — quoted commas and quoted quotes are handled. Nothing is written until you map columns and press Save.
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
                    Columns found: <span className="font-mono">{parsedFile.headers.join(", ")}</span>
                  </div>
                  {parsedFile.warnings.length > 0 && (
                    <div className="text-[11px] text-amber-600 mt-1 space-y-0.5">
                      {parsedFile.warnings.slice(0, 10).map((w, i) => (<div key={i}>⚠ {w}</div>))}
                      {parsedFile.warnings.length > 10 && <div>+{parsedFile.warnings.length - 10} more warnings</div>}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-2">Column mapping — match each file column to a field (required fields must be mapped)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {IMPORT_FIELDS[importType].map((f) => {
                    const col = mapping[f.key]
                    const ambiguous = col !== null && col !== undefined && parsedFile.ambiguousColumns.has(col)
                    return (
                      <div key={f.key}>
                        <label className="block font-medium text-foreground mb-1" htmlFor={`import-map-${f.key}`}>{f.label}{f.required ? " *" : ""}</label>
                        <select id={`import-map-${f.key}`}
                          value={col === null || col === undefined ? "" : String(col)}
                          onChange={(e) => setMapping((prev) => ({ ...prev, [f.key]: e.target.value === "" ? null : Number(e.target.value) }))}
                          className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                        >
                          <option value="">— Not mapped —</option>
                          {parsedFile.headers.map((h, idx) => (
                            <option key={idx} value={idx}>{h || `(empty header ${idx + 1})`}</option>
                          ))}
                        </select>
                        {ambiguous && <p className="text-[11px] text-amber-600 mt-0.5">Ambiguous column — duplicate or empty header. Fix the file before saving.</p>}
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[560px]">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                      {parsedFile.headers.map((h, idx) => (
                        <th key={idx} className="pb-2 pr-3 font-bold">{h || `(empty ${idx + 1})`}</th>
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
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveImport}
                  disabled={importPending || !!mappingBlockedReason()}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {importPending ? "Saving…" : `Save ${importType.replace("_", " ")} rows`}
                </button>
                {mappingBlockedReason() && <span className="text-[11px] text-amber-600">{mappingBlockedReason()}</span>}
              </div>
              {importResult && <p className="text-[11px] text-foreground">{importResult}</p>}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={showOpeningConfirm}
        title="Lock this opening balance?"
        description={`Record ${openingStockWeight} kg of ${products.find((p) => p.id === openingProductId)?.name || "the selected product"} in ${godowns.find((g) => g.id === openingGodownId)?.name || "the selected godown"} as of ${asOfDate} as an opening balance, with source note "${openingNotes.trim()}".${openingCash > 0 ? ` Plus opening cash of ${formatCurrency(openingCash)} for the selected cash account.` : ""} These are evidence rows only — they do not change report balances until readers honor them.`}
        confirmLabel="Lock Opening Balance"
        pending={isPending}
        onConfirm={handleConfirmOpening}
        onCancel={() => setShowOpeningConfirm(false)}
      />
    </div>
  )
}
