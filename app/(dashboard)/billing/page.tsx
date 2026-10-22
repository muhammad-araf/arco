"use client"

import * as React from "react"
import {
  Receipt,
  Plus,
  Building2,
  DollarSign,
  CheckCircle2,
  FileText,
  Printer,
  CreditCard,
  TrendingUp,
} from "lucide-react"
import { GodownStore } from "@/lib/services/godown-store"
import { CustomerReceipt, Party } from "@/lib/types/database"
import { formatCurrency, formatDate } from "@/lib/utils"

export default function BillingPage() {
  const [receipts, setReceipts] = React.useState<CustomerReceipt[]>([])
  const [customers, setCustomers] = React.useState<Party[]>([])

  // Modal
  const [isReceiptModalOpen, setIsReceiptModalOpen] = React.useState(false)
  const [customerId, setCustomerId] = React.useState("")
  const [amount, setAmount] = React.useState<number>(100000)
  const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "bank" | "online">("bank")
  const [referenceNo, setReferenceNo] = React.useState("")
  const [notes, setNotes] = React.useState("")

  const loadData = React.useCallback(() => {
    const state = (GodownStore as any).getState()
    setReceipts(state.receipts || [])
    setCustomers(GodownStore.getParties().filter((p) => p.type === "customer" || p.type === "both"))
  }, [])

  React.useEffect(() => {
    loadData()
    window.addEventListener("arco-godown-data-updated", loadData)
    return () => window.removeEventListener("arco-godown-data-updated", loadData)
  }, [loadData])

  React.useEffect(() => {
    if (customers.length > 0 && !customerId) setCustomerId(customers[0].id)
  }, [customers, customerId])

  const totalReceivables = customers.reduce(
    (sum, c) => sum + (c.current_balance !== undefined ? c.current_balance : c.opening_balance),
    0
  )

  const handleRecordReceipt = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId || amount <= 0) return

    const selectedCust = customers.find((c) => c.id === customerId)
    const receiptNo = `RCT-2026-${String(receipts.length + 1).padStart(3, "0")}`

    const newReceipt: CustomerReceipt = {
      id: `rct-${Date.now()}`,
      receipt_no: receiptNo,
      date: new Date().toISOString(),
      customer_id: customerId,
      customer_name: selectedCust?.name,
      amount,
      payment_method: paymentMethod,
      reference_no: referenceNo || undefined,
      is_advance: false,
      notes: notes || undefined,
      created_at: new Date().toISOString(),
    }

    const state = (GodownStore as any).getState()
    state.receipts = [newReceipt, ...(state.receipts || [])]

    // Reduce customer receivable balance
    state.parties = state.parties.map((p: Party) =>
      p.id === customerId
        ? { ...p, current_balance: Math.max(0, (p.current_balance || p.opening_balance) - amount) }
        : p
    )

    // Add to cash ledger
    const lastCashBal = state.cashLedger.length > 0 ? state.cashLedger[state.cashLedger.length - 1].running_balance : 0
    state.cashLedger.push({
      id: `cl-${Date.now()}`,
      date: new Date().toISOString(),
      voucher_type: "receipt",
      voucher_id: newReceipt.id,
      voucher_no: receiptNo,
      account: paymentMethod === "cash" ? "cash" : "bank",
      debit: amount,
      credit: 0,
      running_balance: lastCashBal + amount,
      description: `Payment receipt from ${selectedCust?.name} (${referenceNo || "Direct"})`,
      created_at: new Date().toISOString(),
    })

    ;(GodownStore as any).saveState(state)
    setIsReceiptModalOpen(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-emerald-500" />
            Customer Billing, Invoices & Cash Receipts
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Collect service revenue, allocate customer payments to ledger statements, and reconcile accounts.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsReceiptModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>Record Customer Receipt</span>
        </button>
      </div>

      {/* Customer Balances & Statements Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 expensive-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-500" />
              Customer Ledger Accounts & Outstanding Balances
            </h2>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              Total Due: {formatCurrency(totalReceivables)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground uppercase text-[10px] font-bold">
                  <th className="pb-3 font-bold">Party Code</th>
                  <th className="pb-3 font-bold">Customer Name</th>
                  <th className="pb-3 font-bold">Contact / Phone</th>
                  <th className="pb-3 font-bold text-right">Opening Due</th>
                  <th className="pb-3 font-bold text-right">Current Balance</th>
                  <th className="pb-3 font-bold text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {customers.map((c) => {
                  const bal = c.current_balance !== undefined ? c.current_balance : c.opening_balance
                  return (
                    <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 font-mono font-bold text-muted-foreground">{c.code}</td>
                      <td className="py-3 font-bold text-foreground">
                        <div>{c.name}</div>
                        <div className="text-[10px] text-muted-foreground">{c.address || "Local District"}</div>
                      </td>
                      <td className="py-3 font-mono text-muted-foreground">{c.phone || "-"}</td>
                      <td className="py-3 text-right text-muted-foreground font-mono">{formatCurrency(c.opening_balance)}</td>
                      <td className="py-3 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm font-mono">
                        {formatCurrency(bal)}
                      </td>
                      <td className="py-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerId(c.id)
                            setIsReceiptModalOpen(true)
                          }}
                          className="px-2.5 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] cursor-pointer"
                        >
                          Collect Cash
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Collected Receipts Feed */}
        <div className="expensive-card p-5">
          <h2 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-emerald-500" />
            Recent Payment Receipts
          </h2>
          <p className="text-xs text-muted-foreground mb-4">Posted cash & online collections</p>

          <div className="space-y-3">
            {receipts.map((r) => (
              <div key={r.id} className="p-3 rounded-lg bg-card/60 border border-border/60 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-foreground">{r.receipt_no}</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(r.amount)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">{r.customer_name}</div>
                <div className="flex justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40 font-mono">
                  <span className="uppercase">{r.payment_method}</span>
                  <span>{formatDate(r.date)}</span>
                </div>
              </div>
            ))}
            {receipts.length === 0 && (
              <div className="py-8 text-center text-muted-foreground text-xs">
                No receipts recorded yet. Click "Record Customer Receipt" to log payment.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Receipt Modal */}
      {isReceiptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="expensive-card w-full max-w-md p-6 bg-card border border-border shadow-2xl rounded-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Receipt className="h-4 w-4 text-emerald-500" />
                Record Customer Cash/Bank Receipt
              </h3>
              <button
                type="button"
                onClick={() => setIsReceiptModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordReceipt} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-foreground mb-1">Customer / Payer</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  required
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (Due: {formatCurrency(c.current_balance !== undefined ? c.current_balance : c.opening_balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Amount Received (PKR)</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    min="1"
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Deposit Account</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                  >
                    <option value="bank">HBL Bank Account</option>
                    <option value="cash">Godown Counter Cash</option>
                    <option value="online">Online Transfer / Raast</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Cheque / Bank Reference No</label>
                <input
                  type="text"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  placeholder="e.g. CHQ-991204 or Transaction ID"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Remarks / Note</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Partial clearing of Batch 001 grading charges"
                  className="w-full px-2.5 py-2 rounded-lg bg-background border border-border text-foreground"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsReceiptModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Post Receipt to Daybook</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
