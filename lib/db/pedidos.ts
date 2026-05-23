/**
 * Folio · queries y mutations de Pedido (booking entrante).
 */

import { z } from "zod";

import { blindIndex, blindIndexPhone, decryptColumn, encryptColumn } from "@/lib/crypto";
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

// ─── Aceptar pedido (crea paciente si hace falta + crea turno) ────────
//
// Wrapper de alto nivel que cubre el caso normal de la bandeja de pedidos:
// el profesional clickea "Aceptar" en un pedido pendiente y Folio:
//   1. Resuelve el paciente (existente vía pedido.paciente_id, o nuevo
//      creado on-the-fly desde los datos del pedido).
//   2. Inserta un turno en estado CONFIRMADO con la fecha_propuesta del
//      pedido y el servicio_id que viene del flujo público.
//   3. Marca el pedido como CONFIRMADO con el paciente_id resuelto.
//
// Requiere `fecha_propuesta` y `servicio_id` en el pedido (siempre los
// trae el flujo /book/<slug>). Para pedidos sin estructura (WhatsApp /
// teléfono sin hora) este action falla; ese caso entra por P0 #4 (crear
// turno manual).

interface PedidoConfirmRow {
  id: string;
  organization_id: string;
  paciente_id: string | null;
  servicio_id: string | null;
  fecha_propuesta: string | null;
  duracion_min: number;
  precio_cents: number | null;
  canal: string;
  estado: string;
  nombre_cifrado: Buffer | null;
  telefono_cifrado: Buffer | null;
  email_cifrado: Buffer | null;
  motivo_cifrado: Buffer | null;
}

export async function aceptarPedido(
  pedidoId: string,
): Promise<Result<{ turnoId: string; pacienteId: string }>> {
  if (!z.string().uuid().safeParse(pedidoId).success) {
    return err("validation", "ID de pedido inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  const { data: pedidoRaw, error: pedErr } = await supabase
    .from("pedido")
    .select(
      "id, organization_id, paciente_id, servicio_id, fecha_propuesta, duracion_min, precio_cents, canal, estado, nombre_cifrado, telefono_cifrado, email_cifrado, motivo_cifrado",
    )
    .eq("id", pedidoId)
    .eq("organization_id", session.data.organizationId)
    .maybeSingle<PedidoConfirmRow>();

  if (pedErr) return err(mapSupabaseError(pedErr).code, mapSupabaseError(pedErr).message, pedErr.message);
  if (!pedidoRaw) return err("not_found", "Pedido no encontrado.");
  if (pedidoRaw.estado !== "PENDIENTE") {
    return err("validation", `El pedido ya está en estado ${pedidoRaw.estado.toLowerCase()}.`);
  }
  if (!pedidoRaw.fecha_propuesta) {
    return err(
      "validation",
      "Este pedido no tiene fecha propuesta. Creá un turno manual y enlazá el pedido después.",
    );
  }
  if (!pedidoRaw.servicio_id) {
    return err(
      "validation",
      "Este pedido no tiene servicio. Creá un turno manual desde /calendario.",
    );
  }

  // 1. Resolver paciente. Si pedido.paciente_id existe → usar ese.
  //    Sino, crear desde los datos cifrados del pedido (nombre + telefono +
  //    email opcional + motivo).
  let pacienteId: string;
  if (pedidoRaw.paciente_id) {
    pacienteId = pedidoRaw.paciente_id;
  } else {
    const nombre = decryptColumn(pedidoRaw.nombre_cifrado) ?? "Sin nombre";
    const telefono = decryptColumn(pedidoRaw.telefono_cifrado) ?? "";
    const email = decryptColumn(pedidoRaw.email_cifrado);
    const motivo = decryptColumn(pedidoRaw.motivo_cifrado);

    if (telefono.length < 6) {
      return err("validation", "El pedido no tiene teléfono válido para crear el paciente.");
    }

    // Split nombre completo a primer / resto. Ordering libre.
    const partes = nombre.trim().split(/\s+/);
    const primerNombre = partes[0] || "Sin nombre";
    const apellido = partes.slice(1).join(" ") || "—";
    const nombreFull = `${primerNombre} ${apellido}`;

    const { data: identidad, error: idErr } = await supabase
      .from("paciente_identidad")
      .insert({
        organization_id: session.data.organizationId,
        nombre_cifrado: encryptColumn(primerNombre)!,
        apellido_cifrado: encryptColumn(apellido)!,
        tipo_doc: "DNI",
        telefono_cifrado: encryptColumn(telefono)!,
        email_cifrado: encryptColumn(email ?? null),
        nombre_hash: blindIndex(nombreFull),
        telefono_hash: blindIndexPhone(telefono),     // M30 dedup partial UNIQUE
      })
      .select("id")
      .single();

    if (idErr || !identidad) {
      const mapped = idErr ? mapSupabaseError(idErr) : { code: "db_error" as const, message: "No se creó la identidad." };
      return err(mapped.code, mapped.message, idErr?.message);
    }

    const { data: paciente, error: pacErr } = await supabase
      .from("paciente")
      .insert({
        organization_id: session.data.organizationId,
        identidad_id: identidad.id,
        motivo_consulta_cifrado: encryptColumn(motivo ?? null),
        tags: [],
        profesional_principal_id: session.data.memberId,
      })
      .select("id")
      .single();

    if (pacErr || !paciente) {
      // Rollback identidad
      await supabase.from("paciente_identidad").delete().eq("id", identidad.id);
      const mapped = pacErr ? mapSupabaseError(pacErr) : { code: "db_error" as const, message: "No se creó el paciente." };
      return err(mapped.code, mapped.message, pacErr?.message);
    }
    pacienteId = paciente.id;
  }

  // 2. Crear turno en CONFIRMADO con fecha_propuesta + servicio del pedido.
  const { data: turno, error: turnoErr } = await supabase
    .from("turno")
    .insert({
      organization_id: session.data.organizationId,
      paciente_id: pacienteId,
      servicio_id: pedidoRaw.servicio_id,
      profesional_id: session.data.memberId,
      inicio: pedidoRaw.fecha_propuesta,
      duracion_min: pedidoRaw.duracion_min,
      precio_cents: pedidoRaw.precio_cents ?? 0,
      origen: pedidoRaw.canal === "WEB" ? "BOOKING" : pedidoRaw.canal,
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

  // 3. Marcar pedido CONFIRMADO + linkear paciente resuelto.
  await supabase
    .from("pedido")
    .update({
      estado: "CONFIRMADO",
      confirmado_ts: new Date().toISOString(),
      paciente_id: pacienteId,
    })
    .eq("id", pedidoId);

  return ok({ turnoId: turno.id, pacienteId });
}
