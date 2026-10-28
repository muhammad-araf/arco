"use client"

import * as React from "react"
import {
  Database,
  Plus,
  Warehouse,
  Package,
  Cog,
  CheckCircle2,
  Wallet,
  Tag,
  ListChecks,
} from "lucide-react"
import { listProducts, listGodowns, listMachines, listPackagingTypes, createProduct, deactivateProduct, reactivateProduct, updateProduct, createGodown, deactivateGodown, reactivateGodown, updateGodown, createMachine, deactivateMachine, reactivateMachine, updateMachine, createPackagingType, deactivatePackagingType, reactivatePackagingType, updatePackagingType } from "@/app/actions/masters"
import { listExpenseCategories, createExpenseCategory, deactivateExpenseCategory, reactivateExpenseCategory, updateExpenseCategory, listCashAccounts, createCashAccount, deactivateCashAccount, reactivateCashAccount, updateCashAccount } from "@/app/actions/finance"
import { listProcessingTypes, createProcessingType, deactivateProcessingType, reactivateProcessingType } from "@/app/actions/processing-types"
import { getStockLedger } from "@/app/actions/inventory"
import { Product, Godown, Machine } from "@/lib/types/database"
import { formatCurrency, formatWeight } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
  SubmitSpinner,
  isPositive,
} from "@/components/erp-ui"
import { MastersSkeleton } from "@/components/route-skeletons"

type Tab = "products" | "godowns" | "machines" | "packaging" | "expense-categories" | "cash-accounts" | "processing-types"
type AddKind = "godown" | "machine" | "packaging" | "expense-category" | "cash-account" | "processing-type"

export default function MastersPage() {
  const [activeTab, setActiveTab] = React.useState<Tab>("products")
  const [products, setProducts] = React.useState<Product[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [machines, setMachines] = React.useState<Machine[]>([])
  const [packaging, setPackaging] = React.useState<any[]>([])
  const [expenseCategories, setExpenseCategories] = React.useState<any[]>([])
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  const [processingTypes, setProcessingTypes] = React.useState<any[]>([])

  const [isNewProdOpen, setIsNewProdOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftProduct, setDraftProduct] = React.useState<Product | null>(null)
  const [toggleTarget, setToggleTarget] = React.useState<Product | null>(null)
  const [referencedIds, setReferencedIds] = React.useState<Set<string>>(new Set())
  const [masterKind, setMasterKind] = React.useState<AddKind>("godown")
  const [masterCode, setMasterCode] = React.useState("")
  const [masterName, setMasterName] = React.useState("")
  const [masterExtra, setMasterExtra] = React.useState("")
  const [masterExtra2, setMasterExtra2] = React.useState("")
  const [masterNum1, setMasterNum1] = React.useState<number>(0)
  const [masterNum2, setMasterNum2] = React.useState<number>(0)
  const [masterDesc, setMasterDesc] = React.useState("")
  const [acctKind, setAcctKind] = React.useState<"cash" | "bank" | "online">("cash")
  const [masterPending, setMasterPending] = React.useState(false)
  const [deactTarget, setDeactTarget] = React.useState<{ kind: string; id: string; name: string } | null>(null)
  const [deactPending, setDeactPending] = React.useState(false)
  const productGuard = React.useRef(false)
  const [prodName, setProdName] = React.useState("")
  const [prodCategory, setProdCategory] = React.useState<any>("raw_seed")
  const [prodMinStock, setProdMinStock] = React.useState<number>(2000)
  const [weightPerBag, setWeightPerBag] = React.useState<number>(50)

  const loadData = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [pr, g, m, pk, ec, ca, pt, le] = await Promise.all([listProducts(true), listGodowns(true), listMachines(true), listPackagingTypes(true), listExpenseCategories(), listCashAccounts(), listProcessingTypes(true), getStockLedger({ limit: 500 })])
      const failed = [pr, g, m, pk, ec, ca, pt, le].find((x) => !x.success)
      if (failed) setFormError(failed.error ?? "Could not load master data.")
      setProducts(Array.isArray(pr.data) ? pr.data : [])
      setGodowns(Array.isArray(g.data) ? g.data : [])
      setMachines(Array.isArray(m.data) ? m.data : [])
      setPackaging(Array.isArray(pk.data) ? pk.data : [])
      setExpenseCategories(Array.isArray(ec.data) ? ec.data : [])
      setCashAccounts(Array.isArray(ca.data) ? ca.data : [])
      setProcessingTypes(Array.isArray(pt.data) ? pt.data : [])
      setReferencedIds(new Set((Array.isArray(le.data) ? le.data : []).map((e: any) => e.product_id)))
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not load master data.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadData()
  }, [])

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    // Spec §3.1: name required, positive bag weight, non-negative safety
    // stock, and no duplicate product name (codes are generated unique).
    if (!prodName.trim()) return setFormError("Product name is required.")
    if (!isPositive(weightPerBag)) return setFormError("Standard bag weight must be greater than zero.")
    if (prodMinStock < 0) return setFormError("Minimum safety stock cannot be negative.")
    if (products.some((p) => p.name.trim().toLowerCase() === prodName.trim().toLowerCase())) return setFormError(`A product named "${prodName.trim()}" already exists. Pick a different name instead of duplicating the master.`)
    setFormError("")
    setDraftProduct({
      id: `prod-${Date.now()}`,
      code: `PRD-${prodName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 12)}-${Date.now().toString().slice(-4)}`,
      name: prodName.trim(),
      category: prodCategory,
      default_unit: "kg",
      weight_per_bag: weightPerBag,
      min_stock: prodMinStock,
      is_active: true,
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const handleConfirmProduct = async () => {
    if (!draftProduct || productGuard.current) return
    productGuard.current = true
    setIsPending(true)
    try {
      const res = await createProduct({ code: draftProduct.code, name: draftProduct.name, category: draftProduct.category, weight_per_bag: draftProduct.weight_per_bag, min_stock: draftProduct.min_stock })
      if (!res.success) {
        setFormError(res.error ?? "Could not create the product.")
        return
      }
      setFormNotice(`Product "${draftProduct.name}" created (${(res.data as any)?.code ?? draftProduct.code}) and available in every product list.`)
      setShowConfirm(false)
      setIsNewProdOpen(false)
      setDraftProduct(null)
      setProdName("")
      await loadData()
    } finally {
      setIsPending(false)
      productGuard.current = false
    }
  }

  const resetMasterForm = () => {
    setMasterCode(""); setMasterName(""); setMasterExtra(""); setMasterExtra2(""); setMasterNum1(0); setMasterNum2(0); setMasterDesc("")
  }

  const handleCreateMaster = async (e: React.FormEvent) => {
    e.preventDefault()
    if (masterPending) return
    // Expense categories and processing types have no code; the rest do.
    if (masterKind !== "expense-category" && masterKind !== "processing-type" && (!masterCode.trim() || !masterName.trim())) {
      setFormError("Master code and name are required.")
      return
    }
    if ((masterKind === "expense-category" || masterKind === "processing-type") && !masterName.trim()) {
      setFormError("Name is required.")
      return
    }
    if (masterNum1 < 0 || masterNum2 < 0) return setFormError("Numbers cannot be negative.")
    setMasterPending(true)
    try {
      let res: any
      if (masterKind === "godown") res = await createGodown({ code: masterCode.trim(), name: masterName.trim(), address: masterExtra.trim() || undefined, capacity_metric_tons: masterNum1 || undefined })
      else if (masterKind === "machine") res = await createMachine({ code: masterCode.trim(), name: masterName.trim(), processing_type: masterExtra.trim() || "Grading", capacity_kg_per_hour: masterNum1 || undefined, operator_name: masterExtra2.trim() || undefined })
      else if (masterKind === "packaging") res = await createPackagingType({ code: masterCode.trim(), name: masterName.trim(), capacity_kg: masterNum1 || undefined, cost_per_bag: masterNum2 || undefined })
      else if (masterKind === "expense-category") res = await createExpenseCategory({ name: masterName.trim(), description: masterDesc.trim() || undefined })
      else if (masterKind === "cash-account") res = await createCashAccount({ code: masterCode.trim(), name: masterName.trim(), accountKind: acctKind, openingBalance: masterNum1 })
      else res = await createProcessingType(masterName.trim())
      if (!res.success) {
        setFormError(res.error ?? "Could not create the master record.")
        return
      }
      setFormNotice(`"${masterName.trim()}" created.`)
      resetMasterForm()
      await loadData()
    } finally { setMasterPending(false) }
  }

  const handleDeactivateMaster = async () => {
    if (!deactTarget || deactPending) return
    setDeactPending(true)
    try {
      let res: any
      if (deactTarget.kind === "godown") res = await deactivateGodown(deactTarget.id)
      else if (deactTarget.kind === "machine") res = await deactivateMachine(deactTarget.id)
      else if (deactTarget.kind === "packaging") res = await deactivatePackagingType(deactTarget.id)
      else if (deactTarget.kind === "expense-category") res = await deactivateExpenseCategory(deactTarget.id)
      else if (deactTarget.kind === "cash-account") res = await deactivateCashAccount(deactTarget.id)
      else res = await deactivateProcessingType(deactTarget.id)
      if (!res.success) {
        setFormError(res.error ?? "Could not deactivate.")
        return
      }
      setFormNotice(`"${deactTarget.name}" deactivated — never deleted; history is kept.`)
      setDeactTarget(null)
      await loadData()
    } finally { setDeactPending(false) }
  }

  // Spec §3.1: never delete a product that transactions reference — flip
  // it inactive instead. Deactivation is confirmed, and the dialog warns
  // when the product already has stock-ledger history.
  const handleConfirmToggle = async () => {
    if (!toggleTarget) return
    if (!toggleTarget.is_active) {
      const res = await reactivateProduct(toggleTarget.id)
      if (!res.success) {
        setFormError(res.error ?? "Could not reactivate the product.")
        return
      }
      setFormNotice(`Product "${toggleTarget.name}" is active again and available in new vouchers.`)
      setToggleTarget(null)
      await loadData()
      return
    }
    const res = await deactivateProduct(toggleTarget.id)
    if (!res.success) {
      setFormError(res.error ?? "Could not deactivate the product.")
      return
    }
    setFormNotice(`Product "${toggleTarget.name}" is now inactive (hidden from new vouchers, history kept).`)
    setToggleTarget(null)
    await loadData()
  }

  const [editTarget, setEditTarget] = React.useState<{ kind: string; id: string; name: string; extra: string; extra2: string; num1: number; num2: number; desc: string } | null>(null)
  const [editPending, setEditPending] = React.useState(false)
  const openEdit = (kind: string, row: any) => {
    if (kind === "product") setEditTarget({ kind, id: row.id, name: row.name, extra: row.category, extra2: "", num1: Number(row.weight_per_bag || 0), num2: Number(row.min_stock || 0), desc: "" })
    else if (kind === "godown") setEditTarget({ kind, id: row.id, name: row.name, extra: row.address || "", extra2: "", num1: Number(row.capacity_metric_tons || 0), num2: 0, desc: "" })
    else if (kind === "machine") setEditTarget({ kind, id: row.id, name: row.name, extra: row.processing_type, extra2: row.operator_name || "", num1: Number(row.capacity_kg_per_hour || 0), num2: 0, desc: "" })
    else if (kind === "packaging") setEditTarget({ kind, id: row.id, name: row.name, extra: "", extra2: "", num1: Number(row.capacity_kg || 0), num2: Number(row.cost_per_bag || 0), desc: "" })
    else if (kind === "expense-category") setEditTarget({ kind, id: row.id, name: row.name, extra: "", extra2: "", num1: 0, num2: 0, desc: row.description || "" })
    else setEditTarget({ kind, id: row.id, name: row.name, extra: "", extra2: "", num1: Number(row.opening_balance || 0), num2: 0, desc: "" })
  }
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTarget || editPending) return
    if (!editTarget.name.trim()) return setFormError("Name is required.")
    if (editTarget.num1 < 0 || editTarget.num2 < 0) return setFormError("Numbers cannot be negative.")
    setEditPending(true)
    try {
      let res: any
      if (editTarget.kind === "product") res = await updateProduct(editTarget.id, { name: editTarget.name.trim(), category: editTarget.extra, weight_per_bag: editTarget.num1, min_stock: editTarget.num2 })
      else if (editTarget.kind === "godown") res = await updateGodown(editTarget.id, { name: editTarget.name.trim(), address: editTarget.extra, capacity_metric_tons: editTarget.num1 })
      else if (editTarget.kind === "machine") res = await updateMachine(editTarget.id, { name: editTarget.name.trim(), processing_type: editTarget.extra, capacity_kg_per_hour: editTarget.num1, operator_name: editTarget.extra2 })
      else if (editTarget.kind === "packaging") res = await updatePackagingType(editTarget.id, { name: editTarget.name.trim(), capacity_kg: editTarget.num1, cost_per_bag: editTarget.num2 })
      else if (editTarget.kind === "expense-category") res = await updateExpenseCategory({ id: editTarget.id, name: editTarget.name.trim(), description: editTarget.desc.trim() || null })
      else res = await updateCashAccount({ id: editTarget.id, name: editTarget.name.trim(), openingBalance: editTarget.num1 })
      if (!res.success) { setFormError(res.error ?? "Could not update."); return }
      setFormNotice(`"${editTarget.name.trim()}" updated.`)
      setEditTarget(null)
      await loadData()
    } finally { setEditPending(false) }
  }
  const handleReactivateOther = async (kind: string, row: any) => {
    let res: any
    if (kind === "godown") res = await reactivateGodown(row.id)
    else if (kind === "machine") res = await reactivateMachine(row.id)
    else if (kind === "packaging") res = await reactivatePackagingType(row.id)
    else if (kind === "expense-category") res = await reactivateExpenseCategory(row.id)
    else if (kind === "cash-account") res = await reactivateCashAccount(row.id)
    else res = await reactivateProcessingType(row.id)
    if (!res.success) { setFormError(res.error ?? "Could not reactivate."); return }
    setFormNotice(`"${row.name}" is active again.`)
    await loadData()
  }

  if (isLoading) return <MastersSkeleton />

  const tabBtn = (key: Tab, label: string, icon: React.ReactNode, count: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setActiveTab(key)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
        activeTab === key ? "bg-primary text-primary-foreground shadow-xs font-bold" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label} ({count})</span>
    </button>
  )
  const statusBadge = (active: boolean | undefined, activeLabel = "Active") => (
    <span className={active !== false ? "px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase" : "px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-bold uppercase"}>
      {active !== false ? activeLabel : "Inactive"}
    </span>
  )
  const rowActions = (kind: string, row: any, name: string) => (
    <>
      {kind !== "processing-type" && (<button type="button" onClick={() => openEdit(kind, row)} className="px-2 py-0.5 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Edit</button>)}
      {row.is_active !== false ? (<button type="button" onClick={() => setDeactTarget({ kind, id: row.id, name })} className="px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Deactivate</button>) : (<button type="button" onClick={() => handleReactivateOther(kind, row)} className="px-2 py-0.5 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Reactivate</button>)}
    </>
  )

  return (
    <div className="space-y-6">
      <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
      <AlertBanner tone="success" message={formNotice} onDismiss={() => setFormNotice("")} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Database className="h-6 w-6 text-emerald-500" />
            Masters
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Employees live on the Employees page and parties on the Parties page. Deactivation is reversible and never deletes history.</p>
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
      <div className="flex flex-wrap items-center gap-2 p-1 rounded-lg bg-muted border border-border self-start max-w-full text-xs font-semibold">
        {tabBtn("products", "Products", <Package className="h-3.5 w-3.5" />, products.length)}
        {tabBtn("godowns", "Godowns", <Warehouse className="h-3.5 w-3.5" />, godowns.length)}
        {tabBtn("machines", "Machinery Plants", <Cog className="h-3.5 w-3.5" />, machines.length)}
        {tabBtn("packaging", "Packaging types", <Package className="h-3.5 w-3.5" />, packaging.length)}
        {tabBtn("expense-categories", "Expense categories", <Tag className="h-3.5 w-3.5" />, expenseCategories.length)}
        {tabBtn("cash-accounts", "Cash accounts", <Wallet className="h-3.5 w-3.5" />, cashAccounts.length)}
        {tabBtn("processing-types", "Processing types", <ListChecks className="h-3.5 w-3.5" />, processingTypes.length)}
      </div>

      {/* Tab: Products */}
      {activeTab === "products" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Code</th>
                  <th className="pb-3 font-bold">Product Name</th>
                  <th className="pb-3 font-bold">Category</th>
                  <th className="pb-3 font-bold">Unit</th>
                  <th className="pb-3 font-bold text-right">Standard Bag Wt</th>
                  <th className="pb-3 font-bold text-right">Safety Stock</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                  <th className="pb-3 font-bold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-4">
                      <EmptyState title="No products yet" hint="Add your first product." actionLabel="Add New Product" onAction={() => setIsNewProdOpen(true)} />
                    </td>
                  </tr>
                )}
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{p.code}</td>
                    <td className="py-3 font-bold text-foreground">{p.name}</td>
                    <td className="py-3 text-muted-foreground capitalize">{p.category.replace("_", " ")}</td>
                    <td className="py-3 font-mono text-muted-foreground uppercase">{p.default_unit}</td>
                    <td className="py-3 text-right font-mono text-foreground">{p.weight_per_bag ? `${p.weight_per_bag} kg` : "—"}</td>
                    <td className="py-3 text-right font-mono font-bold text-foreground">{formatWeight(p.min_stock || 0)}</td>
                    <td className="py-3 text-center">{statusBadge(p.is_active)}</td>
                    <td className="py-3 text-center">
                      <button type="button" onClick={() => openEdit("product", p)} className="px-2 py-1 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Edit</button>
                      <button type="button" onClick={() => setToggleTarget(p)} className="px-2 py-1 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer" title={p.is_active ? "Deactivate" : "Reactivate product"}>
                        {p.is_active ? "Deactivate" : "Reactivate"}
                      </button>
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
            <table className="w-full text-left border-collapse text-xs min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Godown Code</th>
                  <th className="pb-3 font-bold">Name & Description</th>
                  <th className="pb-3 font-bold">Address / Compound</th>
                  <th className="pb-3 font-bold text-right">Capacity (MT)</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {godowns.length === 0 && (<tr><td colSpan={5} className="py-4 text-muted-foreground">No godowns yet — add one below.</td></tr>)}
                {godowns.map((g) => (
                  <tr key={g.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">{g.code}</td>
                    <td className="py-3 font-bold text-foreground">{g.name}</td>
                    <td className="py-3 text-muted-foreground">{g.address}</td>
                    <td className="py-3 text-right font-mono font-black text-foreground">{g.capacity_metric_tons} MT</td>
                    <td className="py-3 text-center">{statusBadge(g.is_active, "Operational")} {rowActions("godown", g, g.name)}</td>
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
            <table className="w-full text-left border-collapse text-xs min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Plant Code</th>
                  <th className="pb-3 font-bold">Machine Name</th>
                  <th className="pb-3 font-bold">Processing Type</th>
                  <th className="pb-3 font-bold text-right">Throughput (kg/hr)</th>
                  <th className="pb-3 font-bold">Assigned Operator</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {machines.length === 0 && (<tr><td colSpan={6} className="py-4 text-muted-foreground">No machines yet — add one below.</td></tr>)}
                {machines.map((m) => (
                  <tr key={m.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{m.code}</td>
                    <td className="py-3 font-bold text-foreground">{m.name}</td>
                    <td className="py-3 text-muted-foreground">{m.processing_type}</td>
                    <td className="py-3 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">{m.capacity_kg_per_hour?.toLocaleString()} kg/hr</td>
                    <td className="py-3 text-foreground font-semibold">{m.operator_name || "Not set"}</td>
                    <td className="py-3 text-center">{statusBadge(m.is_active, "Ready")} {rowActions("machine", m, m.name)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Packaging types */}
      {activeTab === "packaging" && (
        <div className="expensive-card p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Code</th>
                  <th className="pb-3 font-bold">Name</th>
                  <th className="pb-3 font-bold text-right">Capacity (kg)</th>
                  <th className="pb-3 font-bold text-right">Cost per bag</th>
                  <th className="pb-3 font-bold text-right">Stock (bags)</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {packaging.length === 0 && (<tr><td colSpan={6} className="py-4 text-muted-foreground">No packaging types yet — add one below.</td></tr>)}
                {packaging.map((pk: any) => (
                  <tr key={pk.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{pk.code}</td>
                    <td className="py-3 font-bold text-foreground">{pk.name}</td>
                    <td className="py-3 text-right font-mono">{pk.capacity_kg ?? "—"}</td>
                    <td className="py-3 text-right font-mono">{formatCurrency(Number(pk.cost_per_bag || 0))}</td>
                    <td className="py-3 text-right font-mono">{pk.current_stock ?? "—"}</td>
                    <td className="py-3 text-center">{statusBadge(pk.is_active)} {rowActions("packaging", pk, pk.name)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Expense categories */}
      {activeTab === "expense-categories" && (
        <div className="expensive-card p-5">
          <p className="text-xs text-muted-foreground mb-4">The Daybook expense form draws its categories from this table. Deactivated categories stay on old expenses but disappear from the form.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[560px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Name</th>
                  <th className="pb-3 font-bold">Description</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expenseCategories.length === 0 && (<tr><td colSpan={3} className="py-4 text-muted-foreground">No categories yet — add one below.</td></tr>)}
                {expenseCategories.map((c: any) => (
                  <tr key={c.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-bold text-foreground">{c.name}</td>
                    <td className="py-3 text-muted-foreground">{c.description || "—"}</td>
                    <td className="py-3 text-center">{statusBadge(c.is_active)} {rowActions("expense-category", c, c.name)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Cash accounts */}
      {activeTab === "cash-accounts" && (
        <div className="expensive-card p-5">
          <p className="text-xs text-muted-foreground mb-4">Receipts, payments and paid expenses must land in one of these accounts, so per-account ledger views stay complete. Code and kind never change after creation.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Code</th>
                  <th className="pb-3 font-bold">Name</th>
                  <th className="pb-3 font-bold">Kind</th>
                  <th className="pb-3 font-bold text-right">Opening</th>
                  <th className="pb-3 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cashAccounts.length === 0 && (<tr><td colSpan={5} className="py-4 text-muted-foreground">No cash accounts yet — add one below.</td></tr>)}
                {cashAccounts.map((a: any) => (
                  <tr key={a.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-mono font-bold text-muted-foreground">{a.code}</td>
                    <td className="py-3 font-bold text-foreground">{a.name}</td>
                    <td className="py-3 uppercase text-muted-foreground">{a.account_kind}</td>
                    <td className="py-3 text-right font-mono">{formatCurrency(Number(a.opening_balance || 0))}</td>
                    <td className="py-3 text-center">{statusBadge(a.is_active)} {rowActions("cash-account", a, a.name)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Processing types */}
      {activeTab === "processing-types" && (
        <div className="expensive-card p-5">
          <p className="text-xs text-muted-foreground mb-4">When this list is empty, processing type stays a free-text field. Deactivation never deletes a type.</p>
          <div className="text-xs">
            {processingTypes.length === 0 && <p className="text-muted-foreground">No processing types yet — add one below.</p>}
            {processingTypes.map((pt: any) => (
              <div key={pt.id} className="flex items-center justify-between py-2 border-b border-border">
                <span className="font-semibold">{pt.name} {pt.is_active === false ? <span className="text-muted-foreground">— Inactive</span> : ""}</span>
                <span>{rowActions("processing-type", pt, pt.name)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Product Modal */}
      {isNewProdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Package className="h-4 w-4 text-emerald-500" />
                Add Product Master
              </h3>
              <button type="button" onClick={() => setIsNewProdOpen(false)} className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer">✕</button>
            </div>
            <form onSubmit={handleAddProduct} className="space-y-4 text-xs">
              <AlertBanner tone="error" message={formError} onDismiss={() => setFormError("")} />
              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="product-title">Product Title</label>
                <input id="product-title" type="text" value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="e.g. Graded Hybrid Corn (DK-6789)" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="category-2">Category</label>
                  <select id="category-2" value={prodCategory} onChange={(e) => setProdCategory(e.target.value as any)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground">
                    <option value="raw_seed">Raw Seed</option>
                    <option value="finished_seed">Finished Seed</option>
                    <option value="intermediate">Intermediate / Grading</option>
                    <option value="by_product">By-Product (Phok/Chhilka)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1" htmlFor="standard-bag-kg-2">Standard Bag (kg)</label>
                  <input id="standard-bag-kg-2" type="number" value={weightPerBag} onChange={(e) => setWeightPerBag(Number(e.target.value))} min="1" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" required />
                </div>
              </div>
              <div>
                <label className="block font-medium text-foreground mb-1" htmlFor="minimum-safety-stock-kg-2">Minimum Safety Stock (kg)</label>
                <input id="minimum-safety-stock-kg-2" type="number" value={prodMinStock} onChange={(e) => setProdMinStock(Number(e.target.value))} min="0" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsNewProdOpen(false)} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Cancel</button>
                <button type="submit" disabled={isPending} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
                  {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
                  <span>{isPending ? "Creating…" : "Create Product"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={showConfirm}
        title="Create this product?"
        description={draftProduct ? `"${draftProduct.name}" (${draftProduct.category.replace("_", " ")}, ${draftProduct.weight_per_bag} kg bag, safety stock ${draftProduct.min_stock} kg) will be added and appear in Inward, Production, Gate Pass and Purchases.` : ""}
        confirmLabel="Create Product"
        pending={isPending}
        onConfirm={handleConfirmProduct}
        onCancel={() => { setShowConfirm(false); setDraftProduct(null) }}
      />

      {/* Add a master record (all kinds except products, which use the modal above) */}
      <div className="expensive-card p-5">
        <h2 className="text-sm font-bold text-foreground mb-1">Add a master record</h2>
        <p className="text-xs text-muted-foreground mb-4">Deactivation is reversible from the list above.</p>
        <form onSubmit={handleCreateMaster} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><label className="block font-medium text-foreground mb-1" htmlFor="kind">Kind *</label><select id="kind" value={masterKind} onChange={(e) => setMasterKind(e.target.value as AddKind)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="godown">Godown</option><option value="machine">Machine</option><option value="packaging">Packaging type</option><option value="expense-category">Expense category</option><option value="cash-account">Cash account</option><option value="processing-type">Processing type</option></select></div>
          {masterKind !== "expense-category" && masterKind !== "processing-type" && (<div><label className="block font-medium text-foreground mb-1" htmlFor="code">Code *</label><input id="code" value={masterCode} onChange={(e) => setMasterCode(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>)}
          <div><label className="block font-medium text-foreground mb-1" htmlFor="name-2">Name *</label><input id="name-2" value={masterName} onChange={(e) => setMasterName(e.target.value)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
          {masterKind === "godown" && (<>
            <div><label className="block font-medium text-foreground mb-1" htmlFor="address">Address</label><input id="address" value={masterExtra} onChange={(e) => setMasterExtra(e.target.value)} placeholder="Optional" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
            <div><label className="block font-medium text-foreground mb-1" htmlFor="capacity-mt">Capacity (MT)</label><input id="capacity-mt" type="number" min="0" value={masterNum1} onChange={(e) => setMasterNum1(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          </>)}
          {masterKind === "machine" && (<>
            <div><label className="block font-medium text-foreground mb-1" htmlFor="processing-type">Processing type</label><input id="processing-type" value={masterExtra} onChange={(e) => setMasterExtra(e.target.value)} placeholder="e.g. Grading" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
            <div><label className="block font-medium text-foreground mb-1" htmlFor="throughput">Throughput (kg/hr)</label><input id="throughput" type="number" min="0" value={masterNum1} onChange={(e) => setMasterNum1(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
            <div><label className="block font-medium text-foreground mb-1" htmlFor="operator">Operator</label><input id="operator" value={masterExtra2} onChange={(e) => setMasterExtra2(e.target.value)} placeholder="Optional" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
          </>)}
          {masterKind === "packaging" && (<>
            <div><label className="block font-medium text-foreground mb-1" htmlFor="capacity-kg">Capacity (kg)</label><input id="capacity-kg" type="number" min="0" value={masterNum1} onChange={(e) => setMasterNum1(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
            <div><label className="block font-medium text-foreground mb-1" htmlFor="cost-per-bag">Cost per bag</label><input id="cost-per-bag" type="number" min="0" value={masterNum2} onChange={(e) => setMasterNum2(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          </>)}
          {masterKind === "expense-category" && (<div className="sm:col-span-2"><label className="block font-medium text-foreground mb-1" htmlFor="description">Description</label><input id="description" value={masterDesc} onChange={(e) => setMasterDesc(e.target.value)} placeholder="Optional" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>)}
          {masterKind === "cash-account" && (<>
            <div><label className="block font-medium text-foreground mb-1" htmlFor="kind-2">Kind *</label><select id="kind-2" value={acctKind} onChange={(e) => setAcctKind(e.target.value as "cash" | "bank" | "online")} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="cash">Cash</option><option value="bank">Bank</option><option value="online">Online</option></select></div>
            <div><label className="block font-medium text-foreground mb-1" htmlFor="opening-balance">Opening balance</label><input id="opening-balance" type="number" min="0" value={masterNum1} onChange={(e) => setMasterNum1(Number(e.target.value) || 0)} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
          </>)}
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><button type="submit" disabled={masterPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-60">{masterPending ? "Creating…" : "Create master record"}</button></div>
        </form>
      </div>

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-md rounded-md space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">Edit {editTarget.kind}</h3>
              <button type="button" onClick={() => setEditTarget(null)} className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer">✕</button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div><label className="block font-medium text-foreground mb-1" htmlFor="name">Name *</label><input id="name" value={editTarget.name} onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" required /></div>
              {editTarget.kind === "product" && (<>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="category">Category</label><select id="category" value={editTarget.extra} onChange={(e) => setEditTarget({ ...editTarget, extra: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"><option value="raw_seed">Raw Seed</option><option value="finished_seed">Finished Seed</option><option value="intermediate">Intermediate / Grading</option><option value="by_product">By-Product</option></select></div>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="standard-bag-kg">Standard bag (kg)</label><input id="standard-bag-kg" type="number" min="0" value={editTarget.num1} onChange={(e) => setEditTarget({ ...editTarget, num1: Number(e.target.value) || 0 })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="minimum-safety-stock-kg">Minimum safety stock (kg)</label><input id="minimum-safety-stock-kg" type="number" min="0" value={editTarget.num2} onChange={(e) => setEditTarget({ ...editTarget, num2: Number(e.target.value) || 0 })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
              </>)}
              {editTarget.kind === "godown" && (<>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="address">Address</label><input id="address" value={editTarget.extra} onChange={(e) => setEditTarget({ ...editTarget, extra: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="capacity-mt">Capacity (MT)</label><input id="capacity-mt" type="number" min="0" value={editTarget.num1} onChange={(e) => setEditTarget({ ...editTarget, num1: Number(e.target.value) || 0 })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
              </>)}
              {editTarget.kind === "machine" && (<>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="processing-type">Processing type</label><input id="processing-type" value={editTarget.extra} onChange={(e) => setEditTarget({ ...editTarget, extra: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="throughput-kg-hr">Throughput (kg/hr)</label><input id="throughput-kg-hr" type="number" min="0" value={editTarget.num1} onChange={(e) => setEditTarget({ ...editTarget, num1: Number(e.target.value) || 0 })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="operator">Operator</label><input id="operator" value={editTarget.extra2} onChange={(e) => setEditTarget({ ...editTarget, extra2: e.target.value })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
              </>)}
              {editTarget.kind === "packaging" && (<>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="capacity-kg">Capacity (kg)</label><input id="capacity-kg" type="number" min="0" value={editTarget.num1} onChange={(e) => setEditTarget({ ...editTarget, num1: Number(e.target.value) || 0 })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="cost-per-bag">Cost per bag</label><input id="cost-per-bag" type="number" min="0" value={editTarget.num2} onChange={(e) => setEditTarget({ ...editTarget, num2: Number(e.target.value) || 0 })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
              </>)}
              {editTarget.kind === "expense-category" && (<>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="description">Description</label><input id="description" value={editTarget.desc} onChange={(e) => setEditTarget({ ...editTarget, desc: e.target.value })} placeholder="Optional" className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground" /></div>
              </>)}
              {editTarget.kind === "cash-account" && (<>
                <div><label className="block font-medium text-foreground mb-1" htmlFor="opening-balance">Opening balance</label><input id="opening-balance" type="number" min="0" value={editTarget.num1} onChange={(e) => setEditTarget({ ...editTarget, num1: Number(e.target.value) || 0 })} className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono" /></div>
                <p className="text-[11px] text-muted-foreground">Code and kind never change after creation.</p>
              </>)}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditTarget(null)} className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer">Cancel</button>
                <button type="submit" disabled={editPending} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60">{editPending ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deactTarget !== null}
        title={`Deactivate "${deactTarget?.name ?? ""}"?`}
        description="This never deletes the record: it becomes inactive, stays in history, and is hidden from new vouchers."
        confirmLabel="Deactivate"
        destructive
        pending={deactPending}
        onConfirm={handleDeactivateMaster}
        onCancel={() => setDeactTarget(null)}
      />
      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.is_active ? `Deactivate "${toggleTarget?.name}"?` : `Reactivate "${toggleTarget?.name}"?`}
        description={toggleTarget?.is_active ? (referencedIds.has(toggleTarget.id) ? "This product has stock history. It will become inactive, not deleted, and stay hidden from new vouchers." : "This product will become inactive and hidden from new vouchers. Its history is kept.") : "This product will be available in new vouchers again."}
        confirmLabel={toggleTarget?.is_active ? "Deactivate" : "Reactivate"}
        destructive={toggleTarget?.is_active}
        onConfirm={handleConfirmToggle}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  )
}
