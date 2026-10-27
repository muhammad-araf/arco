"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, requireSignedIn } from "./auth";
import { MASTERS_WRITE } from "./auth-helpers";

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
  });
}
export async function deactivateEmployee(id: string): Promise<ActionResult> {
  return deactivateRow("employees", id);
}
