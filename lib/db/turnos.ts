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

export async function createTurno(input: CreateTurnoInput): Promise<Result<{ id: string }>> {
  const parsed = turnoSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del turno inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
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
  void scheduleRecordatoriosForTurno({
    organizationId: session.data.organizationId,
    turnoId: data.id,
    inicio: new Date(parsed.data.inicio),
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

  // Hooks de transición de estado para la cola de recordatorios
  if (parsed.data.to === "CERRADO") {
    void schedulePostVisitaForTurno({
      organizationId: session.data.organizationId,
      turnoId: parsed.data.turnoId,
      closedAt: new Date(),
    });
  }
  if (parsed.data.to === "CANCELADO" || parsed.data.to === "REAGENDADO") {
    void cancelRecordatoriosForTurno(parsed.data.turnoId);
  }

  return ok(undefined);
}

// ─── Walk-in: crea paciente (si nuevo) + turno EN_SALA ─────────────────
// Implementación en lib/db/walk-in.ts (necesita cifrado de PII, más involved).
