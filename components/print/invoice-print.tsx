import type { CompanyDetails } from "./types"
import { fmtNum, num, sum, text } from "./types"
import { EmptyRow, PrintDocument, PrintField, PrintInfoGrid, PrintSectionTitle, SignatureRow } from "./print-layout"

export interface InvoiceLine { description?: string; quantity?: number | string; unitPrice?: number | string; amount?: number | string }
export interface InvoicePrintProps {
  company?: CompanyDetails
  invoiceNo?: string
  date?: string
  customerName?: string
  status?: string
  lines?: InvoiceLine[]
  total?: number | string
  paid?: number | string
  balance?: number | string
  notes?: string
  preparedBy?: string
}

/** A4 customer invoice: header, one line (or lines), totals and balance. Renders existing invoice data only. */
export function InvoicePrint(props: InvoicePrintProps) {
  const lines = Array.isArray(props.lines) ? props.lines : []
  const total = props.total !== undefined && props.total !== null ? num(props.total) : sum(lines, (l) => l.amount ?? num(l.quantity) * num(l.unitPrice))
  const paid = num(props.paid)
  const balance = props.balance !== undefined && props.balance !== null ? num(props.balance) : total - paid
  return (
    <PrintDocument company={props.company} title="INVOICE" docLabel="Invoice No." docNumber={props.invoiceNo}
      meta={[{ label: "Date", value: props.date }, { label: "Customer", value: props.customerName }, { label: "Status", value: props.status }]}>
      <PrintSectionTitle>Summary</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Total" value={fmtNum(total)} />
        <PrintField label="Paid" value={fmtNum(paid)} />
        <PrintField label="Balance" value={fmtNum(balance)} />
      </PrintInfoGrid>
      <PrintSectionTitle>Items</PrintSectionTitle>
      <table className="print-table">
        <thead><tr><th>Description</th><th className="print-col-number">Quantity</th><th className="print-col-number">Unit Price</th><th className="print-col-number">Amount</th></tr></thead>
        <tbody>
          {lines.length === 0 ? <EmptyRow colSpan={4} label="No invoice lines." /> : lines.map((l, i) => (
            <tr key={i}><td>{text(l.description)}</td><td className="print-col-number">{fmtNum(l.quantity)}</td><td className="print-col-number">{fmtNum(l.unitPrice)}</td><td className="print-col-number">{fmtNum(l.amount ?? num(l.quantity) * num(l.unitPrice))}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={3} className="print-total-label">Total</td><td className="print-col-number">{fmtNum(total)}</td></tr></tfoot>
      </table>
      {props.notes ? (<><PrintSectionTitle>Notes</PrintSectionTitle><p>{props.notes}</p></>) : null}
      <PrintSectionTitle>Prepared By</PrintSectionTitle>
      <SignatureRow signatures={[{ label: "Prepared By", name: props.preparedBy }]} />
    </PrintDocument>
  )
}
