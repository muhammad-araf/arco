"use client"

/**
 * Daybook expense create dialog, POS-style: one modal form that owns
 * its own state, on the shared Modal kit — replacing the hand-rolled
 * `fixed inset-0 ... bg-black/60` expense modal on the Daybook page.
 * Same fields, same validation, same server actions, same
 * draft → post → print behaviour as the old modal.
 *
 * The expense print document still comes from the page: this dialog
 * hands the finished print row back via onPosted. The draft-edit
 * dialog lives in daybook-expense-edit-dialog.tsx.
 */
import * as React from "react"
import { CheckCircle2 } from "lucide-react"
import { submissionToken, resetSubmissionToken } from "@/lib/idempotency"
import { createExpense, postExpense } from "@/app/actions/finance"
import { AttachmentFields } from "@/components/attachment-fields"
import type { ExpenseVoucher } from "@/lib/types/database"
import { formatCurrency } from "@/lib/utils"
import { ConfirmDialog, SubmitSpinner, isPositive } from "@/components/erp-ui"
import {
  Field,
  Modal,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/erp-form"

/** The fallback category names the old modal showed when the database had no active categories. */
export const FALLBACK_EXPENSE_CATEGORIES = [
  "Generator Fuel & Diesel",
  "Electricity & Utility Bills",
  "Machine Repair & Maintenance",
  "Loading & Unloading Wages",
  "Transport & Local Cartage",
  "Staff Refreshment & Food",
  "General Store Supplies",
]

export function DaybookExpenseDialog({
  open,
  onClose,
  cashAccounts,
  vendors,
  expenseCategories,
  recordCount,
  onPosted,
  onDraftSaved,
}: {
  open: boolean
  onClose: () => void
  cashAccounts: any[]
  vendors: any[]
  expenseCategories: any[]
  /** expenses total — only used for the draft preview number. */
  recordCount: number
  /** (notice, print row) — the page sets its notice, shows the print document and reloads. */
  onPosted: (notice: string, printExpense: any) => void
  onDraftSaved: (notice: string) => void
}) {
  const [categoryName, setCategoryName] = React.useState("Generator Fuel & Diesel")
  const [expCategoryId, setExpCategoryId] = React.useState("")
  const [payee, setPayee] = React.useState("")
  const [amount, setAmount] = React.useState<number>(15000)
  const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "bank">("cash")
  const [location, setLocation] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [attachmentUrl, setAttachmentUrl] = React.useState("")
  const [attachmentNote, setAttachmentNote] = React.useState("")
  const [expSettlement, setExpSettlement] = React.useState<"paid" | "credit">("paid")
  const [expVendorId, setExpVendorId] = React.useState("")
  const [expCashAccountId, setExpCashAccountId] = React.useState("")
  const [error, setError] = React.useState("")
  const [isPending, setIsPending] = React.useState(false)
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [draftExpense, setDraftExpense] = React.useState<ExpenseVoucher | null>(null)
  const expenseGuard = React.useRef(false)
  const expenseTokenRef = React.useRef<string | null>(null)

  const activeCategories = expenseCategories.filter((c: any) => c.is_active !== false)

  // Fresh create on every open, with the old defaults: the fallback
  // category name, 15000, cash, paid, and the first cash-kind account
  // (no fallback to another kind — if none exists the account stays
  // empty and validation names it). Closing without saving discards
  // edits.
  React.useEffect(() => {
    if (!open) return
    setCategoryName("Generator Fuel & Diesel")
    const cat = expenseCategories.find((c: any) => c.name === "Generator Fuel & Diesel")
    setExpCategoryId(cat ? cat.id : "")
    setPayee("")
    setAmount(15000)
    setPaymentMethod("cash")
    setLocation("")
    setDescription("")
    setAttachmentUrl("")
    setAttachmentNote("")
    setExpSettlement("paid")
    setExpVendorId("")
    const first = cashAccounts.find((a) => a.account_kind === "cash")
    setExpCashAccountId(first ? first.id : "")
    setError("")
    setIsPending(false)
    setShowConfirm(false)
    setDraftExpense(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ])

  const expenseFormError = (): string | null => {
    if (!payee.trim()) return "Payee is required — who was this expense paid to?"
    if (!categoryName.trim()) return "Select or enter an expense category."
    if (!description.trim()) return "A short description is required so the daybook stays auditable."
    if (!isPositive(amount)) return "Expense amount must be greater than zero."
    if (expSettlement === "credit" && !expVendorId) return "A credit expense needs a vendor — the unpaid amount has to be owed to someone."
    if (expSettlement === "paid" && !expCashAccountId) return "Select the cash account this expense is paid from."
    return null
  }

  const expensePayload = () => ({
    categoryName, categoryId: expCategoryId || undefined, payee: payee.trim(), amount, paymentMethod,
    location: location.trim() || undefined,
    description: description.trim(), settlement: expSettlement,
    attachmentUrl: attachmentUrl || undefined, attachmentNote: attachmentNote || undefined,
    vendorId: expSettlement === "credit" ? expVendorId : undefined,
    cashAccountId: expSettlement === "paid" ? expCashAccountId : undefined,
    clientToken: submissionToken(expenseTokenRef, "expense"),
  })

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault()
    if (isPending) return
    const validationError = expenseFormError()
    if (validationError) return setError(validationError)
    setError("")
    setDraftExpense({
      id: `exp-${Date.now()}`,
      expense_no: `EXP-2026-${String(recordCount + 1).padStart(3, "0")}`,
      date: new Date().toISOString(),
      category_id: expCategoryId || "",
      category_name: categoryName,
      payee,
      amount,
      payment_method: paymentMethod,
      description,
      status: "posted",
      created_at: new Date().toISOString(),
    })
    setShowConfirm(true)
  }

  const handleConfirmExpense = async () => {
    if (!draftExpense || expenseGuard.current) return
    expenseGuard.current = true
    setIsPending(true)
    try {
      const created = await createExpense(expensePayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not create the expense.")
        setShowConfirm(false)
        return
      }
      const posted = await postExpense((created.data as any).id)
      if (!posted.success) {
        setError(posted.error ?? "Could not post the expense.")
        setShowConfirm(false)
        return
      }
      const row: any = posted.data ?? created.data
      const notice = `${row.expense_no ?? draftExpense.expense_no} posted — ${formatCurrency(amount)} for ${categoryName} (${expSettlement === "credit" ? "credit, unpaid" : paymentMethod}).`
      const printExpense = { ...draftExpense, ...row, status: "posted", category_name: categoryName, payee, amount, payment_method: paymentMethod, description }
      onClose()
      onPosted(notice, printExpense)
      resetSubmissionToken(expenseTokenRef)
      setDraftExpense(null)
    } finally {
      setIsPending(false)
      expenseGuard.current = false
    }
  }

  const handleSaveExpenseDraft = async () => {
    if (isPending) return
    const validationError = expenseFormError()
    if (validationError) return setError(validationError)
    setIsPending(true)
    try {
      const created = await createExpense(expensePayload())
      if (!created.success || !(created.data as any)?.id) {
        setError(created.error ?? "Could not save the expense draft.")
        return
      }
      const row: any = created.data
      onDraftSaved(`${row.expense_no ?? "Expense"} saved as draft — post it from the expenses table below.`)
      onClose()
      resetSubmissionToken(expenseTokenRef)
    } finally {
      setIsPending(false)
    }
  }

  const setCategory = (name: string) => {
    setCategoryName(name)
    const cat = expenseCategories.find((c: any) => c.name === name)
    setExpCategoryId(cat ? cat.id : "")
  }

  if (!open) return null
  return (
    <>
      <Modal
        open={open}
        onClose={showConfirm ? () => {} : onClose}
        title="Record Operational Expense"
        description="Money spent running the godown — fuel, repairs, wages. Posted expenses reduce cash."
        wide
      >
        <form onSubmit={handleAddExpense} className="space-y-4 text-xs">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <Field id="expense-category" label="Expense Category" required>
            <select
              id="expense-category"
              title={categoryName}
              required
              value={categoryName}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              {activeCategories.length > 0 ? (
                activeCategories.map((c: any) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))
              ) : (
                FALLBACK_EXPENSE_CATEGORIES.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))
              )}
            </select>
            {activeCategories.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">No categories in the database yet — these are fallback names. Create real categories on the Masters page.</p>
            )}
          </Field>

          <Field id="expense-location" label="Location (optional)">
            <input
              id="expense-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Main godown, site, market"
              className={inputClass}
            />
          </Field>

          <Field id="payee-vendor-name" label="Payee / Vendor Name" required>
            <input
              id="payee-vendor-name"
              type="text"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="e.g. Parco / Electrician"
              className={inputClass}
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field id="amount-pkr" label="Amount (PKR)" required>
              <input
                id="amount-pkr"
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                min="1"
                className={`${inputClass} font-mono`}
                required
              />
            </Field>
            <Field id="paid-from" label="Paid From" required>
              <select
                id="paid-from"
                required
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as "cash" | "bank")}
                className={inputClass}
              >
                <option value="cash">Godown Cash Counter</option>
                <option value="bank">Bank Account</option>
              </select>
            </Field>
          </div>

          <Field id="settlement" label="Settlement" required>
            <select
              id="settlement"
              required
              value={expSettlement}
              onChange={(e) => setExpSettlement(e.target.value as "paid" | "credit")}
              className={inputClass}
            >
              <option value="paid">Paid now (cash out on posting)</option>
              <option value="credit">Credit (unpaid — settle later as a vendor payment)</option>
            </select>
          </Field>
          {expSettlement === "credit" && (
            <Field id="vendor-owed" label="Vendor owed" required>
              <select
                id="vendor-owed"
                title={vendors.find((v: any) => v.id === expVendorId)?.name ?? ""}
                value={expVendorId}
                onChange={(e) => setExpVendorId(e.target.value)}
                className={inputClass}
                required
              >
                <option value="">Select vendor</option>
                {vendors.map((v: any) => (<option key={v.id} value={v.id}>{v.name}</option>))}
              </select>
            </Field>
          )}
          {expSettlement === "paid" && (
            <Field id="cash-account" label="Cash account" required>
              <select
                id="cash-account"
                title={cashAccounts.find((a) => a.id === expCashAccountId) ? `${cashAccounts.find((a) => a.id === expCashAccountId)?.code} — ${cashAccounts.find((a) => a.id === expCashAccountId)?.name}` : ""}
                value={expCashAccountId}
                onChange={(e) => setExpCashAccountId(e.target.value)}
                className={inputClass}
                required
              >
                <option value="">Select account</option>
                {cashAccounts.filter((a) => a.account_kind === paymentMethod && a.is_active !== false).map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
              </select>
              {cashAccounts.filter((a) => a.account_kind === paymentMethod && a.is_active !== false).length === 0 && (<p className="mt-1 text-[11px] text-muted-foreground">No {paymentMethod} account yet — create one on the Masters page.</p>)}
            </Field>
          )}

          <Field id="particulars-description" label="Particulars / Description" required>
            <input
              id="particulars-description"
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. 50L diesel for cleaner"
              className={inputClass}
            />
          </Field>

          <AttachmentFields url={attachmentUrl} note={attachmentNote} onUrlChange={setAttachmentUrl} onNoteChange={setAttachmentNote} idPrefix="expense" />

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveExpenseDraft}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-card border border-border text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              Save as draft
            </button>
            <button type="submit" disabled={isPending} className={primaryButtonClass}>
              {isPending ? <SubmitSpinner /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{isPending ? "Posting…" : "Post Expense to Cashbook"}</span>
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={showConfirm}
        title="Post this expense?"
        description={draftExpense ? `${draftExpense.expense_no}: ${formatCurrency(draftExpense.amount)} to ${draftExpense.payee} for ${draftExpense.category_name} (${expSettlement === "credit" ? "credit, unpaid" : `paid via ${draftExpense.payment_method}`}).` : ""}
        confirmLabel="Post Expense to Cashbook"
        pending={isPending}
        onConfirm={handleConfirmExpense}
        onCancel={() => { setShowConfirm(false); setDraftExpense(null) }}
      />
    </>
  )
}
