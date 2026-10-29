"use client"

import * as React from "react"
import {
  Database,
  Plus,
  Warehouse,
  Package,
  Cog,
  Wallet,
  Tag,
  ListChecks,
} from "lucide-react"
import { listProducts, listGodowns, listMachines, listPackagingTypes, createProduct, deactivateProduct, reactivateProduct, deactivateGodown, reactivateGodown, deactivateMachine, reactivateMachine, deactivatePackagingType, reactivatePackagingType } from "@/app/actions/masters"
import { listExpenseCategories, deactivateExpenseCategory, reactivateExpenseCategory, listCashAccounts, deactivateCashAccount, reactivateCashAccount } from "@/app/actions/finance"
import { listProcessingTypes, deactivateProcessingType, reactivateProcessingType } from "@/app/actions/processing-types"
import { getStockLedger } from "@/app/actions/inventory"
import { Product, Godown, Machine, PackagingType } from "@/lib/types/database"
import { formatCurrency, formatWeight } from "@/lib/utils"
import {
  AlertBanner,
  ConfirmDialog,
  EmptyState,
} from "@/components/erp-ui"
import { MastersSkeleton } from "@/components/route-skeletons"
import { GodownFormDialog } from "@/components/godown-form-dialog"
import { ProductFormDialog } from "@/components/product-form-dialog"
import { MachineFormDialog } from "@/components/machine-form-dialog"
import { PackagingFormDialog } from "@/components/packaging-form-dialog"
import { ExpenseCategoryFormDialog, type ExpenseCategoryRow } from "@/components/expense-category-form-dialog"
import { CashAccountFormDialog, type CashAccountRow } from "@/components/cash-account-form-dialog"
import { ProcessingTypeFormDialog, type ProcessingTypeRow } from "@/components/processing-type-form-dialog"

type Tab = "products" | "godowns" | "machines" | "packaging" | "expense-categories" | "cash-accounts" | "processing-types"

export default function MastersPage() {
  const [activeTab, setActiveTab] = React.useState<Tab>("products")
  const [products, setProducts] = React.useState<Product[]>([])
  const [godowns, setGodowns] = React.useState<Godown[]>([])
  const [machines, setMachines] = React.useState<Machine[]>([])
  const [packaging, setPackaging] = React.useState<any[]>([])
  const [expenseCategories, setExpenseCategories] = React.useState<any[]>([])
  const [cashAccounts, setCashAccounts] = React.useState<any[]>([])
  const [processingTypes, setProcessingTypes] = React.useState<any[]>([])

  const [isLoading, setIsLoading] = React.useState(true)
  const [formError, setFormError] = React.useState("")
  const [formNotice, setFormNotice] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftProduct, setDraftProduct] = React.useState<Product | null>(null)
  const [toggleTarget, setToggleTarget] = React.useState<Product | null>(null)
  const [referencedIds, setReferencedIds] = React.useState<Set<string>>(new Set())
  const [deactTarget, setDeactTarget] = React.useState<{ kind: string; id: string; name: string } | null>(null)
  // Every kind's add/edit lives in its own dialog now (POS pattern);
  // "new" = creating, a row = editing, null = closed.
  const [godownForm, setGodownForm] = React.useState<Godown | "new" | null>(null)
  const [productForm, setProductForm] = React.useState<Product | "new" | null>(null)
  const [machineForm, setMachineForm] = React.useState<Machine | "new" | null>(null)
  const [packagingForm, setPackagingForm] = React.useState<PackagingType | "new" | null>(null)
  const [expenseForm, setExpenseForm] = React.useState<ExpenseCategoryRow | "new" | null>(null)
  const [cashForm, setCashForm] = React.useState<CashAccountRow | "new" | null>(null)
  const [processingFormOpen, setProcessingFormOpen] = React.useState(false)
  const [deactPending, setDeactPending] = React.useState(false)
  const productGuard = React.useRef(false)

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

  // Product create keeps its confirmation step: the dialog builds
  // the draft (validation + generated code live in the dialog) and
  // this only opens the confirm dialog, as the old form did.
  const handleCreateDraft = (draft: Product) => {
    setFormError("")
    setDraftProduct(draft)
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
      setProductForm(null)
      setDraftProduct(null)
      await loadData()
    } finally {
      setIsPending(false)
      productGuard.current = false
    }
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
  const openRowEdit = (kind: string, row: any) => {
    if (kind === "godown") setGodownForm(row)
    else if (kind === "machine") setMachineForm(row)
    else if (kind === "packaging") setPackagingForm(row)
    else if (kind === "expense-category") setExpenseForm(row)
    else if (kind === "cash-account") setCashForm(row)
  }
  const rowActions = (kind: string, row: any, name: string) => (
    <>
      {kind !== "processing-type" && (<button type="button" onClick={() => openRowEdit(kind, row)} className="px-2 py-0.5 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Edit</button>)}
      {row.is_active !== false ? (<button type="button" onClick={() => setDeactTarget({ kind, id: row.id, name })} className="px-2 py-0.5 rounded-md hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold cursor-pointer">Deactivate</button>) : (<button type="button" onClick={() => handleReactivateOther(kind, row)} className="px-2 py-0.5 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Reactivate</button>)}
    </>
  )
  const headerAddButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
    >
      <Plus className="h-4 w-4" />
      <span>{label}</span>
    </button>
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
        {activeTab === "products" && headerAddButton("Add New Product", () => setProductForm("new"))}
        {activeTab === "godowns" && headerAddButton("Add godown", () => setGodownForm("new"))}
        {activeTab === "machines" && headerAddButton("Add machine", () => setMachineForm("new"))}
        {activeTab === "packaging" && headerAddButton("Add packaging type", () => setPackagingForm("new"))}
        {activeTab === "expense-categories" && headerAddButton("Add expense category", () => setExpenseForm("new"))}
        {activeTab === "cash-accounts" && headerAddButton("Add cash account", () => setCashForm("new"))}
        {activeTab === "processing-types" && headerAddButton("Add processing type", () => setProcessingFormOpen(true))}
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
                      <EmptyState title="No products yet" hint="Add your first product." actionLabel="Add New Product" onAction={() => setProductForm("new")} />
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
                      <button type="button" onClick={() => setProductForm(p)} className="px-2 py-1 rounded-md hover:bg-muted text-[11px] font-semibold cursor-pointer">Edit</button>
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
                {godowns.length === 0 && (<tr><td colSpan={5} className="py-4"><EmptyState title="No godowns yet" hint="Add your first godown." actionLabel="Add godown" onAction={() => setGodownForm("new")} /></td></tr>)}
                {godowns.map((g) => (
                  <tr key={g.id} className="hover:bg-muted transition-colors">
                    <td className="py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">{g.code}</td>
                    <td className="py-3 font-bold text-foreground">{g.name}</td>
                    <td className="py-3 text-muted-foreground">{g.address}</td>
                    <td className="py-3 text-right font-mono font-black text-foreground">{g.capacity_metric_tons != null ? `${g.capacity_metric_tons} MT` : "—"}</td>
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
                {machines.length === 0 && (<tr><td colSpan={6} className="py-4"><EmptyState title="No machines yet" hint="Add your first machine." actionLabel="Add machine" onAction={() => setMachineForm("new")} /></td></tr>)}
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
                {packaging.length === 0 && (<tr><td colSpan={6} className="py-4"><EmptyState title="No packaging types yet" hint="Add your first packaging type." actionLabel="Add packaging type" onAction={() => setPackagingForm("new")} /></td></tr>)}
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
                {expenseCategories.length === 0 && (<tr><td colSpan={3} className="py-4"><EmptyState title="No categories yet" hint="Add your first category." actionLabel="Add expense category" onAction={() => setExpenseForm("new")} /></td></tr>)}
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
                {cashAccounts.length === 0 && (<tr><td colSpan={5} className="py-4"><EmptyState title="No cash accounts yet" hint="Add your first cash account." actionLabel="Add cash account" onAction={() => setCashForm("new")} /></td></tr>)}
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
            {processingTypes.length === 0 && <EmptyState title="No processing types yet" hint="Add your first processing type." actionLabel="Add processing type" onAction={() => setProcessingFormOpen(true)} />}
            {processingTypes.map((pt: any) => (
              <div key={pt.id} className="flex items-center justify-between py-2 border-b border-border">
                <span className="font-semibold">{pt.name} {pt.is_active === false ? <span className="text-muted-foreground">— Inactive</span> : ""}</span>
                <span>{rowActions("processing-type", pt, pt.name)}</span>
              </div>
            ))}
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
      <GodownFormDialog
        open={godownForm !== null}
        godown={godownForm === "new" ? null : godownForm}
        godowns={godowns}
        onClose={() => setGodownForm(null)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
      <ProductFormDialog
        open={productForm !== null}
        product={productForm === "new" ? null : productForm}
        products={products}
        onClose={() => setProductForm(null)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
        onCreateDraft={handleCreateDraft}
      />
      <MachineFormDialog
        open={machineForm !== null}
        machine={machineForm === "new" ? null : machineForm}
        machines={machines}
        onClose={() => setMachineForm(null)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
      <PackagingFormDialog
        open={packagingForm !== null}
        packagingType={packagingForm === "new" ? null : packagingForm}
        packagingTypes={packaging}
        onClose={() => setPackagingForm(null)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
      <ExpenseCategoryFormDialog
        open={expenseForm !== null}
        category={expenseForm === "new" ? null : expenseForm}
        onClose={() => setExpenseForm(null)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
      <CashAccountFormDialog
        open={cashForm !== null}
        account={cashForm === "new" ? null : cashForm}
        accounts={cashAccounts}
        onClose={() => setCashForm(null)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
      <ProcessingTypeFormDialog
        open={processingFormOpen}
        processingTypes={processingTypes}
        onClose={() => setProcessingFormOpen(false)}
        onSaved={(notice) => { setFormNotice(notice); void loadData() }}
      />
    </div>
  )
}
