"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDb, requireRole, requireSignedIn, type ActionResult } from "./auth";
import { OWNER_ONLY } from "./auth-helpers";
import { logAudit } from "@/lib/audit";
import {
  SETTING_KEYS,
  normaliseCompany,
  normaliseSnapshot,
  validateSettingValue,
  type CompanySettings,
  type DocNumberingRow,
  type SettingsSnapshot,
} from "@/lib/settings-validation";

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

type Db = Awaited<ReturnType<typeof createClient>>;

function fail(error: string): ActionResult {
  return { success: false, error };
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

let cachedSettingsSnapshot: { data: SettingsSnapshot; expires: number } | null = null;
let cachedCompanySettings: { data: CompanySettings | null; expires: number } | null = null;

export async function clearSettingsCache(): Promise<void> {
  cachedSettingsSnapshot = null;
  cachedCompanySettings = null;
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
  if (cachedCompanySettings && Date.now() < cachedCompanySettings.expires) {
    return { success: true, data: cachedCompanySettings.data };
  }
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  const data = normaliseCompany(await readSettingRow(db, "company"));
  cachedCompanySettings = { data, expires: Date.now() + 600000 }; // 10 minutes cache
  return { success: true, data };
}

/** Every setting key, resolved against its default (see
 * SETTING_DEFAULTS). One query; the Settings screen and the dashboard
 * layout (session timeout) both read through this. */
export async function getSettingsSnapshot(): Promise<
  ActionResult<SettingsSnapshot>
> {
  if (cachedSettingsSnapshot && Date.now() < cachedSettingsSnapshot.expires) {
    return { success: true, data: cachedSettingsSnapshot.data };
  }
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
  const snapshot = normaliseSnapshot(rows);
  cachedSettingsSnapshot = { data: snapshot, expires: Date.now() + 600000 }; // 10 minutes cache
  return { success: true, data: snapshot };
}

// ---------------- Write path (validation lives in lib/settings-validation) ----------------

async function writeSetting(
  db: Db,
  actor: { userId: string | null; email: string | null },
  key: string,
  value: unknown,
): Promise<ActionResult> {
  cachedSettingsSnapshot = null;
  cachedCompanySettings = null;
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
