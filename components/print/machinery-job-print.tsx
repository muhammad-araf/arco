import type { CompanyDetails } from "./types"
import { fmtNum, sum } from "./types"
import {
  EmptyRow,
  PrintDocument,
  PrintField,
  PrintInfoGrid,
  PrintSectionTitle,
  SignatureRow,
} from "./print-layout"

export interface MachineryJobLinePrint {
  inputProduct?: string
  inputQtyKg?: number | string
  outputProduct?: string
  outputQtyKg?: number | string
  byproductProduct?: string
  byproductQtyKg?: number | string
}

export interface MachineryJobPrintProps {
  company?: CompanyDetails
  jobNo?: string
  date?: string
  status?: string
  customerName?: string
  machine?: string
  godown?: string
  operator?: string
  processingType?: string
  ownership?: string
  /** Multi-line detail. When empty, the single-line header totals
   *  (inputProduct / inputWeightKg / outputProduct / outputWeightKg /
   *  byproductProduct / byproductWeightKg) are printed instead, so a
   *  legacy single-line job prints exactly as it always did. */
  lines?: MachineryJobLinePrint[]
  inputProduct?: string
  inputWeightKg?: number | string
  outputProduct?: string
  outputWeightKg?: number | string
  byproductProduct?: string
  byproductWeightKg?: number | string
  wasteKg?: number | string
  rateBasis?: string
  rate?: number | string
  serviceCharge?: number | string
  notes?: string
}

/**
 * Machinery job ticket (spec §7): customer, machine, godown, operator,
 * processing type, per-line input / output / by-product, waste, and
 * the job-level service charge. By-product rows are stock, waste is
 * not — the ticket shows both, labelled, so the distinction is visible.
 */
export function MachineryJobPrint(props: MachineryJobPrintProps) {
  const lines = Array.isArray(props.lines) ? props.lines : []
  const rows: MachineryJobLinePrint[] =
    lines.length > 0
      ? lines
      : [
          {
            inputProduct: props.inputProduct,
            inputQtyKg: props.inputWeightKg,
            outputProduct: props.outputProduct,
            outputQtyKg: props.outputWeightKg,
            byproductProduct: props.byproductProduct,
            byproductQtyKg: props.byproductWeightKg,
          },
        ]
  const totalInput = sum(rows, (r) => r.inputQtyKg)
  const totalOutput = sum(rows, (r) => r.outputQtyKg)
  const totalByproduct = sum(rows, (r) => r.byproductQtyKg)

  return (
    <PrintDocument
      company={props.company}
      title="MACHINERY JOB TICKET"
      docLabel="Job No."
      docNumber={props.jobNo ?? "—"}
      meta={[
        { label: "Date", value: props.date },
        { label: "Status", value: props.status },
        { label: "Machine", value: props.machine },
        { label: "Godown", value: props.godown },
      ]}
    >
      <PrintSectionTitle>Job Details</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Customer / Owner" value={props.customerName} />
        <PrintField label="Operator" value={props.operator} />
        <PrintField label="Processing Type" value={props.processingType} />
        <PrintField label="Ownership" value={props.ownership} />
      </PrintInfoGrid>

      <PrintSectionTitle>Job Lines — Input / Output / By-Product</PrintSectionTitle>
      <table className="print-table">
        <thead>
          <tr>
            <th className="print-col-narrow">#</th>
            <th>Input Product</th>
            <th className="print-col-number">Input (kg)</th>
            <th>Output Product</th>
            <th className="print-col-number">Output (kg)</th>
            <th>By-Product</th>
            <th className="print-col-number">By-Product (kg)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} label="No job lines recorded for this job." />
          ) : (
            rows.map((row, idx) => (
              <tr key={idx}>
                <td className="print-col-narrow">{idx + 1}</td>
                <td>{row.inputProduct ?? "—"}</td>
                <td className="print-col-number">{fmtNum(row.inputQtyKg)}</td>
                <td>{row.outputProduct ?? "—"}</td>
                <td className="print-col-number">{fmtNum(row.outputQtyKg)}</td>
                <td>{row.byproductProduct ?? "—"}</td>
                <td className="print-col-number">{fmtNum(row.byproductQtyKg)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="print-total-label">
              Totals
            </td>
            <td className="print-col-number">{fmtNum(totalInput)}</td>
            <td />
            <td className="print-col-number">{fmtNum(totalOutput)}</td>
            <td />
            <td className="print-col-number">{fmtNum(totalByproduct)}</td>
          </tr>
        </tfoot>
      </table>

      <PrintSectionTitle>Charge &amp; Waste</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Waste / Process Loss (not stocked)" value={`${fmtNum(props.wasteKg)} kg`} />
        <PrintField label="Rate Basis" value={props.rateBasis} />
        <PrintField label="Rate" value={props.rate !== undefined ? fmtNum(props.rate) : undefined} />
        <PrintField
          label="Service Charge (job-level, on total input)"
          value={props.serviceCharge !== undefined ? fmtNum(props.serviceCharge) : undefined}
        />
      </PrintInfoGrid>

      {props.notes ? (
        <>
          <PrintSectionTitle>Notes</PrintSectionTitle>
          <p className="print-notes">{props.notes}</p>
        </>
      ) : null}

      <PrintSectionTitle>Operator</PrintSectionTitle>
      <SignatureRow signatures={[{ label: "Operator", name: props.operator }]} />
    </PrintDocument>
  )
}
