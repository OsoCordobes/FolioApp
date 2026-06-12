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
