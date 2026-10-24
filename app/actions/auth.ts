"use server";

/**
 * Server-side role enforcement (spec §17) — this file is the decision
 * record for the role-model conflict in this project:
 *
 * The client PDF (§17) WINS over IMPLEMENTATION_PLAN.md's single-role
 * note. The plan's "Administrator / Master Operator" becomes the
 * Owner/Admin role below; the other six PDF roles are enforced at the
 * top of every sensitive server action via requireRole(). Hiding a
 * button in the UI is never enforcement — an action that forgets its
 * requireRole() call is a bug, not a UI gap.
 *
 * Out-of-the-box behaviour: a single Owner/Admin operator is SEEDED
 * (Supabase Auth user + profiles row, procedure in SETUP.md). Until
 * that operator signs in, sensitive actions fail closed with
 * "Authentication required" — they do not silently run as admin.
 *
 * Role matrix (typical access, spec §17; final permissions configurable
 * via the profiles.role column):
 *   owner_admin         — everything, incl. user management & audit
 *   storekeeper         — receiving/stock views; no payroll/profit
 *   production_operator — recipe/batch & machinery entry; limited finance
 *   gate_operator       — view/print approved gate passes; no stock edits
 *   accountant          — purchases, receipts, payments, expenses,
 *                         ledgers, daybook, financial reports
 *   hr_payroll          — employees, attendance, payroll
 *   read_only_manager   — reads only; never a write action
 */

import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export type AppRole =
  | "owner_admin"
  | "storekeeper"
  | "production_operator"
  | "gate_operator"
  | "accountant"
  | "hr_payroll"
  | "read_only_manager";

export type ActionResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export interface Actor {
  userId: string;
  email: string | null;
  role: AppRole;
  displayName: string | null;
}

type DbClient = Awaited<ReturnType<typeof createClient>>;

/** Supabase client, or a fail-closed config error (no live project yet).
 * Single object type (db + error string) so destructuring call sites
 * type-check: when db is null, error carries the reason. */
export async function getDb(): Promise<{ db: DbClient | null; error: string }> {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
        !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return {
        db: null,
        error:
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
          "NEXT_PUBLIC_SUPABASE_ANON_KEY (see SETUP.md) — no credentials " +
          "are bundled with this app.",
      };
    }
    return { db: await createClient(), error: "" };
  } catch (err) {
    return { db: null, error: errMsg(err) };
  }
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown error";
}

/** Current signed-in user + profile, or null when not signed in. */
export async function getCurrentActor(
  db: DbClient,
): Promise<Actor | null> {
  const { data: userData, error: userError } = await db.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return null;
  const { data: profile } = await db
    .from("profiles")
    .select("role, display_name, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.is_active === false) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    role: profile.role as AppRole,
    displayName: profile.display_name ?? null,
  };
}

/**
 * Gate every sensitive action through this, FIRST, before any read or
 * write. Returns the actor on success; on failure returns { ok: false }
 * so the action can return { success: false, error } without touching
 * any data. Read-only manager is never in a write allow-list.
 */
export async function requireRole(
  db: DbClient,
  allowedRoles: AppRole[],
): Promise<
  | { ok: true; actor: Actor }
  | { ok: false; error: string }
> {
  const actor = await getCurrentActor(db);
  if (!actor) {
    return {
      ok: false,
      error:
        "Authentication required: sign in as an operator (see SETUP.md " +
        "for the seeded Owner/Admin procedure).",
    };
  }
  if (!allowedRoles.includes(actor.role)) {
    return {
      ok: false,
      error: `Role '${actor.role}' is not allowed to perform this action.`,
    };
  }
  return { ok: true, actor };
}

/** Read actions that any signed-in operator may call (not restricted reads). */
export async function requireSignedIn(
  db: DbClient,
): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  const actor = await getCurrentActor(db);
  if (!actor) {
    return { ok: false, error: "Authentication required: sign in first." };
  }
  return { ok: true, actor };
}

/** Convenience allow-lists used across finance.ts / payroll.ts. */
export const FINANCE_WRITE: AppRole[] = ["owner_admin", "accountant"];
export const FINANCE_READ_SENSITIVE: AppRole[] = ["owner_admin", "accountant"];
export const PAYROLL_WRITE: AppRole[] = ["owner_admin", "hr_payroll"];
export const PAYROLL_PAY: AppRole[] = ["owner_admin", "hr_payroll", "accountant"];
export const PAYROLL_READ: AppRole[] = [
  "owner_admin",
  "hr_payroll",
  "accountant",
];
export const OWNER_ONLY: AppRole[] = ["owner_admin"];

/** Own profile (for headers / "who am I" displays). */
export async function getMyProfile(): Promise<ActionResult<Actor | null>> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const actor = await getCurrentActor(db);
  return { success: true, data: actor };
}

/** List operator profiles — Owner/Admin only. */
export async function listProfiles(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, OWNER_ONLY);
  if (!gate.ok) return { success: false, error: gate.error };
  const { data, error: qError } = await db
    .from("profiles")
    .select("id, role, display_name, is_active, created_at")
    .order("created_at", { ascending: true });
  if (qError) return { success: false, error: qError.message };
  return { success: true, data };
}

/**
 * Change an operator's role — Owner/Admin only, audited, and the last
 * active Owner/Admin cannot be demoted or deactivated (otherwise the
 * business locks itself out of user management).
 */
export async function setUserRole(
  targetUserId: string,
  role: AppRole,
  reason: string,
): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const gate = await requireRole(db, OWNER_ONLY);
  if (!gate.ok) return { success: false, error: gate.error };
  if (!targetUserId || !reason?.trim()) {
    return {
      success: false,
      error: "targetUserId and a reason are required for permission changes.",
    };
  }
  const { data: before } = await db
    .from("profiles")
    .select("role, display_name, is_active")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!before) return { success: false, error: "Operator profile not found." };
  if (before.role === "owner_admin" && role !== "owner_admin") {
    const { count } = await db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner_admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return {
        success: false,
        error: "Cannot demote the last active Owner/Admin.",
      };
    }
  }
  const { data, error: uError } = await db
    .from("profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", targetUserId)
    .select()
    .single();
  if (uError) return { success: false, error: uError.message };
  await logAudit(db, {
    action: "permission_change",
    entityType: "profiles",
    entityId: targetUserId,
    before: { role: before.role },
    after: { role },
    reason,
    userId: gate.actor.userId,
    userEmail: gate.actor.email,
  });
  return { success: true, data };
}

/** Sign out the current operator. */
export async function signOutAction(): Promise<ActionResult> {
  const { db, error } = await getDb();
  if (!db) return { success: false, error };
  const { error: sError } = await db.auth.signOut();
  if (sError) return { success: false, error: sError.message };
  return { success: true, data: null };
}
