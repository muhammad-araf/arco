import type { CompanyDetails } from "./types"
import { fmtNum, num, sum, text } from "./types"
import { EmptyRow, PrintDocument, PrintField, PrintInfoGrid, PrintSectionTitle, SignatureRow } from "./print-layout"

export interface PurchaseLine { product?: string; quantity?: number | string; unitPrice?: number | string; amount?: number | string }
export interface PurchasePrintProps {
  company?: CompanyDetails
  purchaseNo?: string
  date?: string
  vendorName?: string
  godown?: string
  invoiceRef?: string
  status?: string
  lines?: PurchaseLine[]
  total?: number | string
  paid?: number | string
  balance?: number | string
  notes?: string
  preparedBy?: string
}

/** A4 purchase voucher: header, lines, totals and balance. Renders existing purchase data only. */
export function PurchasePrint(props: PurchasePrintProps) {
  const lines = Array.isArray(props.lines) ? props.lines : []
  const total = props.total !== undefined && props.total !== null ? num(props.total) : sum(lines, (l) => l.amount ?? num(l.quantity) * num(l.unitPrice))
  const paid = num(props.paid)
  const balance = props.balance !== undefined && props.balance !== null ? num(props.balance) : total - paid
  return (
    <PrintDocument company={props.company} title="PURCHASE VOUCHER" docLabel="Purchase No." docNumber={props.purchaseNo}
      meta={[{ label: "Date", value: props.date }, { label: "Vendor", value: props.vendorName }, { label: "Godown", value: props.godown }, { label: "Invoice Ref", value: props.invoiceRef }, { label: "Status", value: props.status }]}>
      <PrintSectionTitle>Summary</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Total" value={fmtNum(total)} />
        <PrintField label="Paid" value={fmtNum(paid)} />
        <PrintField label="Balance" value={fmtNum(balance)} />
      </PrintInfoGrid>
      <PrintSectionTitle>Items</PrintSectionTitle>
      <table className="print-table">
        <thead><tr><th>Product</th><th className="print-col-number">Quantity</th><th className="print-col-number">Unit Price</th><th className="print-col-number">Amount</th></tr></thead>
        <tbody>
          {lines.length === 0 ? <EmptyRow colSpan={4} label="No purchase lines." /> : lines.map((l, i) => (
            <tr key={i}><td>{text(l.product)}</td><td className="print-col-number">{fmtNum(l.quantity)}</td><td className="print-col-number">{fmtNum(l.unitPrice)}</td><td className="print-col-number">{fmtNum(l.amount ?? num(l.quantity) * num(l.unitPrice))}</td></tr>
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
