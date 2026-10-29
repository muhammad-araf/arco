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
 * FAIL CLOSED (B2): getCurrentActor() returns null when the signed-in
 * user has no profiles row, when the profile is inactive, or when the
 * stored role string is not a recognised role. It NEVER defaults to
 * owner_admin. Legacy role strings "owner" / "admin" (which older
 * databases may hold) are normalised to owner_admin, because the app
 * itself has always treated them as admin — and the last-admin guard
 * in setUserRole() counts all three spellings.
 *
 * Role matrix (typical access, spec §17; final permissions configurable
 * via the profiles.role column):
 *   owner_admin         — everything, incl. user management & audit
 *   storekeeper         — receiving/stock views; no payroll/profit;
 *                         stock writes (inward, transfers, adjustments,
 *                         gate passes) via STOCK_WRITE
 *   production_operator — recipe/batch & machinery entry; limited finance
 *   gate_operator       — view/print approved gate passes; no stock edits
 *   accountant          — purchases, receipts, payments, expenses,
 *                         ledgers, daybook, financial reports
 *   hr_payroll          — employees, attendance, payroll
 *   read_only_manager   — reads only; never a write action
 *
 * Write groups (see auth-helpers.ts): STOCK_WRITE, PRODUCTION_WRITE,
 * MACHINERY_WRITE, MASTERS_WRITE (owner_admin only). Stock/master
 * reads are open to any signed-in operator (requireSignedIn) — the
 * finance/payroll pattern of role-restricted sensitive reads is kept
 * for finance and payroll only, not extended to stock reads.
 */

import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  type AppRole,
  errMsg,
  OWNER_ONLY,
} from "./auth-helpers";

export type { AppRole };

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

interface CachedActor {
  actor: Actor | null;
  expires: number;
}
const actorCache = new Map<string, CachedActor>();

export async function clearActorCache(userId?: string): Promise<void> {
  if (userId) actorCache.delete(userId);
  else actorCache.clear();
}

/** Current signed-in user + profile, or null when not signed in. */
export async function getCurrentActor(
  db: DbClient,
): Promise<Actor | null> {
  let sessionUserId: string | null = null;
  try {
    const { data: sessionData } = await db.auth.getSession();
    sessionUserId = sessionData?.session?.user?.id ?? null;
  } catch {
    sessionUserId = null;
  }

  if (sessionUserId) {
    const cached = actorCache.get(sessionUserId);
    if (cached && Date.now() < cached.expires) {
      return cached.actor;
    }
  }

  const { data: userData, error: userError } = await db.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    if (sessionUserId) actorCache.set(sessionUserId, { actor: null, expires: Date.now() + 5000 });
    return null;
  }
  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // FAIL CLOSED: no profiles row means no authorised actor. A
  // signed-in user without a profile (e.g. a self-registered account
  // when sign-ups are on) is denied everywhere, never promoted to
  // owner_admin. Display-only callers (sidebar) already handle null
  // by showing the session email or a generic label — that fallback
  // is display only and never authorises anything.
  if (!profile) {
    actorCache.set(user.id, { actor: null, expires: Date.now() + 10000 });
    return null;
  }

  const isActive = profile.is_active !== undefined
    ? profile.is_active !== false
    : profile.status ? profile.status === "active" : true;

  if (!isActive) {
    actorCache.set(user.id, { actor: null, expires: Date.now() + 10000 });
    return null;
  }

  // Map the stored role. Legacy "owner" / "admin" spellings normalise
  // to owner_admin; anything else unrecognised (including an empty
  // role) FAILS CLOSED — it is never promoted to owner_admin and
  // never silently demoted to a readable role either.
  const rawRole = (profile.role || "").toLowerCase();
  let role: AppRole;
  if (rawRole === "owner_admin" || rawRole === "owner" || rawRole === "admin") {
    role = "owner_admin";
  } else if (rawRole === "accountant") {
    role = "accountant";
  } else if (rawRole === "hr_payroll") {
    role = "hr_payroll";
  } else if (rawRole === "storekeeper") {
    role = "storekeeper";
  } else if (rawRole === "production_operator") {
    role = "production_operator";
  } else if (rawRole === "gate_operator") {
    role = "gate_operator";
  } else if (rawRole === "read_only_manager") {
    role = "read_only_manager";
  } else {
    actorCache.set(user.id, { actor: null, expires: Date.now() + 10000 });
    return null;
  }

  const displayName = profile.display_name || profile.full_name || user.email;

  const actor: Actor = {
    userId: user.id,
    email: user.email ?? null,
    role,
    displayName: displayName ?? null,
  };

  actorCache.set(user.id, { actor, expires: Date.now() + 30000 });
  return actor;
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
    .select("*")
    .order("created_at", { ascending: true });
  if (qError) return { success: false, error: qError.message };
  const normalized = (data || []).map((p: any) => ({
    id: p.id,
    role: p.role === "owner" || p.role === "admin" ? "owner_admin" : p.role,
    display_name: p.display_name || p.full_name || p.email || "Operator",
    is_active: p.is_active !== undefined ? p.is_active : p.status === "active",
    created_at: p.created_at,
  }));
  return { success: true, data: normalized };
}

/**
 * Change an operator's role — Owner/Admin only, audited, and the last
 * active Owner/Admin cannot be demoted (otherwise the business locks
 * itself out of user management). "Last admin" counts every admin
 * spelling: owner_admin, owner, and admin.
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
  // Last-admin guard (M12): count EVERY spelling the app treats as
  // admin ("owner_admin", "owner", "admin"), not just the canonical
  // one — otherwise demoting the last canonical row while a legacy
  // spelling exists (or vice versa) miscounts. Roles are counted in
  // code rather than filtered in SQL so a legacy spelling stored in a
  // database whose role column is the app_role_enum (which has no
  // "owner"/"admin" values) cannot make the query itself fail.
  const beforeIsAdmin =
    before.role === "owner_admin" ||
    before.role === "owner" ||
    before.role === "admin";
  if (beforeIsAdmin && role !== "owner_admin") {
    const { data: activeProfiles, error: countError } = await db
      .from("profiles")
      .select("role")
      .eq("is_active", true);
    if (countError) {
      return {
        success: false,
        error:
          "Cannot verify the last-admin guard; demotion refused. " +
          countError.message,
      };
    }
    const adminCount = (activeProfiles ?? []).filter(
      (p: { role: string }) =>
        p.role === "owner_admin" || p.role === "owner" || p.role === "admin",
    ).length;
    if (adminCount <= 1) {
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
  clearActorCache(targetUserId);
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
