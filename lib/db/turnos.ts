/**
 * Folio · queries y mutations de Turno.
 *
 * Usa la vista `turno_extendido` (M14) que ya hace el JOIN con paciente,
 * servicio y pago — minimiza round-trips.
 *
 * RLS se aplica automáticamente (la vista hereda con security_invoker=true).
 */

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import {
  cancelRecordatoriosForTurno,
  schedulePostVisitaForTurno,
  scheduleRecordatoriosForTurno,
} from "./recordatorios";
import { getActiveSession } from "./session";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const turnoSchema = z.object({
  paciente_id: z.string().uuid(),
  servicio_id: z.string().uuid(),
  profesional_id: z.string().uuid(),
  inicio: z.string().datetime({ offset: true }),
  duracion_min: z.number().int().min(5).max(480),
  precio_cents: z.number().int().min(0),
  origen: z.enum(["MANUAL", "BOOKING", "WALK_IN", "GOOGLE", "WHATSAPP"]).default("MANUAL"),
});

const transitionSchema = z.object({
  turnoId: z.string().uuid(),
  to: z.enum([
    "AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO",
    "CERRADO", "NO_ASISTIO", "CANCELADO", "REAGENDADO",
  ]),
  duracionRealMin: z.number().int().min(0).max(480).optional(),
});

export type CreateTurnoInput = z.infer<typeof turnoSchema>;

// ─── Overlap / double-booking check ─────────────────────────────────────
//
// CR-5 / CR-6: las paths internas (aceptar pedido + crear turno manual) no
// chequeaban solapamiento. El booking público sí (ver app/(public)/book/
// [slug]/actions.ts). Centralizamos acá la misma lógica para reusarla.
//
// `slotRangesOverlap` es una función pura (testeable sin DB): dos rangos
// [aInicio, aFin) y [bInicio, bFin) se solapan si aInicio < bFin && bInicio < aFin.

export function slotRangesOverlap(
  aInicioMs: number,
  aFinMs: number,
  bInicioMs: number,
  bFinMs: number,
): boolean {
  return aInicioMs < bFinMs && bInicioMs < aFinMs;
}

interface SlotConflictRow {
  inicio?: string;
  fecha_propuesta?: string;
  duracion_min: number;
}

/**
 * `decideSlotOcupado` — función pura que decide si un slot está ocupado a
 * partir de las filas candidatas (turnos, pedidos y bloqueos) que se
 * solapan con el rango [inicio, fin). Aislada para poder testearla sin DB.
 */
export function decideSlotOcupado(
  inicioMs: number,
  finMs: number,
  candidatos: {
    turnos: SlotConflictRow[] | null;
    pedidos: SlotConflictRow[] | null;
    bloqueos: SlotConflictRow[] | null;
  },
): boolean {
  const overlapsWith = (rows: SlotConflictRow[] | null, field: "inicio" | "fecha_propuesta") =>
    (rows ?? []).some((r) => {
      const startMs = new Date(r[field]!).getTime();
      const endMs = startMs + r.duracion_min * 60_000;
      return slotRangesOverlap(inicioMs, finMs, startMs, endMs);
    });

  return (
    overlapsWith(candidatos.turnos, "inicio") ||
    overlapsWith(candidatos.pedidos, "fecha_propuesta") ||
    overlapsWith(candidatos.bloqueos, "inicio")
  );
}

/**
 * Chequea si un slot [inicio, inicio+duracionMin) ya está ocupado para la
 * org. Mismo enfoque que el booking público: intenta el RPC `slot_ocupado`
 * y, si no existe / falla, cae al chequeo manual contra turno + pedido +
 * bloqueo. Excluye opcionalmente un turno (para reagendas, no usado todavía).
 *
 * NB: el RPC `slot_ocupado` no está definido en migraciones todavía, así que
 * en la práctica corre siempre el fallback manual (igual que en el booking
 * público). Lo dejamos primero para cuando exista una garantía dura en SQL.
 */
export async function checkSlotOcupado(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  inicioIso: string,
  duracionMin: number,
  profesionalId: string,
): Promise<boolean> {
  const inicioDate = new Date(inicioIso);
  const finDate = new Date(inicioDate.getTime() + duracionMin * 60_000);

  const overlap = await supabase.rpc("slot_ocupado", {
    p_org: organizationId,
    p_inicio: inicioDate.toISOString(),
    p_fin: finDate.toISOString(),
  });

  if (!(overlap.error || overlap.data === null)) {
    return overlap.data === true;
  }

  // Fallback manual (mismo patrón que createPedidoPublico). Ventana de -8h
  // para capturar turnos largos que arrancan antes pero todavía solapan
  // (la duración máxima de un turno es 480min = 8h).
  const finIso = finDate.toISOString();
  const lookbackIso = new Date(inicioDate.getTime() - 8 * 60 * 60_000).toISOString();

  const [{ data: turnoConflict }, { data: pedidoConflict }, { data: bloqueoConflict }] =
    await Promise.all([
      supabase
        .from("turno")
        .select("id, inicio, duracion_min")
        .eq("organization_id", organizationId)
        // M-A: M40 (EXCLUDE constraint) keyea por profesional_id; alineamos el
        // pre-check de la app al mismo scope per-professional.
        .eq("profesional_id", profesionalId)
        .in("estado", ["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO"])
        .is("deleted_at", null)
        .lt("inicio", finIso)
        .gte("inicio", lookbackIso)
        .limit(20),
      // Los chequeos de pedido/bloqueo siguen org-scoped: son pre-checks
      // app-only (no los respalda el EXCLUDE de M40, que solo cubre `turno`).
      supabase
        .from("pedido")
        .select("id, fecha_propuesta, duracion_min")
        .eq("organization_id", organizationId)
        .eq("estado", "PENDIENTE")
        .not("fecha_propuesta", "is", null)
        .gte("fecha_propuesta", lookbackIso)
        .lt("fecha_propuesta", finIso)
        .limit(20),
      supabase
        .from("bloqueo")
        .select("id, inicio, duracion_min")
        .eq("organization_id", organizationId)
        .gte("inicio", lookbackIso)
        .lt("inicio", finIso)
        .limit(20),
    ]);

  return decideSlotOcupado(inicioDate.getTime(), finDate.getTime(), {
    turnos: turnoConflict as SlotConflictRow[] | null,
    pedidos: pedidoConflict as SlotConflictRow[] | null,
    bloqueos: bloqueoConflict as SlotConflictRow[] | null,
  });
}

// ─── Listar turnos del día / rango ──────────────────────────────────────

export async function listTurnosDelDia(fecha: string): Promise<Result<unknown[]>> {
  if (!ISO_DATE.test(fecha)) {
    return err("validation", "Fecha inválida (formato YYYY-MM-DD).");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("turno_extendido")
    .select("*")
    .eq("organization_id", session.data.organizationId)
    .gte("inicio", `${fecha}T00:00:00`)
    .lt("inicio", `${fecha}T23:59:59`)
    .order("inicio");

  if (error) return err("db_error", "Error listando turnos.", error.message);
  return ok(data ?? []);
}

export async function listTurnosSemana(fechaDesde: string, fechaHasta: string): Promise<Result<unknown[]>> {
  if (!ISO_DATE.test(fechaDesde) || !ISO_DATE.test(fechaHasta)) {
    return err("validation", "Fechas inválidas.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("turno_extendido")
    .select("*")
    .eq("organization_id", session.data.organizationId)
    .gte("inicio", `${fechaDesde}T00:00:00`)
    .lt("inicio", `${fechaHasta}T23:59:59`)
    .order("inicio");

  if (error) return err("db_error", "Error listando turnos.", error.message);
  return ok(data ?? []);
}

// ─── Crear turno ────────────────────────────────────────────────────────

export async function createTurno(
  input: CreateTurnoInput,
): Promise<Result<{ id: string }>> {
  const parsed = turnoSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del turno inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // CR-6: chequeo de doble-reserva (siempre corre; sin bypass).
  const ocupado = await checkSlotOcupado(
    supabase,
    session.data.organizationId,
    parsed.data.inicio,
    parsed.data.duracion_min,
    parsed.data.profesional_id,
  );
  if (ocupado) {
    return err("conflict", "Ese horario ya está ocupado.");
  }

  const { data, error } = await supabase
    .from("turno")
    .insert({
      ...parsed.data,
      organization_id: session.data.organizationId,
      estado: "AGENDADO",
    })
    .select("id")
    .single();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("db_error", "No se creó el turno.");

  // Programar recordatorios 24h y 2h (idempotente vía UNIQUE turno_id,tipo).
  // Si el insert de recordatorios falla no rollbackeamos el turno — el dispatcher
  // reintentará via /api/cron y/o el user puede re-programarlos desde la UI.
  // Fire-and-forget pero capturando errores en Sentry (auditoría MEDIUM-
  // observabilidad: el patrón `void promise` silenciaba fallos previamente).
  scheduleRecordatoriosForTurno({
    organizationId: session.data.organizationId,
    turnoId: data.id,
    inicio: new Date(parsed.data.inicio),
  }).catch(async (err) => {
    const { captureException } = await import("@sentry/nextjs");
    captureException(err, {
      tags: { component: "turno-create", op: "scheduleRecordatorios" },
      extra: { turnoId: data.id, organizationId: session.data.organizationId },
    });
  });

  return ok({ id: data.id });
}

// ─── State machine: transicionar turno ─────────────────────────────────

export async function transitionTurno(input: z.infer<typeof transitionSchema>): Promise<Result<void>> {
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de transición inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // Construir patch según destino
  const patch: Record<string, unknown> = { estado: parsed.data.to };
  if (parsed.data.to === "ATENDIENDO") {
    patch.atendiendo_desde = new Date().toISOString();
  }
  if (parsed.data.to === "CERRADO" && parsed.data.duracionRealMin != null) {
    patch.duracion_real_min = parsed.data.duracionRealMin;
  }

  const { error } = await supabase
    .from("turno")
    .update(patch)
    .eq("id", parsed.data.turnoId)
    .eq("organization_id", session.data.organizationId);

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  // Hooks de transición de estado para la cola de recordatorios.
  // Fire-and-forget con captura Sentry (mismo razonamiento que createTurno).
  if (parsed.data.to === "CERRADO") {
    schedulePostVisitaForTurno({
      organizationId: session.data.organizationId,
      turnoId: parsed.data.turnoId,
      closedAt: new Date(),
    }).catch(async (err) => {
      const { captureException } = await import("@sentry/nextjs");
      captureException(err, {
        tags: { component: "turno-transition", op: "schedulePostVisita" },
        extra: { turnoId: parsed.data.turnoId },
      });
    });
  }
  if (parsed.data.to === "CANCELADO" || parsed.data.to === "REAGENDADO") {
    cancelRecordatoriosForTurno(parsed.data.turnoId).catch(async (err) => {
      const { captureException } = await import("@sentry/nextjs");
      captureException(err, {
        tags: { component: "turno-transition", op: "cancelRecordatorios" },
        extra: { turnoId: parsed.data.turnoId, newEstado: parsed.data.to },
      });
    });
  }

  return ok(undefined);
}

// ─── Walk-in: crea paciente (si nuevo) + turno EN_SALA ─────────────────
// Implementación en lib/db/walk-in.ts (necesita cifrado de PII, más involved).
