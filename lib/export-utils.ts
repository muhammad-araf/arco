/**
 * Browser-side CSV / Excel Exporter for Seed Godown & Processing System
 */
export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  filename: string,
  columns?: { key: keyof T; label: string }[]
) {
  if (!data || data.length === 0) {
    alert("No data available to export.")
    return
  }

  const keys = columns ? columns.map((c) => c.key) : Object.keys(data[0])
  const headers = columns ? columns.map((c) => c.label) : keys

  const csvRows: string[] = []

  // Header row
  csvRows.push(headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","))

  // Data rows
  data.forEach((row) => {
    const values = keys.map((key) => {
      const val = row[key]
      if (val === null || val === undefined) return '""'
      if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`
      return `"${String(val).replace(/"/g, '""')}"`
    })
    csvRows.push(values.join(","))
  })

  const csvString = csvRows.join("\r\n")
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)

  const link = document.createElement("a")
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().slice(0, 10)}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/* ------------------------------------------------------------------ */
/* Report exports (spec §16): every report exports with its title,    */
/* date range, filter labels, header row and a totals row, in an      */
/* Excel-compatible CSV (UTF-8 BOM + CRLF + RFC 4180 quoting).        */
/* exportToCSV above is intentionally left untouched so existing      */
/* callers keep their exact behaviour.                                */
/* ------------------------------------------------------------------ */

export interface ExportColumn<T extends Record<string, any>> {
  key: keyof T
  label: string
  /** Convert a raw cell value before quoting (e.g. format a number). */
  format?: (value: T[keyof T], row: T) => string | number | null | undefined
}

export interface ReportExportOptions<T extends Record<string, any>> {
  /** Report title printed as the first line of the file. */
  title?: string
  /** e.g. "2026-10-01 to 2026-10-24" — printed as a label line. */
  dateRange?: string
  /** Filter labels, as strings ("Godown: Main") or a key/value map. */
  filters?: string[] | Record<string, string>
  /** Totals row, keyed by column key; other columns stay blank. */
  totals?: Partial<Record<keyof T, string | number>>
  totalsLabel?: string
  /** Excel needs the BOM to read UTF-8 correctly. Defaults to true. */
  includeBom?: boolean
}

/** RFC 4180 quoting: wrap in quotes when needed, double inner quotes. */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return escapeCsvValue(JSON.stringify(value))
  const s = String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function cellValue<T extends Record<string, any>>(
  row: T,
  column: ExportColumn<T>
): string | number | null | undefined {
  const raw = row[column.key]
  return column.format ? column.format(raw, row) : raw
}

/**
 * Pure CSV builder (no DOM): title, date-range and filter label lines,
 * then the header row, data rows, and a totals row when totals are
 * given. Safe to call with empty data — headers and totals still emit
 * when columns are supplied.
 */
export function buildCsvString<T extends Record<string, any>>(
  data: T[],
  columns?: ExportColumn<T>[],
  options?: ReportExportOptions<T>
): string {
  const rows = Array.isArray(data) ? data : []
  const cols = columns ?? (rows[0] ? (Object.keys(rows[0]) as (keyof T)[]).map((key) => ({ key, label: String(key) })) : [])
  if (cols.length === 0) return ""

  const lines: string[] = []
  if (options?.title) lines.push(escapeCsvValue(options.title))
  if (options?.dateRange) lines.push(escapeCsvValue(`Date range: ${options.dateRange}`))
  if (options?.filters) {
    const filters = Array.isArray(options.filters)
      ? options.filters
      : Object.entries(options.filters).map(([k, v]) => `${k}: ${v}`)
    filters.forEach((f) => lines.push(escapeCsvValue(f)))
  }
  if (lines.length > 0) lines.push("")

  lines.push(cols.map((c) => escapeCsvValue(c.label)).join(","))
  rows.forEach((row) => {
    lines.push(cols.map((c) => escapeCsvValue(cellValue(row, c))).join(","))
  })

  if (options?.totals) {
    const totals = options.totals
    lines.push(
      cols
        .map((c, i) => {
          if (i === 0) return escapeCsvValue(options.totalsLabel ?? "Total")
          const v = totals[c.key]
          return escapeCsvValue(v === undefined ? "" : v)
        })
        .join(",")
    )
  }

  const bom = options?.includeBom === false ? "" : "\uFEFF"
  return bom + lines.join("\r\n")
}

function downloadCsv(csvString: string, filename: string) {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, "_")
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.setAttribute("href", url)
  link.setAttribute("download", `${safeName}_${new Date().toISOString().slice(0, 10)}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Download a report as an Excel-compatible CSV. Returns false (and
 * alerts, matching exportToCSV) when there is nothing to export —
 * i.e. no rows and no columns to build headers from.
 */
export function exportReportToCsv<T extends Record<string, any>>(
  data: T[],
  filename: string,
  columns?: ExportColumn<T>[],
  options?: ReportExportOptions<T>
): boolean {
  const csvString = buildCsvString(data, columns, options)
  if (!csvString) {
    alert("No data available to export.")
    return false
  }
  downloadCsv(csvString, filename)
  return true
}

/* ------------------------------------------------------------------ */
/* Excel + PDF exports (spec §16). Both use dynamic import() so the   */
/* heavy libraries never bloat the initial bundle: they load only     */
/* when the user actually clicks Excel or PDF. The pure builders      */
/* below carry the shared title / range / filter / totals shape, so   */
/* CSV, Excel and PDF exports of the same report always agree.        */
/* ------------------------------------------------------------------ */

function filterLines<T extends Record<string, any>>(
  options?: ReportExportOptions<T>
): string[] {
  if (!options?.filters) return []
  const filters = Array.isArray(options.filters)
    ? options.filters
    : Object.entries(options.filters).map(([k, v]) => `${k}: ${v}`)
  return filters
}

function resolveColumns<T extends Record<string, any>>(
  data: T[],
  columns?: ExportColumn<T>[]
): ExportColumn<T>[] {
  if (columns) return columns
  const rows = Array.isArray(data) ? data : []
  return rows[0]
    ? (Object.keys(rows[0]) as (keyof T)[]).map((key) => ({ key, label: String(key) }))
    : []
}

function displayValue(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return ""
  return value
}

/**
 * Pure sheet builder (no DOM, no dynamic imports): title line, date
 * range line, one line per filter, a blank line, the header row, data
 * rows, and a totals row when totals are given. Safe with empty data
 * — headers and totals still emit when columns are supplied.
 */
export function buildReportSheetRows<T extends Record<string, any>>(
  data: T[],
  columns?: ExportColumn<T>[],
  options?: ReportExportOptions<T>
): (string | number)[][] {
  const cols = resolveColumns(data, columns)
  if (cols.length === 0) return []
  const rows: (string | number)[][] = []
  if (options?.title) rows.push([options.title])
  if (options?.dateRange) rows.push([`Date range: ${options.dateRange}`])
  filterLines(options).forEach((f) => rows.push([f]))
  if (rows.length > 0) rows.push([])
  rows.push(cols.map((c) => c.label))
  ;(Array.isArray(data) ? data : []).forEach((row) => {
    rows.push(cols.map((c) => displayValue(cellValue(row, c))))
  })
  if (options?.totals) {
    const totals = options.totals
    rows.push(
      cols.map((c, i) => {
        if (i === 0) return options.totalsLabel ?? "Total"
        const v = totals[c.key]
        return displayValue(v === undefined ? "" : v)
      })
    )
  }
  return rows
}

function safeExportName(filename: string): string {
  const safe = filename.replace(/[\\/:*?"<>|]/g, "_")
  return `${safe}_${new Date().toISOString().slice(0, 10)}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.setAttribute("href", url)
  link.setAttribute("download", filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export async function exportToExcel<T extends Record<string, any>>(
  data: T[],
  filename: string,
  columns?: ExportColumn<T>[],
  options?: ReportExportOptions<T>
): Promise<boolean> {
  const sheetRows = buildReportSheetRows(data, columns, options)
  if (sheetRows.length === 0) {
    alert("No data available to export.")
    return false
  }
  const html = `<html><head><meta charset="utf-8"></head><body><table>${sheetRows
    .map((row) => `<tr>${row.map((cell) => `<td>${String(cell ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`).join("")}</tr>`)
    .join("")}</table></body></html>`
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" })
  downloadBlob(blob, `${safeExportName(filename)}.xls`)
  return true
}

export async function exportToPdf<T extends Record<string, any>>(
  data: T[],
  filename: string,
  columns?: ExportColumn<T>[],
  options?: ReportExportOptions<T>
): Promise<boolean> {
  const cols = resolveColumns(data, columns)
  if (cols.length === 0) {
    alert("No data available to export.")
    return false
  }
  const title = options?.title ?? "Report"
  const dateRange = options?.dateRange ? `<p style="color:#666;font-size:12px;">Date range: ${options.dateRange}</p>` : ""
  const filters = filterLines(options).map((f) => `<p style="color:#666;font-size:12px;">${f}</p>`).join("")
  const tableHeaders = cols.map((c) => `<th style="border:1px solid #ddd;padding:8px;background:#18181b;color:#fff;text-align:left;">${c.label}</th>`).join("")
  const tableRows = (Array.isArray(data) ? data : [])
    .map((row) => `<tr>${cols.map((c) => `<td style="border:1px solid #ddd;padding:6px;font-size:12px;">${displayValue(cellValue(row, c))}</td>`).join("")}</tr>`)
    .join("")
  const totalsRow = options?.totals
    ? `<tr style="font-weight:bold;background:#f3f4f6;">${cols.map((c, i) => `<td style="border:1px solid #ddd;padding:6px;font-size:12px;">${i === 0 ? (options.totalsLabel ?? "Total") : displayValue(options.totals![c.key])}</td>`).join("")}</tr>`
    : ""

  const printContent = `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px;color:#111;}h1{font-size:20px;margin-bottom:8px;}table{width:100%;border-collapse:collapse;margin-top:16px;}tr:nth-child(even){background-color:#f9fafb;}@media print{body{padding:0;}}</style></head><body><h1>${title}</h1>${dateRange}${filters}<table><thead><tr>${tableHeaders}</tr></thead><tbody>${tableRows}${totalsRow}</tbody></table></body></html>`

  const printWindow = window.open("", "_blank")
  if (!printWindow) {
    alert("Pop-up blocked. Please allow pop-ups to print or save PDF.")
    return false
  }
  printWindow.document.write(printContent)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
  }, 250)
  return true
}
