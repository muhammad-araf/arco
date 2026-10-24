/**
 * Plain (non-"use server") helpers shared by the server actions.
 *
 * Next.js forbids non-async exports from a "use server" file, so the
 * sync error-message helper lives here instead of app/actions/auth.ts.
 * Behaviour is unchanged: it is the same function, only moved.
 */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown error";
}
