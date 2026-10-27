/** Plain (non-server) settings validation + defaults.
 *
 * Moved out of app/actions/settings.ts: a "use server" module may only
 * export async functions, so the synchronous validator and the
 * SETTING_* constants broke `next build` under Turbopack even though
 * tsc passed. Behaviour here is unchanged — this is a pure move.
 */

export interface CompanySettings {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
}

export type BusinessModel = "unconfirmed" | "own" | "customer" | "both";
export type ValuationMethod =
  | "unconfirmed"
  | "last_purchase_cost"
  | "average_cost";
export type BiltyDuplicateCheck = "off" | "warn" | "block";

export interface SettingsSnapshot {
  company: CompanySettings | null;
  business_model: BusinessModel;
  valuation_method: ValuationMethod;
  currency: string;
  session_timeout_minutes: number;
  cutover_date: string | null;
  gatepass_approval_required: boolean;
  variance_tolerance_pct: number | null;
  bilty_duplicate_check: BiltyDuplicateCheck;
}

export interface DocNumberingRow {
  series: string;
  prefix: string;
  last_no: number;
}

export const SETTING_DEFAULTS: SettingsSnapshot = {
  company: null,
  business_model: "unconfirmed",
  valuation_method: "unconfirmed",
  currency: "PKR",
  session_timeout_minutes: 60,
  cutover_date: null,
  gatepass_approval_required: false,
  variance_tolerance_pct: null,
  bilty_duplicate_check: "warn",
};

/** The only keys updateAppSetting() may write. */
export const SETTING_KEYS = [
  "company",
  "business_model",
  "valuation_method",
  "currency",
  "session_timeout_minutes",
  "cutover_date",
  "gatepass_approval_required",
  "variance_tolerance_pct",
  "bilty_duplicate_check",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Legacy business_model rows were stored as an object ({ model: ... })
 * with pre-sign-off placeholder text; normalise every spelling to the
 * current enum so old seeded rows never surface as a "model". */
function normaliseBusinessModel(v: unknown): BusinessModel {
  const raw =
    typeof v === "string"
      ? v
      : isRecord(v) && typeof v.model === "string"
        ? v.model
        : "";
  const s = raw.trim().toLowerCase();
  if (s === "own" || s === "own_seed") return "own";
  if (s === "customer" || s === "customer_owned") return "customer";
  if (s === "both") return "both";
  return "unconfirmed";
}

function normaliseValuationMethod(v: unknown): ValuationMethod {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "last_purchase_cost") return "last_purchase_cost";
  if (s === "average_cost") return "average_cost";
  return "unconfirmed";
}

export function normaliseCompany(v: unknown): CompanySettings | null {
  if (!isRecord(v)) return null;
  return {
    name: asStringOrNull(v.name),
    address: asStringOrNull(v.address),
    phone: asStringOrNull(v.phone),
    email: asStringOrNull(v.email),
    logo_url: asStringOrNull(v.logo_url),
  };
}

export function normaliseSnapshot(
  rows: Record<string, unknown>,
): SettingsSnapshot {
  const timeoutRaw = rows.session_timeout_minutes;
  const timeout =
    typeof timeoutRaw === "number" &&
    Number.isInteger(timeoutRaw) &&
    timeoutRaw >= 0
      ? timeoutRaw
      : SETTING_DEFAULTS.session_timeout_minutes;
  const toleranceRaw = rows.variance_tolerance_pct;
  const tolerance =
    toleranceRaw === null || toleranceRaw === undefined
      ? null
      : typeof toleranceRaw === "number" &&
          Number.isFinite(toleranceRaw) &&
          toleranceRaw >= 0 &&
          toleranceRaw <= 100
        ? toleranceRaw
        : null;
  const biltyRaw =
    typeof rows.bilty_duplicate_check === "string"
      ? rows.bilty_duplicate_check
      : "";
  return {
    company: normaliseCompany(rows.company),
    business_model: normaliseBusinessModel(rows.business_model),
    valuation_method: normaliseValuationMethod(rows.valuation_method),
    currency:
      typeof rows.currency === "string" && rows.currency.trim()
        ? rows.currency.trim().toUpperCase()
        : SETTING_DEFAULTS.currency,
    session_timeout_minutes: timeout,
    cutover_date:
      typeof rows.cutover_date === "string" && rows.cutover_date.trim()
        ? rows.cutover_date.trim()
        : null,
    gatepass_approval_required: rows.gatepass_approval_required === true,
    variance_tolerance_pct: tolerance,
    bilty_duplicate_check:
      biltyRaw === "off" || biltyRaw === "block" ? biltyRaw : "warn",
  };
}

export function validateSettingValue(
  key: string,
  value: unknown,
): { value: unknown } | { error: string } {
  switch (key) {
    case "company": {
      if (!isRecord(value)) return { error: "Company settings must be an object." };
      const company = normaliseCompany(value);
      if (!company) return { error: "Company settings must be an object." };
      if (company.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email)) {
        return { error: "Company email looks invalid." };
      }
      return { value: company };
    }
    case "business_model": {
      const v = normaliseBusinessModel(value);
      // Reject anything that normalises away to "unconfirmed" unless the
      // caller actually sent "unconfirmed" — a typo must not silently
      // reset the model.
      if (v === "unconfirmed" && value !== "unconfirmed") {
        return { error: "business_model must be unconfirmed, own, customer or both." };
      }
      return { value: v };
    }
    case "valuation_method": {
      const v = normaliseValuationMethod(value);
      if (v === "unconfirmed" && value !== "unconfirmed") {
        return { error: "valuation_method must be unconfirmed, last_purchase_cost or average_cost." };
      }
      return { value: v };
    }
    case "currency": {
      const s = typeof value === "string" ? value.trim().toUpperCase() : "";
      if (!/^[A-Z]{1,10}$/.test(s)) {
        return { error: "Currency must be a short code such as PKR." };
      }
      return { value: s };
    }
    case "session_timeout_minutes": {
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
        return { error: "Session timeout must be a whole number of minutes (0 disables idle sign-out)." };
      }
      return { value: n };
    }
    case "cutover_date": {
      if (value === null || value === "" || value === undefined) {
        return { value: null };
      }
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { error: "Cutover date must be an ISO date (YYYY-MM-DD) or empty." };
      }
      const d = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
        return { error: "Cutover date is not a real calendar date." };
      }
      return { value };
    }
    case "gatepass_approval_required": {
      if (typeof value !== "boolean") {
        return { error: "gatepass_approval_required must be true or false." };
      }
      return { value };
    }
    case "variance_tolerance_pct": {
      if (value === null || value === "" || value === undefined) {
        return { value: null };
      }
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) {
        return { error: "Variance tolerance must be between 0 and 100, or empty to disable it." };
      }
      return { value: n };
    }
    case "bilty_duplicate_check": {
      if (value !== "off" && value !== "warn" && value !== "block") {
        return { error: "bilty_duplicate_check must be off, warn or block." };
      }
      return { value };
    }
    default:
      return { error: `Setting "${key}" is not editable here.` };
  }
}
