"use server";

import { getDb, requireSignedIn, type ActionResult } from "./auth";
import { logAudit } from "@/lib/audit";

/**
 * Export audit trail (spec §16/§17). Client export buttons call this
 * after a successful download so every exported report leaves an audit
 * row. It never blocks the download: logAudit never throws, and a
 * missing session or unconfigured database just returns success:false
 * for the caller to ignore.
 *
 * Gate is requireSignedIn (any signed-in operator may export what they
 * can already view); export is a read-shaped action, not a write, so
 * no role allow-list is invented here.
 */
export async function logExport(input: {
  report: string;
  format?: string;
  filters?: Record<string, string> | string[];
}): Promise<ActionResult> {
  const report = (input.report || "").trim();
  if (!report) return { success: false, error: "Report name is required." };
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireSignedIn(db);
  if (!gate.ok) return { success: false, error: gate.error };
  await logAudit(db, {
    action: "export",
    entityType: "report",
    entityId: report,
    reason: `Exported ${report}`,
    userId: gate.actor.userId,
    userEmail: gate.actor.email,
    metadata: {
      report,
      format: input.format ?? "csv",
      filters: input.filters ?? {},
    },
  });
  return { success: true };
}
