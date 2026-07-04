"use server";

/**
 * Folio · Server Actions de /calendario.
 *
 * Acciones de inbox de pedidos: aceptar (crea paciente + turno), aceptar con
 * OTRO horario (pedidos sin fecha propuesta o con horario ocupado) y rechazar
 * (marca el pedido como RECHAZADO con motivo).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  aceptarPedido,
  aceptarPedidoConHorario,
  rechazarPedido,
} from "@/lib/db/pedidos";
import { err, ok, type Result } from "@/lib/db/errors";
import { getActiveSession } from "@/lib/db/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function aceptarPedidoAction(
  pedidoId: string,
  /**
   * Profesional destino elegido en el picker del PedidoModal (CLINICA-3).
   * Solo aplica cuando el pedido no trae profesional_id propio; se valida
   * server-side como colegiado activo de la org en aceptarPedido.
   */
  profesionalId?: string,
): Promise<Result<{ turnoId: string; pacienteId: string }>> {
  const result = await aceptarPedido(pedidoId, { profesionalId: profesionalId ?? null });
  if (result.ok) {
    revalidatePath("/calendario");
    revalidatePath("/hoy");
  }
  return result;
}

// ─── Aceptar con otro horario ────────────────────────────────────────────────

const aceptarConHorarioActionSchema = z.object({
  fechaHora: z.string().datetime({ offset: true }),
  servicioId: z.string().uuid().optional(),
  profesionalId: z.string().uuid().optional(),
});

export type AceptarPedidoConHorarioActionInput = z.infer<typeof aceptarConHorarioActionSchema>;

/**
 * Acepta un pedido en un horario ELEGIDO (no el propuesto): pedidos de
 * WhatsApp/teléfono sin fecha, sin servicio, o cuyo horario propuesto se
 * ocupó. Mismo guard que aceptarPedidoAction: la sesión/rol/org se validan
 * en lib/db (getActiveSession + RLS); el profesional/servicio se re-validan
 * server-side contra la org.
 */
export async function aceptarPedidoConHorarioAction(
  pedidoId: string,
  input: AceptarPedidoConHorarioActionInput,
): Promise<Result<{ turnoId: string; pacienteId: string }>> {
  const parsed = aceptarConHorarioActionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del horario inválidos.", parsed.error.message);
  }
  const result = await aceptarPedidoConHorario(pedidoId, parsed.data);
  if (result.ok) {
    revalidatePath("/calendario");
    revalidatePath("/hoy");
  }
  return result;
}

// ─── Servicios activos (picker del PedidoModal) ─────────────────────────────

export interface ServicioPedidoPickerRow {
  id: string;
  nombre: string;
  duracionMin: number;
}

/**
 * Servicios activos de la org para el picker de "aceptar con otro horario"
 * (los pedidos de WhatsApp llegan sin servicio_id). Guard idéntico a los
 * vecinos: sesión activa + scope de org (RLS + eq explícito). Solo campos de
 * display — el server re-valida el servicio elegido en aceptarPedidoConHorario.
 */
export async function listServiciosActivosAction(): Promise<Result<ServicioPedidoPickerRow[]>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("servicio")
    .select("id, nombre, duracion_min")
    .eq("organization_id", session.data.organizationId)
    .eq("activo", true)
    .is("deleted_at", null)
    .order("nombre");
  if (error) return err("db_error", "Error listando servicios.", error.message);

  return ok(
    (data ?? []).map((s) => ({
      id: s.id as string,
      nombre: s.nombre as string,
      duracionMin: s.duracion_min as number,
    })),
  );
}

export async function rechazarPedidoAction(
  pedidoId: string,
  motivo: string,
): Promise<Result<void>> {
  const result = await rechazarPedido(pedidoId, motivo);
  if (result.ok) {
    revalidatePath("/calendario");
  }
  return result;
}
