"use client"

/**
 * Draft expense edit dialog, POS-style: one modal form on the shared
 * Modal kit — replacing the hand-rolled `fixed inset-0 ... bg-black/60`
 * edit modal on the Daybook page. Same fields, same validation, same
 * updateExpense action as the old modal. Only draft expenses can be
 * edited; posted expenses are corrected by reversal, as before.
 *
 * The old edit form had no attachment fields, and this one does not
 * either — attachments are only recorded at creation.
 */
import * as React from "react"
import { updateExpense } from "@/app/actions/finance"
import { SubmitSpinner, isPositive } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"
import { FALLBACK_EXPENSE_CATEGORIES } from "@/components/daybook-expense-dialog"

export function DaybookExpenseEditDialog({
  open,
  onClose,
  expense,
  cashAccounts,
  vendors,
  expenseCategories,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** null = closed; a draft row = editing it. */
  expense: any | null
  cashAccounts: any[]
  vendors: any[]
  expenseCategories: any[]
  /** (notice) — the page sets its notice and reloads. */
  onSaved: (notice: string) => void
}) {
  const [editCategoryName, setEditCategoryName] = React.useState("")
  const [editPayee, setEditPayee] = React.useState("")
  const [editAmount, setEditAmount] = React.useState<number>(0)
  const [editPaymentMethod, setEditPaymentMethod] = React.useState<"cash" | "bank">("cash")
  const [editLocation, setEditLocation] = React.useState("")
  const [editDescription, setEditDescription] = React.useState("")
  const [editSettlement, setEditSettlement] = React.useState<"paid" | "credit">("paid")
  const [editVendorId, setEditVendorId] = React.useState("")
  const [editCashAccountId, setEditCashAccountId] = React.useState("")
  const [error, setError] = React.useState("")
  const [editPending, setEditPending] = React.useState(false)

  // Initialised from the row on every open, exactly as the old
  // openEditExpense did — including its bank-else-cash rule for the
  // payment method.
  React.useEffect(() => {
    if (!open || !expense) return
    setEditCategoryName(expense.category_name ?? "")
    setEditPayee(expense.payee ?? "")
    setEditAmount(Number(expense.amount || 0))
    setEditPaymentMethod(expense.payment_method === "bank" ? "bank" : "cash")
    setEditLocation(expense.location ?? "")
    setEditDescription(expense.description ?? "")
    setEditSettlement(expense.settlement === "credit" ? "credit" : "paid")
    setEditVendorId(expense.vendor_id ?? "")
    setEditCashAccountId(expense.cash_account_id ?? "")
    setError("")
    setEditPending(false)
  }, [open, expense])

  const activeCategories = expenseCategories.filter((c: any) => c.is_active !== false)

  const handleSaveExpenseEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!expense || editPending) return
    if (!editPayee.trim()) return setError("Payee is required.")
    if (!editCategoryName.trim()) return setError("Select an expense category.")
    if (!isPositive(editAmount)) return setError("Expense amount must be greater than zero.")
    if (editSettlement === "credit" && !editVendorId) return setError("A credit expense needs a vendor.")
    if (editSettlement === "paid" && !editCashAccountId) return setError("Select the cash account this expense is paid from.")
    setEditPending(true)
    try {
      const cat = expenseCategories.find((c: any) => c.name === editCategoryName)
      const res = await updateExpense({
        id: expense.id, categoryName: editCategoryName.trim(),
        categoryId: cat ? cat.id : undefined, payee: editPayee.trim(), amount: editAmount,
        paymentMethod: editPaymentMethod, location: editLocation.trim() || null,
        description: editDescription.trim() || null, settlement: editSettlement,
        vendorId: editSettlement === "credit" ? editVendorId : null,
        cashAccountId: editSettlement === "paid" ? editCashAccountId : null,
      })
      if (!res.success) { setError(res.error ?? "Could not update the expense."); return }
      onSaved(`Expense ${expense.expense_no} updated.`)
      onClose()
    } finally {
      setEditPending(false)
    }
  }

  if (!open || !expense) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit draft expense ${expense.expense_no}`}
      description="Only draft expenses can be edited. Posted expenses are corrected by reversal."
      wide
    >
      <form onSubmit={handleSaveExpenseEdit} className="space-y-4 text-xs">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <Field id="edit-expense-category" label="Category" required>
          <select
            id="edit-expense-category"
            title={editCategoryName}
            required
            value={editCategoryName}
            onChange={(e) => setEditCategoryName(e.target.value)}
            className={inputClass}
          >
            {activeCategories.length > 0 ? (
              activeCategories.map((c: any) => (<option key={c.id} value={c.name}>{c.name}</option>))
            ) : (
              FALLBACK_EXPENSE_CATEGORIES.map((name) => (<option key={name} value={name}>{name}</option>))
            )}
          </select>
        </Field>
        <Field id="edit-payee" label="Payee" required>
          <input id="edit-payee" value={editPayee} onChange={(e) => setEditPayee(e.target.value)} className={inputClass} required />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="edit-amount" label="Amount (PKR)" required>
            <input id="edit-amount" type="number" min="1" value={editAmount} onChange={(e) => setEditAmount(Number(e.target.value))} className={`${inputClass} font-mono`} required />
          </Field>
          <Field id="edit-paid-from" label="Paid From" required>
            <select id="edit-paid-from" required value={editPaymentMethod} onChange={(e) => setEditPaymentMethod(e.target.value as "cash" | "bank")} className={inputClass}>
              <option value="cash">Godown Cash Counter</option>
              <option value="bank">Bank Account</option>
            </select>
          </Field>
        </div>
        <Field id="edit-settlement" label="Settlement" required>
          <select id="edit-settlement" required value={editSettlement} onChange={(e) => setEditSettlement(e.target.value as "paid" | "credit")} className={inputClass}>
            <option value="paid">Paid now (cash out on posting)</option>
            <option value="credit">Credit (unpaid — settle later as a vendor payment)</option>
          </select>
        </Field>
        {editSettlement === "credit" && (
          <Field id="edit-vendor" label="Vendor owed" required>
            <select id="edit-vendor" value={editVendorId} onChange={(e) => setEditVendorId(e.target.value)} className={inputClass} required>
              <option value="">Select vendor</option>
              {vendors.map((v: any) => (<option key={v.id} value={v.id}>{v.name}</option>))}
            </select>
          </Field>
        )}
        {editSettlement === "paid" && (
          <Field id="edit-cash-account" label="Cash account" required>
            <select id="edit-cash-account" value={editCashAccountId} onChange={(e) => setEditCashAccountId(e.target.value)} className={inputClass} required>
              <option value="">Select account</option>
              {cashAccounts.filter((a) => a.account_kind === editPaymentMethod && a.is_active !== false).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
            </select>
          </Field>
        )}
        <Field id="edit-location" label="Location (optional)">
          <input id="edit-location" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className={inputClass} />
        </Field>
        <Field id="edit-description" label="Particulars / Description" required>
          <input id="edit-description" required value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className={inputClass} />
        </Field>
        <p className="text-[11px] text-muted-foreground">Only draft expenses can be edited. Posted expenses are corrected by reversal.</p>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
          <button type="submit" disabled={editPending} className={primaryButtonClass}>
            {editPending ? <SubmitSpinner /> : null}
            <span>{editPending ? "Saving…" : "Save changes"}</span>
          </button>
        </div>
      </form>
    </Modal>
  )
}
