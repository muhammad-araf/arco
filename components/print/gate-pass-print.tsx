import type { CompanyDetails } from "./types"
import { fmtNum, fmtQty, sum, text } from "./types"
import {
  EmptyRow,
  PrintDocument,
  PrintField,
  PrintInfoGrid,
  PrintSectionTitle,
  SignatureRow,
} from "./print-layout"

export interface GatePassItem {
  product?: string
  productCode?: string
  quantity?: number | string
  unit?: string
  /** Net weight in kg. Falls back to gross weight when absent. */
  weightKg?: number | string
  grossWeightKg?: number | string
  bags?: number | string
  /** Bag type for this line (packaging type name), if one applies. */
  bagType?: string
  remarks?: string
}

export interface GatePassPrintProps {
  company?: CompanyDetails
  passNo?: string
  date?: string
  /** Display time, e.g. "10:35 AM". Shown next to the date when given. */
  time?: string
  status?: string
  customerName?: string
  receiverName?: string
  receiverContact?: string
  customerPhone?: string
  destination?: string
  address?: string
  godown?: string
  orderRef?: string
  transporter?: string
  vehicleNo?: string
  driverName?: string
  driverPhone?: string
  dispatchMode?: string
  items?: GatePassItem[]
  /** Override computed totals; otherwise totals are summed from items. */
  totalQuantity?: number | string
  totalWeightKg?: number | string
  totalBags?: number | string
  notes?: string
  preparedBy?: string
  approvedBy?: string
  securityName?: string
  receiverSignName?: string
}

/**
 * A4 gate pass (spec §9.4): company details, prominent pass number,
 * customer/destination, vehicle/driver, item table, totals, and the
 * dual signature areas — prepared + authorized, security/gate, and
 * receiver acknowledgement.
 */
export function GatePassPrint(props: GatePassPrintProps) {
  const items = Array.isArray(props.items) ? props.items : []
  // Actual status, never collapsed: a partially returned pass is not
  // "Dispatched", and a draft is not "Posted".
  const statusLabel =
    props.status === "draft"
      ? "Draft"
      : props.status === "awaiting_approval"
        ? "Awaiting Approval"
        : props.status === "reversed"
          ? "Reversed"
          : props.status === "returned"
            ? "Returned"
            : props.status === "partially_returned"
              ? "Partially Returned"
              : props.status === "posted"
                ? "Posted"
                : props.status
  const totalQuantity =
    props.totalQuantity !== undefined && props.totalQuantity !== null
      ? props.totalQuantity
      : sum(items, (i) => i.quantity)
  const totalWeight =
    props.totalWeightKg !== undefined && props.totalWeightKg !== null
      ? props.totalWeightKg
      : sum(items, (i) => (i.weightKg ?? i.grossWeightKg))
  const totalBags =
    props.totalBags !== undefined && props.totalBags !== null ? props.totalBags : sum(items, (i) => i.bags)
  const dateTime = [props.date, props.time].filter(Boolean).join("  ")

  return (
    <PrintDocument
      company={props.company}
      title="GATE PASS"
      docLabel="Gate Pass No."
      docNumber={text(props.passNo, "—")}
      meta={[
        { label: "Date / Time", value: dateTime || undefined },
        { label: "Status", value: statusLabel },
        { label: "Godown", value: props.godown },
        { label: "Order / Ref", value: props.orderRef },
      ]}
    >
      <PrintSectionTitle>Customer / Receiver &amp; Destination</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Customer" value={props.customerName} />
        <PrintField label="Receiver" value={props.receiverName} />
        <PrintField label="Receiver Contact" value={props.receiverContact} />
        <PrintField label="Contact" value={props.customerPhone} />
        <PrintField label="Destination" value={props.destination} />
        <PrintField label="Delivery Address" value={props.address} />
        <PrintField label="Dispatch Mode" value={props.dispatchMode} />
      </PrintInfoGrid>

      <PrintSectionTitle>Vehicle &amp; Driver</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Vehicle No." value={props.vehicleNo} />
        <PrintField label="Driver Name" value={props.driverName} />
        <PrintField label="Driver Contact" value={props.driverPhone} />
        <PrintField label="Transporter" value={props.transporter} />
      </PrintInfoGrid>

      <PrintSectionTitle>Items</PrintSectionTitle>
      <table className="print-table">
        <thead>
          <tr>
            <th className="print-col-narrow">S.No.</th>
            <th>Product</th>
            <th className="print-col-number">Quantity</th>
            <th>Unit</th>
            <th className="print-col-number">Weight (kg)</th>
            <th className="print-col-number">Bags</th>
            <th>Bag Type</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow colSpan={8} label="No items recorded on this gate pass." />
          ) : (
            items.map((item, idx) => (
              <tr key={idx}>
                <td className="print-col-narrow">{idx + 1}</td>
                <td>
                  {text(item.product)}
                  {item.productCode ? <span className="print-sub"> ({item.productCode})</span> : null}
                </td>
                <td className="print-col-number">{fmtNum(item.quantity)}</td>
                <td>{text(item.unit)}</td>
                <td className="print-col-number">{fmtNum(item.weightKg ?? item.grossWeightKg)}</td>
                <td className="print-col-number">{fmtNum(item.bags)}</td>
                <td>{text(item.bagType, "")}</td>
                <td>{text(item.remarks, "")}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="print-total-label">
              Total
            </td>
            <td className="print-col-number">{fmtNum(totalQuantity)}</td>
            <td />
            <td className="print-col-number">{fmtNum(totalWeight)}</td>
            <td className="print-col-number">{fmtNum(totalBags)}</td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="print-total-line">
        Total quantity: {fmtQty(totalQuantity)} &nbsp;•&nbsp; Total weight: {fmtNum(totalWeight)} kg &nbsp;•&nbsp;
        Total bags: {fmtNum(totalBags)}
      </p>

      {props.notes ? (
        <>
          <PrintSectionTitle>Notes</PrintSectionTitle>
          <p className="print-notes">{props.notes}</p>
        </>
      ) : null}

      <PrintSectionTitle>Signatures</PrintSectionTitle>
      <SignatureRow
        signatures={[
          { label: "Prepared By", name: props.preparedBy },
          { label: "Authorized / Approved By", name: props.approvedBy },
        ]}
      />
      <SignatureRow
        signatures={[
          { label: "Security / Gate Signature", name: props.securityName },
          { label: "Receiver Acknowledgement", name: props.receiverSignName ?? props.receiverName },
        ]}
      />
    </PrintDocument>
  )
}
