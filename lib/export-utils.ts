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
