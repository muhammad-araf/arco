/**
 * Plain (non-"use server") helpers shared by the server actions.
 *
 * Next.js forbids non-async exports from a "use server" file, so the
 * sync error-message helper and role-group arrays live here instead of
 * app/actions/auth.ts.
 */

export type AppRole =
  | "owner_admin"
  | "storekeeper"
  | "production_operator"
  | "gate_operator"
  | "accountant"
  | "hr_payroll"
  | "read_only_manager";

export const FINANCE_WRITE: AppRole[] = ["owner_admin", "accountant"];
/** Stock writes: inward, transfers, adjustments, gate passes. */
export const STOCK_WRITE: AppRole[] = ["owner_admin", "storekeeper"];
/** Production writes: recipes, recipe versions, batches. */
export const PRODUCTION_WRITE: AppRole[] = ["owner_admin", "production_operator"];
/** Machinery writes: service-job drafts, posts, reversals. */
export const MACHINERY_WRITE: AppRole[] = ["owner_admin", "production_operator"];
/** Master-data writes: godowns, products, parties, machines,
 * packaging types, employees. Owner/Admin only — reference data
 * changes affect every module, so no operator role may edit it. */
export const MASTERS_WRITE: AppRole[] = ["owner_admin"];
export const FINANCE_READ_SENSITIVE: AppRole[] = ["owner_admin", "accountant"];
export const PAYROLL_WRITE: AppRole[] = ["owner_admin", "hr_payroll"];
export const PAYROLL_PAY: AppRole[] = ["owner_admin", "hr_payroll", "accountant"];
export const PAYROLL_READ: AppRole[] = [
  "owner_admin",
  "hr_payroll",
  "accountant",
];
export const OWNER_ONLY: AppRole[] = ["owner_admin"];

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown error";
}
