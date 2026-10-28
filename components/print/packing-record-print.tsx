import type { CompanyDetails } from "./types"
import { fmtNum, text } from "./types"
import { PrintDocument, PrintField, PrintInfoGrid, PrintSectionTitle, SignatureRow } from "./print-layout"

export interface PackingRecordPrintProps {
  company?: CompanyDetails
  packingNo?: string
  date?: string
  product?: string
  packaging?: string
  party?: string
  bags?: number | string
  totalKg?: number | string
  damagedBags?: number | string
  packingRate?: number | string
  packingCharge?: number | string
  status?: string
  notes?: string
  preparedBy?: string
}

/** A4 packing record: one packing entry as shown on the Packing History tab. Renders existing data only. */
export function PackingRecordPrint(props: PackingRecordPrintProps) {
  return (
    <PrintDocument company={props.company} title="PACKING RECORD" docLabel="Packing No." docNumber={props.packingNo}
      meta={[{ label: "Date", value: props.date }, { label: "Status", value: props.status }, { label: "Party", value: props.party }]}>
      <PrintInfoGrid>
        <PrintField label="Product Packed" value={text(props.product)} />
        <PrintField label="Bag / Bardana Type" value={text(props.packaging)} />
        <PrintField label="Bags Packed" value={fmtNum(props.bags)} />
        <PrintField label="Total Weight (kg)" value={fmtNum(props.totalKg)} />
        <PrintField label="Damaged Bags" value={fmtNum(props.damagedBags)} />
        <PrintField label="Packing Rate" value={fmtNum(props.packingRate)} />
        <PrintField label="Packing Charge" value={fmtNum(props.packingCharge)} />
      </PrintInfoGrid>
      {props.notes ? (<><PrintSectionTitle>Notes</PrintSectionTitle><p>{props.notes}</p></>) : null}
      <PrintSectionTitle>Prepared By</PrintSectionTitle>
      <SignatureRow signatures={[{ label: "Prepared By", name: props.preparedBy }]} />
    </PrintDocument>
  )
}
