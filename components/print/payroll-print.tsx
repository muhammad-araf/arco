import type { CompanyDetails } from "./types"
import { fmtNum, sum, text } from "./types"
import { EmptyRow, PrintDocument, PrintField, PrintInfoGrid, PrintSectionTitle, SignatureRow } from "./print-layout"

export interface PayrollRow { employee?: string; base?: number | string; bonus?: number | string; deductions?: number | string; advanceRecovery?: number | string; net?: number | string }
export interface PayrollPrintProps {
  company?: CompanyDetails
  periodLabel?: string
  employeeName?: string
  rows?: PayrollRow[]
  totalNet?: number | string
  preparedBy?: string
}

/** A4 payroll document: one run (or one employee's salary view) with per-employee rows and a net total. Renders existing payroll data only. */
export function PayrollPrint(props: PayrollPrintProps) {
  const rows = Array.isArray(props.rows) ? props.rows : []
  const totalNet = props.totalNet !== undefined && props.totalNet !== null ? Number(props.totalNet) || 0 : sum(rows, (r) => r.net)
  return (
    <PrintDocument company={props.company} title="PAYROLL" meta={[{ label: "Period", value: props.periodLabel }, { label: "Employee", value: props.employeeName }]}>
      <PrintSectionTitle>Summary</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Employees" value={String(rows.length)} />
        <PrintField label="Total Net Pay" value={fmtNum(totalNet)} />
      </PrintInfoGrid>
      <PrintSectionTitle>Salary Details</PrintSectionTitle>
      <table className="print-table">
        <thead><tr><th>Employee</th><th className="print-col-number">Base</th><th className="print-col-number">Bonus</th><th className="print-col-number">Deductions</th><th className="print-col-number">Advance Recovery</th><th className="print-col-number">Net Pay</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={6} label="No payroll rows." /> : rows.map((r, i) => (
            <tr key={i}><td>{text(r.employee)}</td><td className="print-col-number">{fmtNum(r.base)}</td><td className="print-col-number">{fmtNum(r.bonus)}</td><td className="print-col-number">{fmtNum(r.deductions)}</td><td className="print-col-number">{fmtNum(r.advanceRecovery)}</td><td className="print-col-number">{fmtNum(r.net)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5} className="print-total-label">Total Net Pay</td><td className="print-col-number">{fmtNum(totalNet)}</td></tr></tfoot>
      </table>
      <PrintSectionTitle>Prepared By</PrintSectionTitle>
      <SignatureRow signatures={[{ label: "Prepared By", name: props.preparedBy }]} />
    </PrintDocument>
  )
}
