"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDb, requireRole, requireSignedIn, type ActionResult } from "./auth";
import { OWNER_ONLY } from "./auth-helpers";
import { logAudit } from "@/lib/audit";

/**
 * Settings server actions (spec §§3.3, 4.1, 9.4).
 *
 * All business values that used to be hard-coded live here as rows in
 * the app_settings key/value table (value is JSONB). Nothing in this
 * file invents a business value: every key below resolves to a stated
 * default when its row is absent, and the Settings screen is the only
 * place an operator changes them.
 *
 * CONTRACT FOR OTHER TEAMS — keep these names and shapes stable:
 * - getCompanySettings(): ActionResult<CompanySettings | null> — the
 *   `company` row as { name, address, phone, email, logo_url }, or
 *   null when no company row exists yet. Missing fields read as null.
 * - getAppSetting(key): ActionResult<unknown> — the raw `value` of one
 *   app_settings row, or null when the row is absent. Callers that
 *   need a resolved value (with the defaults below applied) should use
 *   getSettingsSnapshot() instead.
 * - getSettingsSnapshot(): ActionResult<SettingsSnapshot> — every
 *   setting key below, resolved against its default.
 *
 * Gates: reads are any signed-in operator; every write is
 * owner_admin-only (OWNER_ONLY via requireRole), and every write is
 * audited via logAudit (entity_type "app_settings", entity_id = key).
 * No write path touches payroll_rules / pl_config — those rows belong
 * to their own modules and are deliberately NOT in SETTING_KEYS.
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

type Db = Awaited<ReturnType<typeof createClient>>;

function fail(error: string): ActionResult {
  return { success: false, error };
}

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

function normaliseCompany(v: unknown): CompanySettings | null {
  if (!isRecord(v)) return null;
  return {
    name: asStringOrNull(v.name),
    address: asStringOrNull(v.address),
    phone: asStringOrNull(v.phone),
    email: asStringOrNull(v.email),
    logo_url: asStringOrNull(v.logo_url),
  };
}

function normaliseSnapshot(
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

async function readSettingRow(
  db: Db,
  key: string,
): Promise<unknown | null> {
  const { data, error } = await db
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { value?: unknown }).value ?? null;
}

/** Raw value of one app_settings row, or null when absent. Any
 * signed-in operator may read; fail-closed when not signed in. */
export async function getAppSetting(
  key: string,
): Promise<ActionResult<unknown>> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  return { success: true, data: await readSettingRow(db, key) };
}

/** The `company` row as { name, address, phone, email, logo_url },
 * or null when no company row exists yet. */
export async function getCompanySettings(): Promise<
  ActionResult<CompanySettings | null>
> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  return { success: true, data: normaliseCompany(await readSettingRow(db, "company")) };
}

/** Every setting key, resolved against its default (see
 * SETTING_DEFAULTS). One query; the Settings screen and the dashboard
 * layout (session timeout) both read through this. */
export async function getSettingsSnapshot(): Promise<
  ActionResult<SettingsSnapshot>
> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  const { data, error: qError } = await db
    .from("app_settings")
    .select("key, value");
  if (qError) return { success: false, error: qError.message };
  const rows: Record<string, unknown> = {};
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    rows[row.key] = row.value;
  }
  return { success: true, data: normaliseSnapshot(rows) };
}

// ---------------- Validation (write path) ----------------

/** Validate + normalise one setting value. Returns the value to store,
 * or an error string. 0 is a valid session timeout (it disables idle
 * sign-out); negatives and non-integers are not. */
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

async function writeSetting(
  db: Db,
  actor: { userId: string | null; email: string | null },
  key: string,
  value: unknown,
): Promise<ActionResult> {
  const before = await readSettingRow(db, key);
  const { error } = await db.from("app_settings").upsert(
    {
      key,
      value,
      updated_by: actor.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return fail(error.message);
  await logAudit(db, {
    action: "update",
    entityType: "app_settings",
    entityId: key,
    before: { value: before ?? null },
    after: { value },
    userId: actor.userId,
    userEmail: actor.email,
  });
  revalidatePath("/settings");
  revalidatePath("/migration");
  return { success: true, data: { key, value } };
}

/** Write one whitelisted setting (owner_admin only, validated, audited).
 * Payroll/pl rows are deliberately rejected: they are not in
 * SETTING_KEYS. */
export async function updateAppSetting(
  key: string,
  value: unknown,
): Promise<ActionResult> {
  if (!(SETTING_KEYS as readonly string[]).includes(key)) {
    return fail(`Setting "${key}" is not editable here.`);
  }
  const validated = validateSettingValue(key, value);
  if ("error" in validated) return fail(validated.error);
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, OWNER_ONLY);
  if (!gate.ok) return { success: false, error: gate.error };
  return writeSetting(db, gate.actor, key, validated.value);
}

/** Write the `company` row (owner_admin only, validated, audited). */
export async function updateCompanySettings(
  input: Partial<CompanySettings>,
): Promise<ActionResult> {
  const validated = validateSettingValue("company", input ?? {});
  if ("error" in validated) return fail(validated.error);
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, OWNER_ONLY);
  if (!gate.ok) return { success: false, error: gate.error };
  return writeSetting(db, gate.actor, "company", validated.value);
}

// ---------------- Voucher (doc) numbering ----------------

/** All doc_numbering rows, in series order. Any signed-in operator
 * may read; only the prefix column is editable (see below) — last_no
 * is advanced only by the atomic next_doc_number() RPC, never here. */
export async function listDocNumbering(): Promise<
  ActionResult<DocNumberingRow[]>
> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  const { data, error: qError } = await db
    .from("doc_numbering")
    .select("series, prefix, last_no")
    .order("series");
  if (qError) return { success: false, error: qError.message };
  return { success: true, data: (data ?? []) as DocNumberingRow[] };
}

/** Change one series' prefix (owner_admin only, audited). The atomic
 * next_doc_number() RPC keeps the stored prefix on conflict, so a new
 * prefix takes effect for numbers issued after the edit; already
 * issued numbers never change. last_no is never touched here. */
export async function updateDocNumberingPrefix(
  series: string,
  prefix: string,
): Promise<ActionResult> {
  const cleanSeries = typeof series === "string" ? series.trim() : "";
  const cleanPrefix = typeof prefix === "string" ? prefix.trim() : "";
  if (!cleanSeries) return fail("Series is required.");
  if (!/^[A-Za-z0-9_-]{1,10}$/.test(cleanPrefix)) {
    return fail("Prefix must be 1–10 letters, digits, dashes or underscores.");
  }
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, OWNER_ONLY);
  if (!gate.ok) return { success: false, error: gate.error };
  const { data: before } = await db
    .from("doc_numbering")
    .select("prefix")
    .eq("series", cleanSeries)
    .maybeSingle();
  if (!before) return fail(`No numbering series "${cleanSeries}" exists yet.`);
  const { error: uError } = await db
    .from("doc_numbering")
    .update({ prefix: cleanPrefix })
    .eq("series", cleanSeries);
  if (uError) return fail(uError.message);
  await logAudit(db, {
    action: "update",
    entityType: "doc_numbering",
    entityId: cleanSeries,
    before: { prefix: (before as { prefix?: unknown }).prefix ?? null },
    after: { prefix: cleanPrefix },
    userId: gate.actor.userId,
    userEmail: gate.actor.email,
  });
  revalidatePath("/settings");
  return { success: true, data: { series: cleanSeries, prefix: cleanPrefix } };
}
