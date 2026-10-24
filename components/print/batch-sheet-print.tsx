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

export interface BatchSheetInput {
  product?: string
  /** Recipe ratio in percent, when the recipe defines one. */
  ratioPct?: number | string
  plannedQtyKg?: number | string
  actualQtyKg?: number | string
}

export interface BatchSheetPackaging {
  packagingType?: string
  bags?: number | string
  capacityKg?: number | string
}

export interface BatchSheetPrintProps {
  company?: CompanyDetails
  batchNo?: string
  date?: string
  recipeName?: string
  recipeVersion?: number | string
  machine?: string
  godown?: string
  operator?: string
  customerName?: string
  orderRef?: string
  plannedSizeKg?: number | string
  plannedInputs?: BatchSheetInput[]
  /** Overrides plannedInputs when actuals arrive as a separate list. */
  actualInputs?: BatchSheetInput[]
  outputProduct?: string
  plannedOutputKg?: number | string
  actualOutputKg?: number | string
  byProductKg?: number | string
  byProductName?: string
  wasteKg?: number | string
  /** Override; otherwise output ÷ total actual input × 100. */
  yieldPct?: number | string
  packagingConsumed?: BatchSheetPackaging[]
  notes?: string
}

/**
 * Batch production sheet (spec §6.2): recipe/version, planned vs actual
 * inputs, output, by-product, waste, yield %, variance, packaging
 * consumed, and the operator signature. Planned and actual inputs are
 * merged by row position; pass a single list with both quantities set
 * when the page already pairs them.
 */
export function BatchSheetPrint(props: BatchSheetPrintProps) {
  const planned = Array.isArray(props.plannedInputs) ? props.plannedInputs : []
  const actual = Array.isArray(props.actualInputs) ? props.actualInputs : []
  const rows: BatchSheetInput[] = planned.map((p, i) => ({
    product: p.product ?? actual[i]?.product,
    ratioPct: p.ratioPct ?? actual[i]?.ratioPct,
    plannedQtyKg: p.plannedQtyKg,
    actualQtyKg: p.actualQtyKg ?? actual[i]?.actualQtyKg,
  }))
  // Actual-only rows (no planned counterpart) still print.
  for (let i = planned.length; i < actual.length; i += 1) rows.push(actual[i])

  const totalPlanned = sum(rows, (r) => r.plannedQtyKg)
  const totalActual = sum(rows, (r) => r.actualQtyKg)
  const output = num(props.actualOutputKg)
  const yieldPct =
    props.yieldPct !== undefined && props.yieldPct !== null
      ? num(props.yieldPct)
      : totalActual > 0
        ? (output / totalActual) * 100
        : 0
  const outputVariance =
    props.plannedOutputKg !== undefined && props.plannedOutputKg !== null
      ? output - num(props.plannedOutputKg)
      : output - num(props.plannedSizeKg)
  const packaging = Array.isArray(props.packagingConsumed) ? props.packagingConsumed : []

  return (
    <PrintDocument
      company={props.company}
      title="BATCH PRODUCTION SHEET"
      docLabel="Batch No."
      docNumber={props.batchNo ?? "—"}
      meta={[
        { label: "Date", value: props.date },
        { label: "Recipe", value: props.recipeName },
        { label: "Version", value: props.recipeVersion !== undefined ? String(props.recipeVersion) : undefined },
        { label: "Machine", value: props.machine },
        { label: "Godown", value: props.godown },
      ]}
    >
      <PrintSectionTitle>Batch Details</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Operator" value={props.operator} />
        <PrintField label="Customer / Order" value={props.customerName} />
        <PrintField label="Order Ref" value={props.orderRef} />
        <PrintField label="Planned Batch Size" value={props.plannedSizeKg !== undefined ? `${fmtNum(props.plannedSizeKg)} kg` : undefined} />
      </PrintInfoGrid>

      <PrintSectionTitle>Inputs — Planned vs Actual</PrintSectionTitle>
      <table className="print-table">
        <thead>
          <tr>
            <th className="print-col-narrow">#</th>
            <th>Component</th>
            <th className="print-col-number">Recipe %</th>
            <th className="print-col-number">Planned (kg)</th>
            <th className="print-col-number">Actual (kg)</th>
            <th className="print-col-number">Variance (kg)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={6} label="No input components recorded for this batch." />
          ) : (
            rows.map((row, idx) => (
              <tr key={idx}>
                <td className="print-col-narrow">{idx + 1}</td>
                <td>{row.product ?? "—"}</td>
                <td className="print-col-number">{row.ratioPct !== undefined ? `${fmtNum(row.ratioPct)}%` : "—"}</td>
                <td className="print-col-number">{fmtNum(row.plannedQtyKg)}</td>
                <td className="print-col-number">{fmtNum(row.actualQtyKg)}</td>
                <td className="print-col-number">{fmtNum(num(row.actualQtyKg) - num(row.plannedQtyKg))}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="print-total-label">
              Total Input
            </td>
            <td className="print-col-number">{fmtNum(totalPlanned)}</td>
            <td className="print-col-number">{fmtNum(totalActual)}</td>
            <td className="print-col-number">{fmtNum(totalActual - totalPlanned)}</td>
          </tr>
        </tfoot>
      </table>

      <PrintSectionTitle>Output &amp; Yield</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Output Product" value={props.outputProduct} />
        <PrintField label="Planned Output" value={props.plannedOutputKg !== undefined ? `${fmtNum(props.plannedOutputKg)} kg` : undefined} />
        <PrintField label="Actual Output" value={`${fmtNum(output)} kg`} />
        <PrintField label="Output Variance" value={`${fmtNum(outputVariance)} kg`} />
        <PrintField label="By-Product" value={`${props.byProductName ? `${props.byProductName} — ` : ""}${fmtNum(props.byProductKg)} kg`} />
        <PrintField label="Waste / Process Loss" value={`${fmtNum(props.wasteKg)} kg`} />
        <PrintField label="Yield %" value={`${fmtNum(yieldPct)}%`} />
      </PrintInfoGrid>

      <PrintSectionTitle>Packaging Consumed</PrintSectionTitle>
      <table className="print-table">
        <thead>
          <tr>
            <th className="print-col-narrow">#</th>
            <th>Packaging Type</th>
            <th className="print-col-number">Bags</th>
            <th className="print-col-number">Capacity (kg)</th>
          </tr>
        </thead>
        <tbody>
          {packaging.length === 0 ? (
            <EmptyRow colSpan={4} label="No packaging consumption recorded for this batch." />
          ) : (
            packaging.map((p, idx) => (
              <tr key={idx}>
                <td className="print-col-narrow">{idx + 1}</td>
                <td>{p.packagingType ?? "—"}</td>
                <td className="print-col-number">{fmtNum(p.bags)}</td>
                <td className="print-col-number">{fmtNum(p.capacityKg)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

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
