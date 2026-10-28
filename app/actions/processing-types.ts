"use server";

import { revalidatePath } from "next/cache";
import { getDb, requireRole, requireSignedIn, type ActionResult } from "./auth";
import { MASTERS_WRITE } from "./auth-helpers";
import { logAudit } from "@/lib/audit";

/**
 * Processing-types master (new table `processing_types`: id, name,
 * is_active — see supabase/migration-settings-processing-types.sql).
 *
 * CONTRACT FOR THE PRODUCTION TEAM — keep these names stable:
 * - listProcessingTypes(includeInactive?): ActionResult rows ordered
 *   by name. When the returned list is EMPTY, callers fall back to
 *   free-text processing types (the machines page behaviour today).
 *   A failed result means the table/query itself failed — callers
 *   should treat that as free-text fallback too, never as "no types".
 * - createProcessingType(name): owner_admin only (MASTERS_WRITE).
 * - deactivateProcessingType(id): owner_admin only; never deletes.
 *
 * Rows are NEVER deleted, mirroring the other masters in
 * app/actions/masters.ts. Names are unique (DB constraint); a
 * duplicate returns { success: false } instead of overwriting.
 */

export interface ProcessingType {
  id: string;
  name: string;
  is_active: boolean;
  created_at?: string;
}

function fail(error: string): ActionResult {
  return { success: false, error };
}

/** All processing types, active first by name order. Any signed-in
 * operator may read. */
export async function listProcessingTypes(
  includeInactive = false,
): Promise<ActionResult<ProcessingType[]>> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  let query = db.from("processing_types").select("*").order("name");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error: qError } = await query;
  if (qError) return { success: false, error: qError.message };
  return { success: true, data: (data ?? []) as ProcessingType[] };
}

export async function createProcessingType(
  name: string,
): Promise<ActionResult<ProcessingType>> {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) return { success: false, error: "Processing type name is required." };
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, MASTERS_WRITE);
  if (!gate.ok) return { success: false, error: gate.error };
  const { data, error: iError } = await db
    .from("processing_types")
    .insert({ name: clean })
    .select()
    .single();
  if (iError) return { success: false, error: iError.message };
  await logAudit(db, {
    action: "create",
    entityType: "processing_types",
    entityId: (data as { id?: string })?.id ?? null,
    after: { name: clean },
    userId: gate.actor.userId,
    userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/settings");
  revalidatePath("/ledgers");
  return { success: true, data: data as ProcessingType };
}

export async function deactivateProcessingType(
  id: string,
): Promise<ActionResult<ProcessingType>> {
  if (!id) return { success: false, error: "id is required." };
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, MASTERS_WRITE);
  if (!gate.ok) return { success: false, error: gate.error };
  const { data, error: uError } = await db
    .from("processing_types")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();
  if (uError) return { success: false, error: uError.message };
  await logAudit(db, {
    action: "deactivate",
    entityType: "processing_types",
    entityId: id,
    before: { is_active: true },
    after: { is_active: false },
    userId: gate.actor.userId,
    userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/settings");
  revalidatePath("/ledgers");
  return { success: true, data: data as ProcessingType };
}

export async function reactivateProcessingType(
  id: string,
): Promise<ActionResult<ProcessingType>> {
  if (!id) return { success: false, error: "id is required." };
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, MASTERS_WRITE);
  if (!gate.ok) return { success: false, error: gate.error };
  const { data, error: uError } = await db
    .from("processing_types")
    .update({ is_active: true })
    .eq("id", id)
    .select()
    .single();
  if (uError) return { success: false, error: uError.message };
  await logAudit(db, {
    action: "reactivate",
    entityType: "processing_types",
    entityId: id,
    before: { is_active: false },
    after: { is_active: true },
    userId: gate.actor.userId,
    userEmail: gate.actor.email,
  });
  revalidatePath("/masters");
  revalidatePath("/settings");
  revalidatePath("/ledgers");
  return { success: true, data: data as ProcessingType };
}
