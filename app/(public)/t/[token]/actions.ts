"use server";

/**
 * Folio · Server Action de la confirmación 1-click (F7b · M90).
 *
 * Corre SIN sesión (el paciente clickea desde su email). El GET de la página
 * NUNCA muta — solo muestra el botón (los clientes de correo prefetchean GETs
 * a ciegas; Google/Outlook no ejecutan POST). La mutación vive acá, detrás
 * del submit explícito del paciente.
 *
 * Defense-in-depth:
 *   - Token HMAC stateless verificado de nuevo (la action es un endpoint
 *     público en sí misma — no confía en que el GET la haya "habilitado").
 *   - Rate limit por IP (fail-open según la matriz de lib/security/rate-limit).
 *   - Decisión pura (decideResultadoConfirmacion) + CAS guardado por estado:
 *     el guard por `CONFIRM_CAS_FROM[accion]` hace el replay inocuo (0 filas si
 *     otro click/staff ya movió el estado) y el trigger M09 es el backstop
 *     transaccional.
 *   - service client (RLS no aplica sin sesión) tocando SOLO las columnas
 *     estado/confirmado_via de UN turno cuyo id viene firmado.
 *
 * La mutación va por el RPC `turno_transicion_paciente` (M91) en vez de un
 * UPDATE directo: necesita correr en la MISMA transacción que el
 * set_config('folio.transition_origin','paciente') para que el log de
 * `transicion` audite al paciente y no al consultorio. PostgREST abre una
 * transacción por statement, así que un set_config suelto no llegaría al
 * trigger.
 *
 * Al cancelar, se disparan los mismos side-effects post-respuesta que la
 * transición de staff (transitionTurno): borrar recordatorios pendientes y
 * cancelar el evento de Google Calendar. Sin PHI en logs.
 */

import { headers } from "next/headers";

import { runAfterResponse } from "@/lib/after-response";
import {
  CONFIRM_CAS_FROM,
  decideResultadoConfirmacion,
  type ResultadoConfirmacion,
} from "@/lib/booking/confirm-decision";
import { verifyConfirmToken } from "@/lib/booking/confirm-token";
import { cancelRecordatoriosForTurno } from "@/lib/db/recordatorios";
import { cancelTurnoEnGoogle } from "@/lib/google/sync";
import { limitByIp } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type ResultadoAccion1Click =
  | Exclude<ResultadoConfirmacion, "ejecutar">
  | "confirmado"
  | "cancelado"
  | "link_vencido"
  | "link_invalido"
  | "rate_limited"
  | "error";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

interface TurnoRow {
  id: string;
  inicio: string;
  estado: string;
  organization_id: string;
  profesional_id: string | null;
}

export async function ejecutarConfirmacion1Click(
  token: string,
): Promise<{ resultado: ResultadoAccion1Click }> {
  // Rate limit por IP, más estricto que el del GET (esto muta).
  const ip = await clientIp();
  const rl = await limitByIp("confirm-turno.exec", ip, 30);
  if (!rl.ok) return { resultado: "rate_limited" };

  const v = verifyConfirmToken(token);
  if (!v.ok) {
    // exp = inicio del turno → un token vencido significa que el turno ya
    // pasó/está empezando (cubre la carrera render→click).
    return { resultado: v.reason === "expirado" ? "link_vencido" : "link_invalido" };
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("turno")
    .select("id, inicio, estado, organization_id, profesional_id")
    .eq("id", v.turnoId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error(`[confirm-1click] turno fetch falló: ${error.message}`);
    return { resultado: "error" };
  }
  if (!data) return { resultado: "link_invalido" };
  const turno = data as TurnoRow;

  const nowMs = Date.now();
  const decision = decideResultadoConfirmacion({
    accion: v.accion,
    estado: turno.estado,
    inicioMs: new Date(turno.inicio).getTime(),
    nowMs,
  });
  if (decision !== "ejecutar") return { resultado: decision };

  // CAS guardado por estado: idempotente ante replay/doble click. El trigger
  // turno_record_transition (M09) valida la arista y registra la transición.
  //
  // M91 · el CAS vive DENTRO del RPC (`where id = … and deleted_at is null and
  // estado = any(p_from)`), no en query builders acá: el set_config del origen
  // y el UPDATE tienen que compartir transacción. El re-filtro de `deleted_at`
  // sigue siendo obligatorio —el SECURITY DEFINER bypassea RLS igual que el
  // service client— para que un soft-delete entre el fetch y el UPDATE no
  // "resucite" el turno; ver el cuerpo de la función en M91.
  const { data: casRows, error: casErr } = await service.rpc("turno_transicion_paciente", {
    p_turno_id: turno.id,
    p_to: v.accion === "confirmar" ? "CONFIRMADO" : "CANCELADO",
    p_from: CONFIRM_CAS_FROM[v.accion] as string[],
  });

  // `returns setof uuid` → PostgREST devuelve un array de ids (vacío si el CAS
  // se perdió). Mismo contrato que el `.select("id")` del UPDATE anterior.
  if (casErr || !Array.isArray(casRows) || casRows.length === 0) {
    // Carrera (otro click / staff movió el estado) o rechazo del trigger:
    // re-leer y re-decidir para responder la verdad actual.
    if (casErr) console.warn(`[confirm-1click] CAS rechazado: ${casErr.message}`);
    const { data: fresh } = await service
      .from("turno")
      .select("estado, inicio")
      .eq("id", turno.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!fresh) return { resultado: "link_invalido" };
    const redecision = decideResultadoConfirmacion({
      accion: v.accion,
      estado: fresh.estado as string,
      inicioMs: new Date(fresh.inicio as string).getTime(),
      nowMs: Date.now(),
    });
    return { resultado: redecision === "ejecutar" ? "error" : redecision };
  }

  if (v.accion === "cancelar") {
    // Side-effects espejo de transitionTurno(→CANCELADO): recordatorios
    // pendientes fuera + evento de Google Calendar cancelado. Post-respuesta,
    // fail-safe (Sentry DENTRO del callback), nunca cambian el resultado.
    const turnoId = turno.id;
    const organizationId = turno.organization_id;
    const profesionalMemberId = turno.profesional_id;
    runAfterResponse(() =>
      cancelRecordatoriosForTurno(turnoId).catch(async (err) => {
        const { captureException } = await import("@sentry/nextjs");
        captureException(err, {
          tags: { component: "confirm-1click", op: "cancelRecordatorios" },
          extra: { turnoId },
        });
      }),
    );
    if (profesionalMemberId) {
      runAfterResponse(() =>
        cancelTurnoEnGoogle({
          client: service,
          turnoId,
          organizationId,
          profesionalMemberId,
        }).catch(async (err) => {
          const { captureException } = await import("@sentry/nextjs");
          captureException(err, {
            tags: { component: "confirm-1click", op: "cancelTurnoEnGoogle" },
            extra: { turnoId },
          });
        }),
      );
    }
  }

  return { resultado: v.accion === "confirmar" ? "confirmado" : "cancelado" };
}
