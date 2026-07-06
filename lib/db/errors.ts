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
 * TRUE si el error es una violación de UNIQUE (SQLSTATE 23505). El código es
 * lo único estable entre versiones/idiomas de Postgres; el texto "duplicate
 * key" queda como fallback para drivers que no propagan `code` (M5, AUDIT.md).
 */
export function isUniqueViolation(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  return error.code === "23505" || (error.message ?? "").includes("duplicate key");
}

/**
 * Mapea un error de Supabase/PostgREST a un FolioError. Detecta códigos
 * conocidos (Postgres SQLSTATE) y los traduce a códigos del dominio.
 *
 * Regla de precedencia: **SQLSTATE (`error.code`) primero, substring del
 * mensaje sólo como fallback** para drivers/versiones que no propagan `code`
 * (M5, AUDIT.md). El código es lo único estable entre versiones e idiomas de
 * Postgres; el texto del mensaje puede cambiar y no debe ser la vía principal.
 */
export function mapSupabaseError(error: { message: string; code?: string; details?: string }): FolioError {
  const msg = error.message ?? "";
  const code = error.code ?? "";

  // ─── Permisos: RLS / insufficient_privilege (SQLSTATE 42501) ──────────────
  // PostgREST reporta violaciones de RLS y de GRANT con 42501
  // (insufficient_privilege). Es un problema de PERMISO, no de sesión: mapea a
  // `forbidden`. OJO: antes esta rama vivía en el branch JWT (`code === "42501"
  // ⇒ auth_required`), lo que disfrazaba de "sesión vencida" cualquier 42501
  // que NO dijera "violates row-level security" (ej. la policy M51 que deniega
  // invitar equipo cuando la org no es CLINICA). Ahora el SQLSTATE manda; el
  // substring queda de fallback para drivers que dropean `code`.
  if (code === "42501" || msg.includes("violates row-level security")) {
    return { code: "forbidden", message: "No tenés permiso para esa acción.", detail: msg };
  }
  // ─── Auth: JWT vencido / no autenticado ───────────────────────────────────
  // PostgREST usa PGRST301 (JWT expirado/inválido) y PGRST302 (no autenticado)
  // para fallas de credenciales. `code` primero; el substring "JWT" queda de
  // fallback. Ya NO se incluye 42501 acá (ver rama de permisos arriba).
  if (code === "PGRST301" || code === "PGRST302" || msg.includes("JWT")) {
    return { code: "auth_required", message: "Volvé a iniciar sesión.", detail: msg };
  }
  // ─── Excepciones de dominio levantadas por triggers (SQLSTATE P0001) ───────
  // `RAISE EXCEPTION` sin `USING ERRCODE` cae en P0001 (raise_exception), que es
  // COMPARTIDO por todas las excepciones custom — no discrimina por sí solo.
  // Por eso, dentro de P0001, el substring del mensaje es el único discriminador
  // confiable (sesión lockeada vs transición inválida). Cuando el driver dropea
  // `code`, el substring igual matchea (fallback). El guard de P0001 evita que
  // un mensaje ajeno que casualmente contenga estas frases se malinterprete.
  if (code === "P0001" || code === "") {
    if (msg.includes("Sesión bloqueada")) {
      return { code: "locked", message: "La sesión está bloqueada. Usá una enmienda para corregir.", detail: msg };
    }
    if (msg.includes("Invalid turno transition")) {
      return { code: "transition_invalid", message: "Esa transición no está permitida.", detail: msg };
    }
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
