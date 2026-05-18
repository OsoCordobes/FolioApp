/**
 * Folio · queries y mutations de Pedido (booking entrante).
 */

import { z } from "zod";

import { decryptColumn, encryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

const canalSchema = z.enum(["WEB", "WHATSAPP", "INSTAGRAM", "TELEFONO"]);

const createPedidoSchema = z.object({
  canal: canalSchema,
  nombre: z.string().min(1).max(80),
  telefono: z.string().min(6).max(30).optional(),
  email: z.string().email().optional(),
  fecha_propuesta: z.string().datetime({ offset: true }).optional(),
  duracion_min: z.number().int().min(5).max(480).default(45),
  servicio_id: z.string().uuid().optional(),
  motivo: z.string().max(2000).optional(),
  precio_cents: z.number().int().min(0).optional(),
});

export type CreatePedidoInput = z.infer<typeof createPedidoSchema>;

// ─── List pedidos pendientes (para inbox) ──────────────────────────────

export async function listPedidos(estado?: string): Promise<Result<Record<string, unknown>[]>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("pedido")
    .select("*")
    .eq("organization_id", session.data.organizationId)
    .order("recibido_ts", { ascending: false });

  if (estado) query = query.eq("estado", estado);

  const { data, error } = await query;
  if (error) return err("db_error", "Error listando pedidos.", error.message);

  // Decode los cifrados
  const decoded = (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    nombre: decryptColumn(row.nombre_cifrado as Buffer | null),
    telefono: decryptColumn(row.telefono_cifrado as Buffer | null),
    email: decryptColumn(row.email_cifrado as Buffer | null),
    motivo: decryptColumn(row.motivo_cifrado as Buffer | null),
  }));
  return ok(decoded);
}

// ─── Crear pedido (desde booking público F7 o webhook WhatsApp F6) ────

export async function createPedido(input: CreatePedidoInput): Promise<Result<{ id: string }>> {
  const parsed = createPedidoSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del pedido inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const d = parsed.data;

  const { data, error } = await supabase
    .from("pedido")
    .insert({
      organization_id: session.data.organizationId,
      canal: d.canal,
      estado: "PENDIENTE",
      nombre_cifrado: encryptColumn(d.nombre)!,
      telefono_cifrado: encryptColumn(d.telefono ?? null),
      email_cifrado: encryptColumn(d.email ?? null),
      fecha_propuesta: d.fecha_propuesta ?? null,
      duracion_min: d.duracion_min,
      servicio_id: d.servicio_id ?? null,
      motivo_cifrado: encryptColumn(d.motivo ?? null),
      precio_cents: d.precio_cents ?? null,
    })
    .select("id")
    .single();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("db_error", "No se creó el pedido.");
  return ok({ id: data.id });
}

// ─── Confirmar pedido (lo transforma en Turno) ────────────────────────

export async function confirmarPedido(
  pedidoId: string,
  pacienteId: string,
  servicioId: string,
  profesionalId: string,
  inicio: string,
): Promise<Result<{ turnoId: string }>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  const { data: pedido, error: pedErr } = await supabase
    .from("pedido")
    .select("*")
    .eq("id", pedidoId)
    .eq("organization_id", session.data.organizationId)
    .maybeSingle();

  if (pedErr || !pedido) {
    return err("not_found", "Pedido no encontrado.");
  }

  // Crear turno
  const { data: turno, error: turnoErr } = await supabase
    .from("turno")
    .insert({
      organization_id: session.data.organizationId,
      paciente_id: pacienteId,
      servicio_id: servicioId,
      profesional_id: profesionalId,
      inicio,
      duracion_min: pedido.duracion_min,
      precio_cents: pedido.precio_cents ?? 0,
      origen: pedido.canal === "WEB" ? "BOOKING" : pedido.canal,
      estado: "CONFIRMADO",
    })
    .select("id")
    .single();

  if (turnoErr || !turno) {
    return err(
      mapSupabaseError(turnoErr ?? { message: "no turno" }).code,
      "No se pudo crear el turno desde el pedido.",
      turnoErr?.message,
    );
  }

  // Marcar pedido como confirmado
  await supabase
    .from("pedido")
    .update({ estado: "CONFIRMADO", confirmado_ts: new Date().toISOString(), paciente_id: pacienteId })
    .eq("id", pedidoId);

  return ok({ turnoId: turno.id });
}

// ─── Rechazar pedido ──────────────────────────────────────────────────

export async function rechazarPedido(pedidoId: string, motivo: string): Promise<Result<void>> {
  if (motivo.length < 5) return err("validation", "Motivo requerido.");
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("pedido")
    .update({ estado: "RECHAZADO", rechazado_motivo: motivo })
    .eq("id", pedidoId)
    .eq("organization_id", session.data.organizationId);

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  return ok(undefined);
}
