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

export interface DaybookRow {
  date?: string
  voucherNo?: string
  /** e.g. "Receipt", "Expense", "Purchase Payment", "Transfer". */
  voucherType?: string
  description?: string
  party?: string
  /** Money in. */
  receipt?: number | string
  /** Money out. */
  payment?: number | string
  /**
   * Signed internal transfer: positive = transfer in, negative =
   * transfer out. Transfers move money between accounts and are never
   * revenue or expense (spec §12.3).
   */
  transfer?: number | string
}

export interface DaybookPrintProps {
  company?: CompanyDetails
  /** Cash/bank account this daybook covers, e.g. "Cash". */
  accountName?: string
  dateFrom?: string
  dateTo?: string
  openingBalance?: number | string
  rows?: DaybookRow[]
  /** Override; otherwise opening + receipts − payments + transfers. */
  closingBalance?: number | string
  preparedBy?: string
}

/**
 * Daybook / cashbook (spec §12): per account and date range, opening,
 * receipts, payments, transfers, closing, and one row per voucher.
 * Closing = opening + receipts − payments + transfers, so a signed
 * transfer column keeps the formula visible in the totals row.
 */
export function DaybookPrint(props: DaybookPrintProps) {
  const rows = Array.isArray(props.rows) ? props.rows : []
  const opening = num(props.openingBalance)
  const totalReceipts = sum(rows, (r) => r.receipt)
  const totalPayments = sum(rows, (r) => r.payment)
  const totalTransfers = sum(rows, (r) => r.transfer)
  const closing =
    props.closingBalance !== undefined && props.closingBalance !== null
      ? num(props.closingBalance)
      : opening + totalReceipts - totalPayments + totalTransfers
  const range = [props.dateFrom, props.dateTo].filter(Boolean).join(" to ")

  return (
    <PrintDocument
      company={props.company}
      title="DAYBOOK / CASHBOOK"
      docLabel="Account"
      docNumber={props.accountName ?? "—"}
      meta={[{ label: "Period", value: range || undefined }]}
    >
      <PrintSectionTitle>Summary</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Opening Balance" value={fmtNum(opening)} />
        <PrintField label="Total Receipts" value={fmtNum(totalReceipts)} />
        <PrintField label="Total Payments" value={fmtNum(totalPayments)} />
        <PrintField label="Net Transfers" value={fmtNum(totalTransfers)} />
        <PrintField label="Closing Balance" value={fmtNum(closing)} />
      </PrintInfoGrid>
      <p className="print-total-line">
        Closing = Opening ({fmtNum(opening)}) + Receipts ({fmtNum(totalReceipts)}) − Payments (
        {fmtNum(totalPayments)}) + Transfers ({fmtNum(totalTransfers)}) = {fmtNum(closing)}
      </p>

      <PrintSectionTitle>Entries</PrintSectionTitle>
      <table className="print-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Voucher</th>
            <th>Type</th>
            <th>Description / Party</th>
            <th className="print-col-number">Receipt</th>
            <th className="print-col-number">Payment</th>
            <th className="print-col-number">Transfer</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} label="No entries in this period." />
          ) : (
            rows.map((row, idx) => (
              <tr key={idx}>
                <td>{row.date ?? "—"}</td>
                <td>{row.voucherNo ?? "—"}</td>
                <td>{row.voucherType ?? "—"}</td>
                <td>
                  {row.description ?? "—"}
                  {row.party ? <span className="print-sub"> ({row.party})</span> : null}
                </td>
                <td className="print-col-number">{fmtNum(row.receipt)}</td>
                <td className="print-col-number">{fmtNum(row.payment)}</td>
                <td className="print-col-number">{fmtNum(row.transfer)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="print-total-label">
              Total
            </td>
            <td className="print-col-number">{fmtNum(totalReceipts)}</td>
            <td className="print-col-number">{fmtNum(totalPayments)}</td>
            <td className="print-col-number">{fmtNum(totalTransfers)}</td>
          </tr>
          <tr>
            <td colSpan={4} className="print-total-label">
              Opening / Closing
            </td>
            <td colSpan={2} className="print-col-number">
              Opening: {fmtNum(opening)}
            </td>
            <td className="print-col-number">Closing: {fmtNum(closing)}</td>
          </tr>
        </tfoot>
      </table>

      <PrintSectionTitle>Prepared By</PrintSectionTitle>
      <SignatureRow signatures={[{ label: "Prepared By", name: props.preparedBy }]} />
    </PrintDocument>
  )
}
