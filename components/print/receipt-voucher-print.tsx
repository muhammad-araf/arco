import type { CompanyDetails } from "./types"
import { fmtNum, num, sum } from "./types"
import {
  EmptyRow,
  PrintDocument,
  PrintField,
  PrintInfoGrid,
  PrintSectionTitle,
  SignatureRow,
} from "./print-layout"

export interface ReceiptAllocation {
  /** Invoice / charge the receipt is allocated against. */
  invoiceNo?: string
  description?: string
  amount?: number | string
}

export interface ReceiptVoucherPrintProps {
  company?: CompanyDetails
  receiptNo?: string
  date?: string
  customerName?: string
  /** "cash" | "bank" | "online" — shown as-is when other values arrive. */
  paymentMethod?: string
  /** Cash/bank account the money went into. */
  account?: string
  referenceNo?: string
  /** Optional: what the receipt is for. */
  purpose?: string
  amount?: number | string
  /** Amount in words, when the page supplies it. */
  amountInWords?: string
  allocations?: ReceiptAllocation[]
  notes?: string
  receivedBy?: string
  preparedBy?: string
}

/**
 * Receipt voucher (spec §12 / §11): who paid, how, into which account,
 * and the allocation detail — which invoices/charges the receipt
 * settles. When allocations are given, their total is shown next to
 * the voucher amount so any shortfall stays visible instead of hidden.
 */
export function ReceiptVoucherPrint(props: ReceiptVoucherPrintProps) {
  const allocations = Array.isArray(props.allocations) ? props.allocations : []
  const allocatedTotal = sum(allocations, (a) => a.amount)
  const amount = num(props.amount)

  return (
    <PrintDocument
      company={props.company}
      title="RECEIPT VOUCHER"
      docLabel="Receipt No."
      docNumber={props.receiptNo ?? "—"}
      meta={[{ label: "Date", value: props.date }]}
    >
      <PrintSectionTitle>Receipt Details</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Received From" value={props.customerName} />
        <PrintField label="Payment Method" value={props.paymentMethod} />
        <PrintField label="Account" value={props.account} />
        <PrintField label="Reference No." value={props.referenceNo} />
        <PrintField label="Purpose" value={props.purpose} />
        <PrintField label="Amount" value={fmtNum(amount)} />
        <PrintField label="Amount in Words" value={props.amountInWords} />
      </PrintInfoGrid>

      <PrintSectionTitle>Allocation Details</PrintSectionTitle>
      <table className="print-table">
        <thead>
          <tr>
            <th className="print-col-narrow">#</th>
            <th>Invoice / Charge</th>
            <th>Description</th>
            <th className="print-col-number">Amount</th>
          </tr>
        </thead>
        <tbody>
          {allocations.length === 0 ? (
            <EmptyRow colSpan={4} label="No allocation detail — receipt applied as a single unallocated amount." />
          ) : (
            allocations.map((a, idx) => (
              <tr key={idx}>
                <td className="print-col-narrow">{idx + 1}</td>
                <td>{a.invoiceNo ?? "—"}</td>
                <td>{a.description ?? "—"}</td>
                <td className="print-col-number">{fmtNum(a.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="print-total-label">
              Total Allocated
            </td>
            <td className="print-col-number">{fmtNum(allocatedTotal)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="print-total-label">
              Voucher Amount
            </td>
            <td className="print-col-number">{fmtNum(amount)}</td>
          </tr>
        </tfoot>
      </table>

      {props.notes ? (
        <>
          <PrintSectionTitle>Notes</PrintSectionTitle>
          <p className="print-notes">{props.notes}</p>
        </>
      ) : null}

      <PrintSectionTitle>Signatures</PrintSectionTitle>
      <SignatureRow
        signatures={[
          { label: "Received By", name: props.receivedBy },
          { label: "Prepared By", name: props.preparedBy },
        ]}
      />
    </PrintDocument>
  )
}
