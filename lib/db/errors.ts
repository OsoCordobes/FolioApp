/**
 * Folio · errores tipados del data layer.
 *
 * Todas las funciones de `lib/db/*.ts` y Server Actions retornan
 * `{ ok: true, data } | { ok: false, error: FolioError }` para que la
 * UI pueda discriminar sin exception handling explícito.
 */

export type FolioErrorCode =
  | "auth_required"          // no hay sesión Supabase
  | "no_org"                 // user no es member de ninguna org
  | "forbidden"              // RLS bloqueó (rol insuficiente / caja fuerte / etc.)
  | "not_found"              // recurso no existe o RLS no lo deja ver
  | "validation"             // input no pasó Zod
  | "conflict"               // constraint violation (DNI duplicado, etc.)
  | "transition_invalid"     // state machine de turno rechazó
  | "locked"                 // sesion lockeada, usar enmienda
  | "db_error"               // todo lo demás de Postgres
  | "network";               // request al servidor falló

export interface FolioError {
  code: FolioErrorCode;
  message: string;           // mensaje user-facing en español
  detail?: string;           // técnico, para logs
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: FolioError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const err = (code: FolioErrorCode, message: string, detail?: string): Result<never> => ({
  ok: false,
  error: { code, message, detail },
});

/**
 * Mapea un error de Supabase/PostgREST a un FolioError. Detecta códigos
 * conocidos (Postgres SQLSTATE) y los traduce a códigos del dominio.
 */
export function mapSupabaseError(error: { message: string; code?: string; details?: string }): FolioError {
  const msg = error.message ?? "";
  const code = error.code ?? "";

  // RLS primero: PostgREST reporta las violaciones de RLS con SQLSTATE 42501
  // (insufficient_privilege) — si chequeáramos 42501 antes, un problema de
  // permisos se disfrazaría de sesión vencida ("Volvé a iniciar sesión").
  if (msg.includes("violates row-level security")) {
    return { code: "forbidden", message: "No tenés permiso para esa acción.", detail: msg };
  }
  if (msg.includes("JWT") || code === "42501") {
    return { code: "auth_required", message: "Volvé a iniciar sesión.", detail: msg };
  }
  if (msg.includes("Sesión bloqueada")) {
    return { code: "locked", message: "La sesión está bloqueada. Usá una enmienda para corregir.", detail: msg };
  }
  if (msg.includes("Invalid turno transition")) {
    return { code: "transition_invalid", message: "Esa transición no está permitida.", detail: msg };
  }
  if (code === "23505") {
    // M30: violaciones específicas de partial UNIQUE de paciente.
    const detail = `${error.details ?? ""} ${msg}`;
    if (detail.includes("paciente_identidad_dni_unique_active")) {
      return {
        code: "conflict",
        message: "Ya existe un paciente con ese DNI en tu organización.",
        detail: msg,
      };
    }
    if (detail.includes("paciente_identidad_telefono_unique_active")) {
      return {
        code: "conflict",
        message: "Ya existe un paciente con ese teléfono en tu organización.",
        detail: msg,
      };
    }
    return { code: "conflict", message: "Ya existe un registro con esos datos.", detail: msg };
  }
  if (code === "23503") {
    return { code: "conflict", message: "No se puede borrar: hay datos relacionados.", detail: msg };
  }
  if (code === "23P01") {
    // exclusion_violation: M40 EXCLUDE constraint (turno por profesional/horario).
    // Cubre el hit de doble-reserva tanto en createTurno como en el CAS de
    // aceptar pedido.
    return { code: "conflict", message: "Ese profesional ya tiene un turno en ese horario.", detail: msg };
  }
  if (code === "PGRST116" || msg.includes("no rows")) {
    return { code: "not_found", message: "No se encontró el recurso.", detail: msg };
  }
  return { code: "db_error", message: "Error en la base de datos.", detail: msg };
}
