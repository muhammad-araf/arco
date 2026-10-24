import type { ReactNode } from "react"
import type { CompanyDetails } from "./types"
import { text } from "./types"

export const PRINT_EMERALD = "#0B2F24"
export const PRINT_AMBER = "#D99726"

/**
 * Shared A4 document shell: company header, title band with a prominent
 * document number, body, and footer note. Wrap exactly one print
 * component per page — the print CSS shows only `.print-document`.
 */
export function PrintDocument({
  company,
  title,
  docLabel,
  docNumber,
  meta,
  children,
  footerNote,
}: {
  company?: CompanyDetails
  title: string
  /** e.g. "Gate Pass No." — rendered large next to the title. */
  docLabel?: string
  docNumber?: string
  /** Small label/value pairs shown under the title band. */
  meta?: { label: string; value?: string }[]
  children: ReactNode
  footerNote?: string
}) {
  const companyName = text(company?.name, "Seed Godown & Processing")
  const contact = [company?.phone, company?.email].filter(Boolean).join("  •  ")
  const metaRows = (meta ?? []).filter((m) => m.value !== undefined && m.value !== "")

  return (
    <div className="print-document">
      {/* Company header */}
      <div className="print-header">
        {company?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="print-logo" />
        ) : null}
        <div className="print-company">
          <div className="print-company-name">{companyName}</div>
          {company?.address ? <div className="print-company-line">{company.address}</div> : null}
          {contact ? <div className="print-company-line">{contact}</div> : null}
        </div>
      </div>

      {/* Title band with prominent document number */}
      <div className="print-title-band">
        <span className="print-title">{title}</span>
        {docLabel && docNumber ? (
          <span className="print-doc-no">
            {docLabel} <strong>{docNumber}</strong>
          </span>
        ) : null}
      </div>

      {metaRows.length > 0 ? (
        <div className="print-meta">
          {metaRows.map((m) => (
            <span key={m.label} className="print-meta-item">
              <span className="print-meta-label">{m.label}: </span>
              {m.value}
            </span>
          ))}
        </div>
      ) : null}

      <div className="print-body">{children}</div>

      <div className="print-footer">
        {footerNote ?? "This is a system-generated document. Figures are taken from posted vouchers only."}
      </div>
    </div>
  )
}

/** Label/value field used inside the two-column info grids. */
export function PrintField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="print-field">
      <span className="print-field-label">{label}</span>
      <span className="print-field-value">{text(value)}</span>
    </div>
  )
}

/** Two-column grid of label/value fields; empty values render as "—". */
export function PrintInfoGrid({ children }: { children: ReactNode }) {
  return <div className="print-info-grid">{children}</div>
}

/** Section heading inside a print document. */
export function PrintSectionTitle({ children }: { children: ReactNode }) {
  return <div className="print-section-title">{children}</div>
}

/** One signature cell: a blank line with a label (and optional name) under it. */
export function SignatureCell({ label, name }: { label: string; name?: string }) {
  return (
    <div className="print-signature">
      <div className="print-signature-line">{name ? <span>{name}</span> : null}</div>
      <div className="print-signature-label">{label}</div>
    </div>
  )
}

/** Row of signature cells. Renders even when no names are supplied. */
export function SignatureRow({ signatures }: { signatures: { label: string; name?: string }[] }) {
  const cells = signatures.length > 0 ? signatures : [{ label: "Signature" }]
  return (
    <div className="print-signatures">
      {cells.map((s) => (
        <SignatureCell key={s.label} label={s.label} name={s.name} />
      ))}
    </div>
  )
}

/** Empty-table fallback row spanning the table. */
export function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="print-empty-row">
        {label}
      </td>
    </tr>
  )
}
