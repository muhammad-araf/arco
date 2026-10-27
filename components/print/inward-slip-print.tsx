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

export interface InwardSlipItem {
  product?: string
  productCode?: string
  bags?: number | string
  grossWeightKg?: number | string
  /** Total tare weight in kg for the line. */
  tareWeightKg?: number | string
  /**
   * Net weight in kg. When absent it is derived as gross − tare, per
   * spec §4 (net = gross − bags × tare, with tare given as a line total).
   */
  netWeightKg?: number | string
  unit?: string
  remarks?: string
}

export interface InwardSlipPrintProps {
  company?: CompanyDetails
  voucherNo?: string
  date?: string
  time?: string
  supplierName?: string
  /** e.g. "Supplier", "Customer-owned", "Consignment". */
  sourceType?: string
  /** "Business-owned" vs "Customer-owned" stock, when known. */
  ownerType?: string
  godown?: string
  biltyNo?: string
  vehicleNo?: string
  driverName?: string
  /** Delivery method / staff member who brought the goods in. */
  byHand?: string
  nature?: string
  items?: InwardSlipItem[]
  totalBags?: number | string
  totalGrossKg?: number | string
  totalTareKg?: number | string
  totalNetKg?: number | string
  notes?: string
  attachmentUrl?: string
  attachmentNote?: string
  receivedBy?: string
}

function lineNet(item: InwardSlipItem): number {
  if (item.netWeightKg !== undefined && item.netWeightKg !== null) return num(item.netWeightKg)
  return num(item.grossWeightKg) - num(item.tareWeightKg)
}

/**
 * Receiving voucher / inward slip (spec §4.2): supplier/source, godown,
 * bilty/vehicle, item lines with bags, gross, tare and net, totals, and
 * the received-by signature.
 */
export function InwardSlipPrint(props: InwardSlipPrintProps) {
  const items = Array.isArray(props.items) ? props.items : []
  const totalBags =
    props.totalBags !== undefined && props.totalBags !== null ? props.totalBags : sum(items, (i) => i.bags)
  const totalGross =
    props.totalGrossKg !== undefined && props.totalGrossKg !== null
      ? props.totalGrossKg
      : sum(items, (i) => i.grossWeightKg)
  const totalTare =
    props.totalTareKg !== undefined && props.totalTareKg !== null ? props.totalTareKg : sum(items, (i) => i.tareWeightKg)
  const totalNet =
    props.totalNetKg !== undefined && props.totalNetKg !== null ? props.totalNetKg : sum(items, lineNet)
  const dateTime = [props.date, props.time].filter(Boolean).join("  ")

  return (
    <PrintDocument
      company={props.company}
      title="INWARD / RECEIVING SLIP"
      docLabel="Voucher No."
      docNumber={props.voucherNo ?? "—"}
      meta={[
        { label: "Date / Time", value: dateTime || undefined },
        { label: "Godown", value: props.godown },
        { label: "Nature / Type", value: props.nature },
      ]}
    >
      <PrintSectionTitle>Supplier / Source &amp; Transport</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Supplier / Source" value={props.supplierName} />
        <PrintField label="Source Type" value={props.sourceType} />
        <PrintField label="Stock Owner" value={props.ownerType} />
        <PrintField label="Bilty / Transport Ref" value={props.biltyNo} />
        <PrintField label="Vehicle No." value={props.vehicleNo} />
        <PrintField label="Driver Name" value={props.driverName} />
        <PrintField label="By Hand / Delivered By" value={props.byHand} />
      </PrintInfoGrid>

      <PrintSectionTitle>Received Items</PrintSectionTitle>
      <table className="print-table">
        <thead>
          <tr>
            <th className="print-col-narrow">#</th>
            <th>Product</th>
            <th className="print-col-number">Bags</th>
            <th className="print-col-number">Gross (kg)</th>
            <th className="print-col-number">Tare (kg)</th>
            <th className="print-col-number">Net (kg)</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow colSpan={7} label="No items recorded on this receiving voucher." />
          ) : (
            items.map((item, idx) => (
              <tr key={idx}>
                <td className="print-col-narrow">{idx + 1}</td>
                <td>
                  {item.product ?? "—"}
                  {item.productCode ? <span className="print-sub"> ({item.productCode})</span> : null}
                </td>
                <td className="print-col-number">{fmtNum(item.bags)}</td>
                <td className="print-col-number">{fmtNum(item.grossWeightKg)}</td>
                <td className="print-col-number">{fmtNum(item.tareWeightKg)}</td>
                <td className="print-col-number">{fmtNum(lineNet(item))}</td>
                <td>{item.remarks ?? ""}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="print-total-label">
              Total
            </td>
            <td className="print-col-number">{fmtNum(totalBags)}</td>
            <td className="print-col-number">{fmtNum(totalGross)}</td>
            <td className="print-col-number">{fmtNum(totalTare)}</td>
            <td className="print-col-number">{fmtNum(totalNet)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="print-total-line">
        Total bags: {fmtNum(totalBags)} &nbsp;•&nbsp; Gross: {fmtNum(totalGross)} kg &nbsp;•&nbsp; Tare:{" "}
        {fmtNum(totalTare)} kg &nbsp;•&nbsp; Net: {fmtNum(totalNet)} kg
      </p>

      {props.notes ? (
        <>
          <PrintSectionTitle>Notes</PrintSectionTitle>
          <p className="print-notes">{props.notes}</p>
        </>
      ) : null}
      {props.attachmentUrl ? (
        <p className="print-notes">
          Attachment:{" "}
          <a href={props.attachmentUrl} target="_blank" rel="noreferrer">
            {props.attachmentNote || props.attachmentUrl}
          </a>
        </p>
      ) : null}

      <PrintSectionTitle>Received By</PrintSectionTitle>
      <SignatureRow signatures={[{ label: "Received By", name: props.receivedBy }]} />
    </PrintDocument>
  )
}
