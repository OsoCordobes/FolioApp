/**
 * Folio · resolución server-side del profesional destino de un turno
 * (CLINICA-3, auditoría 2026-06-12 hallazgos A/B).
 *
 * Antes, createTurnoAction y aceptarPedido asignaban `profesional_id =
 * session.memberId` a ciegas: una secretaria ASISTENTE (no colegiada) que
 * creaba o aceptaba un turno quedaba como "profesional" del turno — invisible
 * para el médico real (RLS scopea su agenda por profesional_id), fuera del
 * EXCLUDE anti-solapamiento de M40 del médico, push de Google Calendar al
 * calendar equivocado y paciente nuevo con profesional_principal_id basura.
 *
 * Este módulo centraliza la regla para TODOS los caminos que asignan
 * profesional:
 *   - Si viene un profesionalId explícito (picker de la UI) → validar contra
 *     `member` (es_colegiado, activo, de la org) con el server client RLS.
 *   - Si no viene y el member de la sesión es colegiado → la sesión.
 *   - Si no viene y la sesión NO es colegiada → err("validation"): hay que
 *     elegir profesional (la UI muestra el picker).
 *
 * La decisión está separada de la I/O (`decideProfesionalDestino` es pura,
 * testeada en tests/unit/profesional-destino.test.ts).
 */

import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";

export const MSG_ELEGIR_PROFESIONAL = "Elegí qué profesional va a atender el turno.";
export const MSG_PROFESIONAL_INVALIDO =
  "El profesional elegido no es un profesional activo de tu organización.";
/** Mensajes de la cara PÚBLICA (/book): voseo, hablan con el paciente. */
export const MSG_ELEGIR_PROFESIONAL_PUBLICO =
  "Elegí con qué profesional querés atenderte.";
export const MSG_PROFESIONAL_INVALIDO_PUBLICO =
  "Ese profesional ya no está disponible. Recargá la página y elegí otro.";

export type ProfesionalDestinoDecision =
  | {
      kind: "usar";
      profesionalId: string;
      /**
       * true → hay que verificar contra `member` que sea colegiado activo de
       * la org. false → ya está garantizado (es el member de la sesión, que
       * getActiveSession leyó con deleted_at IS NULL y es_colegiado=true).
       */
      validar: boolean;
    }
  | { kind: "faltante" };

export function decideProfesionalDestino(input: {
  profesionalIdParam: string | null;
  sessionMemberId: string;
  sessionEsColegiado: boolean;
}): ProfesionalDestinoDecision {
  const { profesionalIdParam, sessionMemberId, sessionEsColegiado } = input;

  if (profesionalIdParam) {
    return {
      kind: "usar",
      profesionalId: profesionalIdParam,
      // Skip del round-trip solo cuando el param ES la sesión Y la sesión es
      // colegiada. Una sesión no colegiada que se manda a sí misma como param
      // igual se valida (y falla) en DB — sin atajo silencioso.
      validar: !(profesionalIdParam === sessionMemberId && sessionEsColegiado),
    };
  }
  if (sessionEsColegiado) {
    return { kind: "usar", profesionalId: sessionMemberId, validar: false };
  }
  return { kind: "faltante" };
}

/**
 * Resuelve y valida el profesional destino. Devuelve el member.id colegiado
 * activo al que asignar el turno, o err("validation") con mensaje accionable.
 *
 * La lectura de `member` va por el server client RLS-aware: la policy
 * `member_select_same_org` (M02) ya acota a la org del caller — el `.eq`
 * de organization_id es defensa en profundidad, no el gate real.
 */
export async function resolveProfesionalDestino(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: {
    organizationId: string;
    profesionalId?: string | null;
    sessionMemberId: string;
    sessionEsColegiado: boolean;
  },
): Promise<Result<string>> {
  const decision = decideProfesionalDestino({
    profesionalIdParam: input.profesionalId ?? null,
    sessionMemberId: input.sessionMemberId,
    sessionEsColegiado: input.sessionEsColegiado,
  });

  if (decision.kind === "faltante") {
    return err("validation", MSG_ELEGIR_PROFESIONAL);
  }
  if (!decision.validar) {
    return ok(decision.profesionalId);
  }

  const { data, error } = await supabase
    .from("member")
    .select("id")
    .eq("id", decision.profesionalId)
    .eq("organization_id", input.organizationId)
    .eq("es_colegiado", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }
  if (!data) {
    return err("validation", MSG_PROFESIONAL_INVALIDO);
  }
  return ok(decision.profesionalId);
}

// ─── Resolución PÚBLICA (booking sin sesión) ────────────────────────────────

export type ProfesionalPublicoDecision =
  | { kind: "validar"; profesionalId: string }
  | { kind: "usar"; profesionalId: string }
  | { kind: "faltante" }
  | { kind: "sin_colegiados" };

/**
 * Decisión pura del profesional destino en el flujo PÚBLICO (/book, sin
 * sesión) — testeada en tests/unit/booking-profesional-publico.test.ts.
 *
 *   - Param explícito (el paciente eligió en el wizard) → validar en DB que
 *     siga siendo colegiado activo de la org.
 *   - Sin param y exactamente 1 colegiado → ese (caso Solo: cero cambios).
 *   - Sin param y >1 → faltante: el paciente TIENE que elegir (antes el
 *     `.limit(1)` sin ORDER BY mandaba todos los bookings a uno arbitrario).
 *   - Sin colegiados → la org no puede recibir reservas web.
 *
 * `colegiadosOrdenados` debe venir ORDER BY created_at ASC (determinismo:
 * dos llamadas consecutivas resuelven el MISMO profesional).
 */
export function decideProfesionalPublico(input: {
  profesionalIdParam: string | null;
  colegiadosOrdenados: string[];
}): ProfesionalPublicoDecision {
  if (input.profesionalIdParam) {
    return { kind: "validar", profesionalId: input.profesionalIdParam };
  }
  if (input.colegiadosOrdenados.length === 0) return { kind: "sin_colegiados" };
  if (input.colegiadosOrdenados.length > 1) return { kind: "faltante" };
  return { kind: "usar", profesionalId: input.colegiadosOrdenados[0] };
}

/**
 * Resuelve el profesional destino del booking público. NO hay sesión: el
 * caller pasa el SERVICE client (RLS no aplica — por eso TODOS los filtros
 * de org acá son explícitos y obligatorios) y un organizationId que ya
 * validó contra el slug público (org viva + no deslistada).
 *
 *   - `profesionalId` presente (wizard multi-prof) → se valida contra
 *     `member` (org + es_colegiado + deleted_at IS NULL).
 *   - Ausente → default determinístico: el ÚNICO colegiado (ORDER BY
 *     created_at ASC; con >1 se exige elección explícita).
 *
 * El predicado de colegiado es EL MISMO que listProfesionalesLitePublico
 * (lib/db/members.ts) — si divergen, el wizard ofrece profesionales que el
 * server rechaza (o al revés).
 */
export async function resolveProfesionalPublico(
  service: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: {
    organizationId: string;
    profesionalId?: string | null;
  },
): Promise<Result<string>> {
  if (input.profesionalId) {
    const { data, error } = await service
      .from("member")
      .select("id")
      .eq("id", input.profesionalId)
      .eq("organization_id", input.organizationId)
      .eq("es_colegiado", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      const mapped = mapSupabaseError(error);
      return err(mapped.code, mapped.message, error.message);
    }
    if (!data) return err("validation", MSG_PROFESIONAL_INVALIDO_PUBLICO);
    return ok(input.profesionalId);
  }

  // limit(2) alcanza para distinguir 0 / 1 / "más de uno" sin traer la lista
  // entera. ORDER BY created_at: si mañana se relaja "faltante" a un default,
  // que sea determinístico — y hoy garantiza que el caso 1 colegiado sea
  // estable entre fetchSlots y submit.
  const { data, error } = await service
    .from("member")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("es_colegiado", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(2);

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  const decision = decideProfesionalPublico({
    profesionalIdParam: null,
    colegiadosOrdenados: ((data ?? []) as Array<{ id: string }>).map((m) => m.id),
  });
  if (decision.kind === "sin_colegiados") {
    return err("not_found", "Sin profesional disponible.");
  }
  if (decision.kind === "faltante") {
    return err("validation", MSG_ELEGIR_PROFESIONAL_PUBLICO);
  }
  // kind === "usar" (el caso "validar" es imposible sin param).
  return ok(decision.profesionalId);
}
