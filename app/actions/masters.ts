"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireSignedIn } from "./auth";
import { MASTERS_WRITE } from "./auth-helpers";
import { logAudit } from "@/lib/audit";

/**
 * Master-data server actions (godowns, products, parties, machines,
 * packaging_types, employees).
 *
 * Rules enforced here (single-ledger / spec §3):
 * - Rows are NEVER deleted. A referenced master can only be deactivated
 *   (is_active = false); deactivation never touches ledger history.
 * - Codes are unique per table (enforced by DB unique constraints); a
 *   duplicate code returns { success: false } instead of overwriting.
 * - Every action returns { success, data?, error? }. No action throws
 *   to the caller.
 * - No client-supplied id is trusted for creation: ids are DB-generated.
 */

type Db = Awaited<ReturnType<typeof createClient>>;
type ActionResult = { success: boolean; data?: unknown; error?: string };

function ok(data: unknown): ActionResult {
  return { success: true, data };
}
function fail(error: string): ActionResult {
  return { success: false, error };
}
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
async function db(): Promise<Db> {
  return createClient();
}
function revalidateMasters(): void {
  revalidatePath("/masters");
  revalidatePath("/dashboard");
  revalidatePath("/employees");
  revalidatePath("/parties");
  revalidatePath("/ledgers");
  revalidatePath("/people");
}

async function listTable(
  table: string,
  includeInactive: boolean,
  orderBy: string,
): Promise<ActionResult> {
  try {
    const supabase = await db();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    let query = supabase.from(table).select("*").order(orderBy);
    if (!includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

async function getRow(table: string, id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await db();
    const gate = await requireSignedIn(supabase);
    if (!gate.ok) return fail(gate.error);
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("id", id)
      .single();
    if (error) return fail(error.message);
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

async function createRow(table: string, row: Record<string, unknown>): Promise<ActionResult> {
  try {
    const supabase = await db();
    const gate = await requireRole(supabase, MASTERS_WRITE);
    if (!gate.ok) return fail(gate.error);
    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) return fail(error.message);
    await logAudit(supabase, {
      action: "create", entityType: table, entityId: (data as { id?: string })?.id ?? null,
      after: { code: row.code ?? null, name: (row.name ?? row.full_name) ?? null },
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    revalidateMasters();
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

async function deactivateRow(table: string, id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await db();
    const gate = await requireRole(supabase, MASTERS_WRITE);
    if (!gate.ok) return fail(gate.error);
    const { data, error } = await supabase
      .from(table)
      .update({ is_active: false })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(error.message);
    await logAudit(supabase, {
      action: "deactivate", entityType: table, entityId: id,
      before: { is_active: true }, after: { is_active: false },
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    revalidateMasters();
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

async function reactivateRow(table: string, id: string): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const supabase = await db();
    const gate = await requireRole(supabase, MASTERS_WRITE);
    if (!gate.ok) return fail(gate.error);
    const { data, error } = await supabase
      .from(table)
      .update({ is_active: true })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(error.message);
    await logAudit(supabase, {
      action: "reactivate", entityType: table, entityId: id,
      before: { is_active: false }, after: { is_active: true },
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    revalidateMasters();
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

function nonNegNumber(v: unknown, field: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Whitelisted partial update: only fields in `patch` are written, and
 * numeric fields are rejected when negative or non-numeric. */
async function updateRow(table: string, id: string, patch: Record<string, unknown>): Promise<ActionResult> {
  try {
    if (!id) return fail("id is required");
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      clean[k] = v;
    }
    if (Object.keys(clean).length === 0) return fail("Nothing to update.");
    const supabase = await db();
    const gate = await requireRole(supabase, MASTERS_WRITE);
    if (!gate.ok) return fail(gate.error);
    const { data: before } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    if (!before) return fail("Record not found.");
    const { data, error } = await supabase.from(table).update(clean).eq("id", id).select().single();
    if (error) return fail(error.message);
    await logAudit(supabase, {
      action: "update", entityType: table, entityId: id,
      before: before as Record<string, unknown>,
      after: clean,
      userId: gate.actor.userId, userEmail: gate.actor.email,
    });
    revalidateMasters();
    return ok(data);
  } catch (e) {
    return fail(errMessage(e));
  }
}

// ---------------- Godowns ----------------
export async function listGodowns(includeInactive = false): Promise<ActionResult> {
  return listTable("godowns", includeInactive, "code");
}
export async function getGodown(id: string): Promise<ActionResult> {
  return getRow("godowns", id);
}
export async function createGodown(input: {
  code: string;
  name: string;
  capacity_metric_tons?: number;
  address?: string;
}): Promise<ActionResult> {
  if (!input?.code?.trim() || !input?.name?.trim()) {
    return fail("Godown code and name are required");
  }
  return createRow("godowns", {
    code: input.code.trim(),
    name: input.name.trim(),
    capacity_metric_tons: input.capacity_metric_tons ?? null,
    address: input.address ?? null,
  });
}
export async function deactivateGodown(id: string): Promise<ActionResult> {
  return deactivateRow("godowns", id);
}

// ---------------- Products ----------------
export async function listProducts(includeInactive = false): Promise<ActionResult> {
  return listTable("products", includeInactive, "code");
}
export async function getProduct(id: string): Promise<ActionResult> {
  return getRow("products", id);
}
export async function createProduct(input: {
  code: string;
  name: string;
  category: string;
  default_unit?: string;
  weight_per_bag?: number;
  min_stock?: number;
  notes?: string;
}): Promise<ActionResult> {
  if (!input?.code?.trim() || !input?.name?.trim() || !input?.category) {
    return fail("Product code, name and category are required");
  }
  return createRow("products", {
    code: input.code.trim(),
    name: input.name.trim(),
    category: input.category,
    default_unit: input.default_unit ?? "kg",
    weight_per_bag: input.weight_per_bag ?? null,
    min_stock: input.min_stock ?? 0,
    notes: input.notes ?? null,
  });
}
export async function deactivateProduct(id: string): Promise<ActionResult> {
  return deactivateRow("products", id);
}

// ---------------- Parties ----------------
export async function listParties(includeInactive = false): Promise<ActionResult> {
  return listTable("parties", includeInactive, "code");
}
export async function getParty(id: string): Promise<ActionResult> {
  return getRow("parties", id);
}
export async function createParty(input: {
  code: string;
  name: string;
  type?: string;
  contact_person?: string;
  phone?: string;
  address?: string;
  opening_balance?: number;
  balance_type?: string;
  notes?: string;
  tax_id?: string;
  registration_no?: string;
}): Promise<ActionResult> {
  if (!input?.code?.trim() || !input?.name?.trim()) {
    return fail("Party code and name are required");
  }
  return createRow("parties", {
    code: input.code.trim(),
    name: input.name.trim(),
    type: input.type ?? "customer",
    contact_person: input.contact_person ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    opening_balance: input.opening_balance ?? 0,
    balance_type: input.balance_type ?? "receivable",
    notes: input.notes ?? null,
    tax_id: input.tax_id?.trim() || null,
    registration_no: input.registration_no?.trim() || null,
  });
}
export async function deactivateParty(id: string): Promise<ActionResult> {
  return deactivateRow("parties", id);
}

// ---------------- Machines ----------------
export async function listMachines(includeInactive = false): Promise<ActionResult> {
  return listTable("machines", includeInactive, "code");
}
export async function getMachine(id: string): Promise<ActionResult> {
  return getRow("machines", id);
}
export async function createMachine(input: {
  code: string;
  name: string;
  processing_type: string;
  capacity_kg_per_hour?: number;
  operator_name?: string;
  notes?: string;
}): Promise<ActionResult> {
  if (!input?.code?.trim() || !input?.name?.trim() || !input?.processing_type?.trim()) {
    return fail("Machine code, name and processing_type are required");
  }
  return createRow("machines", {
    code: input.code.trim(),
    name: input.name.trim(),
    processing_type: input.processing_type.trim(),
    capacity_kg_per_hour: input.capacity_kg_per_hour ?? null,
    operator_name: input.operator_name ?? null,
    notes: input.notes ?? null,
  });
}
export async function deactivateMachine(id: string): Promise<ActionResult> {
  return deactivateRow("machines", id);
}

// ---------------- Packaging types (Bardana) ----------------
export async function listPackagingTypes(includeInactive = false): Promise<ActionResult> {
  return listTable("packaging_types", includeInactive, "code");
}
export async function getPackagingType(id: string): Promise<ActionResult> {
  return getRow("packaging_types", id);
}
export async function createPackagingType(input: {
  code: string;
  name: string;
  capacity_kg?: number;
  cost_per_bag?: number;
  reorder_level?: number;
  current_stock?: number;
}): Promise<ActionResult> {
  if (!input?.code?.trim() || !input?.name?.trim()) {
    return fail("Packaging code and name are required");
  }
  return createRow("packaging_types", {
    code: input.code.trim(),
    name: input.name.trim(),
    capacity_kg: input.capacity_kg ?? null,
    cost_per_bag: input.cost_per_bag ?? 0,
    reorder_level: input.reorder_level ?? 0,
    // Opening bardana stock only: later movements go through packing
    // records / purchases (finance agent), never by editing this directly.
    current_stock: input.current_stock ?? 0,
  });
}
export async function deactivatePackagingType(id: string): Promise<ActionResult> {
  return deactivateRow("packaging_types", id);
}

// ---------------- Employees ----------------
export async function listEmployees(includeInactive = false): Promise<ActionResult> {
  return listTable("employees", includeInactive, "code");
}
export async function getEmployee(id: string): Promise<ActionResult> {
  return getRow("employees", id);
}
export async function createEmployee(input: {
  code: string;
  full_name: string;
  designation: string;
  phone?: string;
  pay_type?: string;
  base_rate?: number;
  joining_date?: string;
  payment_preference?: string;
}): Promise<ActionResult> {
  if (!input?.code?.trim() || !input?.full_name?.trim() || !input?.designation?.trim()) {
    return fail("Employee code, full name and designation are required");
  }
  return createRow("employees", {
    code: input.code.trim(),
    full_name: input.full_name.trim(),
    designation: input.designation.trim(),
    phone: input.phone ?? null,
    pay_type: input.pay_type ?? "monthly",
    base_rate: input.base_rate ?? 0,
    joining_date: input.joining_date ?? null,
    payment_preference: input.payment_preference?.trim() || null,
  });
}
export async function deactivateEmployee(id: string): Promise<ActionResult> {
  return deactivateRow("employees", id);
}

// ---------------- Updates & reactivation ----------------
// All updates and reactivations keep the same Owner/Admin-only gate as
// creation/deactivation (MASTERS_WRITE inside updateRow/reactivateRow).
export async function updateGodown(id: string, input: {
  name?: string; capacity_metric_tons?: number; address?: string;
}): Promise<ActionResult> {
  if (input.name !== undefined && !input.name.trim()) return fail("Godown name is required");
  if (input.capacity_metric_tons !== undefined && nonNegNumber(input.capacity_metric_tons, "capacity") === null) return fail("Capacity must be >= 0.");
  return updateRow("godowns", id, {
    name: input.name?.trim(), capacity_metric_tons: input.capacity_metric_tons, address: input.address,
  });
}
export async function reactivateGodown(id: string): Promise<ActionResult> {
  return reactivateRow("godowns", id);
}

export async function updateProduct(id: string, input: {
  name?: string; category?: string; default_unit?: string;
  weight_per_bag?: number; min_stock?: number; notes?: string;
}): Promise<ActionResult> {
  if (input.name !== undefined && !input.name.trim()) return fail("Product name is required");
  if (input.weight_per_bag !== undefined && nonNegNumber(input.weight_per_bag, "weight") === null) return fail("Bag weight must be >= 0.");
  if (input.min_stock !== undefined && nonNegNumber(input.min_stock, "min_stock") === null) return fail("Minimum stock must be >= 0.");
  return updateRow("products", id, {
    name: input.name?.trim(), category: input.category, default_unit: input.default_unit,
    weight_per_bag: input.weight_per_bag, min_stock: input.min_stock, notes: input.notes,
  });
}
export async function reactivateProduct(id: string): Promise<ActionResult> {
  return reactivateRow("products", id);
}

export async function updateParty(id: string, input: {
  name?: string; type?: string; contact_person?: string; phone?: string;
  address?: string; opening_balance?: number; balance_type?: string; notes?: string;
  tax_id?: string | null; registration_no?: string | null;
}): Promise<ActionResult> {
  if (input.name !== undefined && !input.name.trim()) return fail("Party name is required");
  if (input.opening_balance !== undefined && nonNegNumber(input.opening_balance, "opening_balance") === null) return fail("Opening balance must be >= 0.");
  if (input.balance_type !== undefined && !["receivable", "payable"].includes(input.balance_type)) return fail("balance_type must be receivable or payable.");
  return updateRow("parties", id, {
    name: input.name?.trim(), type: input.type, contact_person: input.contact_person,
    phone: input.phone, address: input.address,
    opening_balance: input.opening_balance, balance_type: input.balance_type, notes: input.notes,
    tax_id: input.tax_id, registration_no: input.registration_no,
  });
}
export async function reactivateParty(id: string): Promise<ActionResult> {
  return reactivateRow("parties", id);
}

export async function updateMachine(id: string, input: {
  name?: string; processing_type?: string; capacity_kg_per_hour?: number;
  operator_name?: string; notes?: string;
}): Promise<ActionResult> {
  if (input.name !== undefined && !input.name.trim()) return fail("Machine name is required");
  if (input.processing_type !== undefined && !input.processing_type.trim()) return fail("Processing type is required");
  if (input.capacity_kg_per_hour !== undefined && nonNegNumber(input.capacity_kg_per_hour, "capacity") === null) return fail("Capacity must be >= 0.");
  return updateRow("machines", id, {
    name: input.name?.trim(), processing_type: input.processing_type?.trim(),
    capacity_kg_per_hour: input.capacity_kg_per_hour, operator_name: input.operator_name,
    notes: input.notes,
  });
}
export async function reactivateMachine(id: string): Promise<ActionResult> {
  return reactivateRow("machines", id);
}

export async function updatePackagingType(id: string, input: {
  name?: string; capacity_kg?: number; cost_per_bag?: number; reorder_level?: number;
}): Promise<ActionResult> {
  if (input.name !== undefined && !input.name.trim()) return fail("Packaging name is required");
  if (input.capacity_kg !== undefined && nonNegNumber(input.capacity_kg, "capacity") === null) return fail("Capacity must be >= 0.");
  if (input.cost_per_bag !== undefined && nonNegNumber(input.cost_per_bag, "cost") === null) return fail("Cost per bag must be >= 0.");
  if (input.reorder_level !== undefined && nonNegNumber(input.reorder_level, "reorder") === null) return fail("Reorder level must be >= 0.");
  return updateRow("packaging_types", id, {
    name: input.name?.trim(), capacity_kg: input.capacity_kg,
    cost_per_bag: input.cost_per_bag, reorder_level: input.reorder_level,
  });
}
export async function reactivatePackagingType(id: string): Promise<ActionResult> {
  return reactivateRow("packaging_types", id);
}

export async function updateEmployee(id: string, input: {
  full_name?: string; designation?: string; phone?: string;
  pay_type?: string; base_rate?: number; joining_date?: string;
  payment_preference?: string | null;
}): Promise<ActionResult> {
  if (input.full_name !== undefined && !input.full_name.trim()) return fail("Employee name is required");
  if (input.designation !== undefined && !input.designation.trim()) return fail("Designation is required");
  if (input.base_rate !== undefined && nonNegNumber(input.base_rate, "base_rate") === null) return fail("Base rate must be >= 0.");
  return updateRow("employees", id, {
    full_name: input.full_name?.trim(), designation: input.designation?.trim(),
    phone: input.phone, pay_type: input.pay_type,
    base_rate: input.base_rate, joining_date: input.joining_date,
    payment_preference: input.payment_preference,
  });
}
export async function reactivateEmployee(id: string): Promise<ActionResult> {
  return reactivateRow("employees", id);
}
