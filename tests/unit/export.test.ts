/**
 * Report export helpers (spec §16): CSV, Excel and PDF exports of the
 * same report must share title / date-range / filter / totals shape.
 * buildReportSheetRows is the pure core both new formats are built on.
 */
import { describe, expect, it } from "vitest";
import { buildCsvString, buildReportSheetRows } from "@/lib/export-utils";

const rows = [
  { code: "WHT", name: "Wheat", stock_kg: 100, bags: 2 },
  { code: "RCE", name: "Rice", stock_kg: 50, bags: 1 },
];
const columns = [
  { key: "code", label: "Code" },
  { key: "name", label: "Product" },
  { key: "stock_kg", label: "Stock (kg)" },
  { key: "bags", label: "Bags" },
] as const;
const options = {
  title: "Stock Summary",
  dateRange: "2026-10-01 to 2026-10-24",
  filters: ["Godown: Main"],
  totals: { stock_kg: 150, bags: 3 },
};

describe("report export sheet builder", () => {
  it("puts title, range and filter lines before the header row", () => {
    const sheet = buildReportSheetRows(rows as any, columns as any, options as any);
    expect(sheet[0]).toEqual(["Stock Summary"]);
    expect(sheet[1]).toEqual(["Date range: 2026-10-01 to 2026-10-24"]);
    expect(sheet[2]).toEqual(["Godown: Main"]);
    expect(sheet[3]).toEqual([]);
    expect(sheet[4]).toEqual(["Code", "Product", "Stock (kg)", "Bags"]);
  });

  it("emits data rows and a totals row with the label in the first column", () => {
    const sheet = buildReportSheetRows(rows as any, columns as any, options as any);
    expect(sheet[5]).toEqual(["WHT", "Wheat", 100, 2]);
    expect(sheet[6]).toEqual(["RCE", "Rice", 50, 1]);
    expect(sheet[7]).toEqual(["Total", "", 150, 3]);
  });

  it("applies column format functions and blanks null cells", () => {
    const sheet = buildReportSheetRows(
      [{ code: "X", name: null, stock_kg: 5, bags: 0 }] as any,
      [{ key: "code", label: "Code" }, { key: "name", label: "Product" }, { key: "stock_kg", label: "Stock (kg)", format: (v: any) => `${v} kg` }] as any,
      { title: "T" } as any,
    );
    expect(sheet[2]).toEqual(["Code", "Product", "Stock (kg)"]);
    expect(sheet[3]).toEqual(["X", "", "5 kg"]);
  });

  it("returns no rows when there are no columns to build from", () => {
    expect(buildReportSheetRows([], undefined, { title: "T" })).toEqual([]);
  });

  it("keeps the CSV builder in the same title/totals shape", () => {
    const csv = buildCsvString(rows as any, columns as any, options as any);
    expect(csv).toContain("Stock Summary");
    expect(csv).toContain("Date range: 2026-10-01 to 2026-10-24");
    expect(csv).toContain("Godown: Main");
    expect(csv).toContain("Total,,150,3");
  });
});
