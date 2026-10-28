/**
 * formatDate — DD/MM/YYYY (Inward dialog redesign).
 * Previously "Oct 28, 2026" (en-US short month); every register/slip date
 * rendered through this helper now reads day/month/year, zero-padded.
 */
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/utils";

describe("formatDate", () => {
  it("formats a bare ISO date as DD/MM/YYYY with zero padding", () => {
    expect(formatDate("2026-01-05")).toBe("05/01/2026");
    expect(formatDate("2026-10-28")).toBe("28/10/2026");
  });

  it("formats a Date object as DD/MM/YYYY", () => {
    expect(formatDate(new Date(2026, 9, 28))).toBe("28/10/2026");
  });

  it("returns N/A for missing or invalid input", () => {
    expect(formatDate(null)).toBe("N/A");
    expect(formatDate(undefined)).toBe("N/A");
    expect(formatDate("not-a-date")).toBe("N/A");
  });
});

describe("formatDateTime (unchanged by the Inward redesign)", () => {
  it("still renders a date and time", () => {
    expect(formatDateTime(new Date(2026, 9, 28, 14, 30))).toContain("2026");
  });
});
