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

export interface StatementRow {
  date?: string
  voucherNo?: string
  description?: string
  /** "invoice" | "receipt" | "credit" | "adjustment" — shown as-is when other values arrive. */
  type?: string
  /** Charge / debit amount. */
  debit?: number | string
  /** Receipt / credit amount. */
  credit?: number | string
  /** Override; otherwise the running balance is computed from opening. */
  balance?: number | string
}

export interface CustomerStatementPrintProps {
  company?: CompanyDetails
  customerName?: string
  customerPhone?: string
  customerAddress?: string
  dateFrom?: string
  dateTo?: string
  /** Signed opening balance: positive = amount owed by the customer. */
  openingBalance?: number | string
  rows?: StatementRow[]
  /** Override; otherwise opening + debits − credits. */
  closingBalance?: number | string
  preparedBy?: string
}

/**
 * Customer statement (spec §11.3 / §16): opening, charges/invoices,
 * receipts, credits, and a running balance over a date range. When a
 * row carries no explicit balance, the running balance is computed
 * from the opening balance in row order.
 */
export function CustomerStatementPrint(props: CustomerStatementPrintProps) {
  const rows = Array.isArray(props.rows) ? props.rows : []
  const opening = num(props.openingBalance)
  const totalDebit = sum(rows, (r) => r.debit)
  const totalCredit = sum(rows, (r) => r.credit)
  const closing =
    props.closingBalance !== undefined && props.closingBalance !== null
      ? num(props.closingBalance)
      : opening + totalDebit - totalCredit
  const range = [props.dateFrom, props.dateTo].filter(Boolean).join(" to ")

  // Running balances, honouring an explicit per-row balance when given.
  let running = opening
  const balances = rows.map((row) => {
    if (row.balance !== undefined && row.balance !== null) {
      running = num(row.balance)
    } else {
      running = running + num(row.debit) - num(row.credit)
    }
    return running
  })

  return (
    <PrintDocument
      company={props.company}
      title="CUSTOMER STATEMENT OF ACCOUNT"
      docLabel="Customer"
      docNumber={props.customerName ?? "—"}
      meta={[
        { label: "Period", value: range || undefined },
        { label: "Contact", value: props.customerPhone },
        { label: "Address", value: props.customerAddress },
      ]}
    >
      <PrintSectionTitle>Summary</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Opening Balance" value={fmtNum(opening)} />
        <PrintField label="Total Charges / Invoices" value={fmtNum(totalDebit)} />
        <PrintField label="Total Receipts / Credits" value={fmtNum(totalCredit)} />
        <PrintField label="Closing Balance" value={fmtNum(closing)} />
      </PrintInfoGrid>

      <PrintSectionTitle>Transactions</PrintSectionTitle>
      <table className="print-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Voucher</th>
            <th>Type</th>
            <th>Description</th>
            <th className="print-col-number">Debit</th>
            <th className="print-col-number">Credit</th>
            <th className="print-col-number">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="print-opening-row">
            <td colSpan={4}>Opening Balance</td>
            <td className="print-col-number">—</td>
            <td className="print-col-number">—</td>
            <td className="print-col-number">{fmtNum(opening)}</td>
          </tr>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} label="No transactions in this period." />
          ) : (
            rows.map((row, idx) => (
              <tr key={idx}>
                <td>{row.date ?? "—"}</td>
                <td>{row.voucherNo ?? "—"}</td>
                <td>{row.type ?? "—"}</td>
                <td>{row.description ?? "—"}</td>
                <td className="print-col-number">{fmtNum(row.debit)}</td>
                <td className="print-col-number">{fmtNum(row.credit)}</td>
                <td className="print-col-number">{fmtNum(balances[idx])}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="print-total-label">
              Total / Closing
            </td>
            <td className="print-col-number">{fmtNum(totalDebit)}</td>
            <td className="print-col-number">{fmtNum(totalCredit)}</td>
            <td className="print-col-number">{fmtNum(closing)}</td>
          </tr>
        </tfoot>
      </table>

      <PrintSectionTitle>Prepared By</PrintSectionTitle>
      <SignatureRow signatures={[{ label: "Prepared By", name: props.preparedBy }]} />
    </PrintDocument>
  )
}
