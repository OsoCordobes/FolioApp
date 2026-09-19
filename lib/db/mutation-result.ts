import type { FolioError, FolioErrorCode } from "./errors";

export type MutationOutcome = NonNullable<FolioError["mutationOutcome"]>;
export type MutationResult<T> = { ok: true; data: T } | { ok: false; error: FolioError & { mutationOutcome: MutationOutcome } };
export function mutationFailure(code: FolioErrorCode, message: string, mutationOutcome: MutationOutcome): MutationResult<never> {
  return { ok: false, error: { code, message, mutationOutcome } };
}
export function uncertainMutation(): MutationResult<never> {
  return mutationFailure("network", "No pudimos confirmar la respuesta. Revisá el estado antes de intentar otra operación.", "uncertain");
}
/** SQLSTATE only: message text cannot prove rollback or authorization. */
export function mutationRpcError(error: { code?: string }): MutationResult<never> {
  if (["PGRST202", "42883"].includes(error.code ?? "")) return mutationFailure("db_error", "La función de cierre o cobro todavía no está disponible. Pedí que se complete la actualización antes de continuar.", "review_required");
  if (error.code === "55000") return mutationFailure("conflict", "Revisá el estado actual del turno antes de continuar.", "review_required");
  if (error.code === "42501") return mutationFailure("forbidden", "No tenés permiso para esa acción.", "rejected");
  if (["PGRST301", "PGRST302"].includes(error.code ?? "")) return mutationFailure("auth_required", "Volvé a iniciar sesión.", "rejected");
  if (["22023", "22P02", "23514"].includes(error.code ?? "")) return mutationFailure("validation", "Los datos de la operación no son válidos.", "rejected");
  if (["40001", "40P01", "23505", "23503", "23P01"].includes(error.code ?? "")) return mutationFailure("conflict", "La operación fue rechazada. Revisá el estado actual.", "rejected");
  if (["P0001", "57014", "55P03"].includes(error.code ?? "")) return mutationFailure("db_error", "No se pudo completar la operación.", "rejected");
  return uncertainMutation();
}
