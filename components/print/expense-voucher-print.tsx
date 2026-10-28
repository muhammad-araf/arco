import type { CompanyDetails } from "./types"
import { fmtNum, num } from "./types"
import {
  PrintDocument,
  PrintField,
  PrintInfoGrid,
  PrintSectionTitle,
  SignatureRow,
} from "./print-layout"

export interface ExpenseVoucherPrintProps {
  company?: CompanyDetails
  expenseNo?: string
  date?: string
  payee?: string
  category?: string
  paymentMethod?: string
  /** Cash/bank account the money was paid from, when paid now. */
  account?: string
  settlement?: string
  amount?: number | string
  /** Amount in words, when the page supplies it. */
  amountInWords?: string
  description?: string
  status?: string
}

/** A4 expense voucher: who was paid, for what, how much, and how it was settled. */
export function ExpenseVoucherPrint(props: ExpenseVoucherPrintProps) {
  const amount = num(props.amount)
  return (
    <PrintDocument
      company={props.company}
      title="EXPENSE VOUCHER"
      docLabel="Expense No."
      docNumber={props.expenseNo ?? "—"}
      meta={[{ label: "Date", value: props.date }, { label: "Status", value: props.status }]}
    >
      <PrintSectionTitle>Expense Details</PrintSectionTitle>
      <PrintInfoGrid>
        <PrintField label="Payee" value={props.payee} />
        <PrintField label="Category" value={props.category} />
        <PrintField label="Payment Method" value={props.paymentMethod} />
        <PrintField label="Account" value={props.account} />
        <PrintField label="Settlement" value={props.settlement} />
        <PrintField label="Amount" value={fmtNum(amount)} />
        <PrintField label="Amount in Words" value={props.amountInWords} />
      </PrintInfoGrid>

      {props.description ? (
        <>
          <PrintSectionTitle>Particulars</PrintSectionTitle>
          <p>{props.description}</p>
        </>
      ) : null}
      <PrintSectionTitle>Prepared By</PrintSectionTitle>
      <SignatureRow signatures={[{ label: "Prepared By", name: undefined }]} />
    </PrintDocument>
  )
}
