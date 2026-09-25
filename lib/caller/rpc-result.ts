import type { z } from "zod";

import { err, ok, type Result } from "@/lib/db/errors";

/** A committed write with an unreadable receipt must remain unresolved. */
export function parseCallerRpcResult<T>(schema: z.ZodType<T>, data: unknown, mutation: boolean): Result<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return ok(parsed.data);
  const result = err("db_error", "No pudimos confirmar la respuesta. Comprobá la misma operación antes de emitir otra.");
  if (!result.ok && mutation) result.error.mutationOutcome = "review_required";
  return result;
}
