import type { CompanyDetails } from "./types"
import { fmtNum, sum, text } from "./types"
import { EmptyRow, PrintDocument, PrintField, PrintInfoGrid, PrintSectionTitle, SignatureRow } from "./print-layout"

export interface StockLedgerRow { date?: string; voucherNo?: string; type?: string; godown?: string; product?: string; lot?: string; inwardQty?: number | string; outwardQty?: number | string; balance?: number | string }
export interface StockLedgerPrintProps {
  company?: CompanyDetails
  godown?: string
  product?: string
  dateFrom?: string
  dateTo?: string
  rows?: StockLedgerRow[]
  preparedBy?: string
}

/** A4 stock ledger: filtered rows as shown on the Ledgers Stock tab, with inward/outward totals. Renders existing data only. */
export function StockLedgerPrint(props: StockLedgerPrintProps) {
  const rows = Array.isArray(props.rows) ? props.rows : []
  const inward = sum(rows, (r) => r.inwardQty)
  const outward = sum(rows, (r) => r.outwardQty)
  const range = [props.dateFrom, props.dateTo].filter(Boolean).join(" to ")
  return (
    <PrintDocument company={props.company} title="STOCK LEDGER" meta={[{ label: "Period", value: range || undefined }, { label: "Godown", value: props.godown }, { label: "Product", value: props.product }]}>
      <PrintSectionTitle>Summary</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Total Inward (kg)" value={fmtNum(inward)} />
        <PrintField label="Total Outward (kg)" value={fmtNum(outward)} />
        <PrintField label="Rows" value={String(rows.length)} />
      </PrintInfoGrid>
      <PrintSectionTitle>Entries</PrintSectionTitle>
      <table className="print-table">
        <thead><tr><th>Date</th><th>Voucher</th><th>Type</th><th>Godown</th><th>Product</th><th>Lot</th><th className="print-col-number">Inward</th><th className="print-col-number">Outward</th><th className="print-col-number">Balance</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={9} label="No stock ledger rows in this period." /> : rows.map((r, i) => (
            <tr key={i}><td>{text(r.date)}</td><td>{text(r.voucherNo)}</td><td>{text(r.type)}</td><td>{text(r.godown)}</td><td>{text(r.product)}</td><td>{text(r.lot)}</td><td className="print-col-number">{fmtNum(r.inwardQty)}</td><td className="print-col-number">{fmtNum(r.outwardQty)}</td><td className="print-col-number">{fmtNum(r.balance)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={6} className="print-total-label">Total</td><td className="print-col-number">{fmtNum(inward)}</td><td className="print-col-number">{fmtNum(outward)}</td><td className="print-col-number">—</td></tr></tfoot>
      </table>
      <PrintSectionTitle>Prepared By</PrintSectionTitle>
      <SignatureRow signatures={[{ label: "Prepared By", name: props.preparedBy }]} />
    </PrintDocument>
  )
}
