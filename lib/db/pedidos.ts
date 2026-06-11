/**
 * Folio · queries y mutations de Pedido (booking entrante).
 */

import { z } from "zod";

import { blindIndex, blindIndexPhone, decryptColumn, encryptColumn, tryDecrypt } from "@/lib/crypto";
import { notifyBookingConfirmada } from "@/lib/email/notify";
import { pushTurnoToGoogle } from "@/lib/google/sync";
import { trackEvent } from "@/lib/observability/events";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { scheduleRecordatoriosForTurno } from "./recordatorios";
import { getActiveSession } from "./session";
import { checkSlotOcupado } from "./turnos";

/**
 * CR-7 — decisión pura del compare-and-swap del estado del pedido.
 *
 * El CAS se hace con un UPDATE guardado (`.eq('estado','PENDIENTE')`) que
 * devuelve las filas afectadas. Esta función traduce ese resultado a una
 * decisión testeable sin DB:
 *   - error de DB           → "db_error"
 *   - 0 filas               → "conflict" (otro acepte ganó la carrera)
 *   - exactamente 1 fila    → "ok"
 *   - >1 fila               → "ok" (no debería pasar; el id es PK único)
 */
export function decidePedidoCas(
  rowsAffected: number,
  hadError: boolean,
): "ok" | "conflict" | "db_error" {
  if (hadError) return "db_error";
  if (rowsAffected < 1) return "conflict";
  return "ok";
}

/**
 * Helper compartido: programa los recordatorios 24h/2h de un turno recién
 * creado desde un pedido aceptado/confirmado (H-APP-1). Fire-and-forget con
 * captura en Sentry, mismo patrón que createTurno (turnos.ts:116).
 */
function scheduleRecordatoriosFireAndForget(
  organizationId: string,
  turnoId: string,
  inicioIso: string,
): void {
  scheduleRecordatoriosForTurno({
    organizationId,
    turnoId,
    inicio: new Date(inicioIso),
  }).catch(async (e) => {
    const { captureException } = await import("@sentry/nextjs");
    captureException(e, {
      tags: { component: "pedido-accept", op: "scheduleRecordatorios" },
      extra: { turnoId, organizationId },
    });
  });
}

/**
 * B1 — mapeo explícito canal_pedido → origen_turno.
 *
 * `canal_pedido` (WEB, WHATSAPP, INSTAGRAM, TELEFONO) y `origen_turno`
 * (MANUAL, BOOKING, WALK_IN, GOOGLE, WHATSAPP) son enums DISTINTOS. El código
 * viejo hacía `canal === 'WEB' ? 'BOOKING' : canal`, que para INSTAGRAM/TELEFONO
 * produce un valor que NO existe en origen_turno → el INSERT del turno revienta.
 * Este mapa traduce cada canal a un origen válido.
 */
export const CANAL_TO_ORIGEN: Record<string, string> = {
  WEB: "BOOKING",
  WHATSAPP: "WHATSAPP",
  INSTAGRAM: "BOOKING",
  TELEFONO: "MANUAL",
};

export function buildTurnoOrigenFromCanal(canal: string): string {
  return CANAL_TO_ORIGEN[canal] ?? "MANUAL";
}

/**
 * Decisión pura de auto-confirmación de una reserva pública. Auto-confirmamos
 * solo si la org lo tiene activado Y conocemos el profesional destino (M40
 * keyea el overlap por profesional_id; sin profesional no podemos crear el
 * turno). Devuelve también el profesionalId para el caller.
 */
export function buildAutoConfirmDecision(
  org: { auto_confirmar_reservas: boolean },
  pedido: { profesional_id: string | null },
): { shouldAutoConfirm: boolean; profesionalId: string | null } {
  return {
    shouldAutoConfirm: org.auto_confirmar_reservas === true && !!pedido.profesional_id,
    profesionalId: pedido.profesional_id,
  };
}

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

  // Decode los cifrados. tryDecrypt (no decryptColumn crudo): una fila con
  // ciphertext corrupto no debe tirar una excepción que tumbe el listado
  // entero ni escape el contrato Result — degrada ese campo a null.
  const decoded = (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    nombre: tryDecrypt(row.nombre_cifrado as Buffer | null, "pedido.nombre"),
    telefono: tryDecrypt(row.telefono_cifrado as Buffer | null, "pedido.telefono"),
    email: tryDecrypt(row.email_cifrado as Buffer | null, "pedido.email"),
    motivo: tryDecrypt(row.motivo_cifrado as Buffer | null, "pedido.motivo"),
  }));
  return ok(decoded);
}

// ─── Core compartido: promover un pedido a turno ──────────────────────
//
// Sin sesión: recibe el client (service o server — son estructuralmente el
// mismo tipo `createServerClient<any>`). Lo usan tanto `aceptarPedido`
// (profesional aceptando manualmente en la bandeja, server client autenticado)
// como `createPedidoPublico` (auto-confirmación, service client sin sesión).
//
// Pasos: re-chequear slot → resolver/crear paciente → CAS PENDIENTE→CONFIRMADO
// → insertar turno CONFIRMADO → programar recordatorios. Errores devuelven un
// Result con rollback de los pasos previos para no dejar estado inconsistente.

export interface PromotePedidoInput {
  pedidoId: string;
  organizationId: string;
  profesionalId: string;
  servicioId: string;
  fechaPropuesta: string;
  duracionMin: number;
  precioCents: number | null;
  canal: string;
  /** Si viene, se reutiliza el paciente existente; sino se crea uno nuevo. */
  pacienteId?: string | null;
  nombre: string;
  telefono: string;
  email: string | null;
  motivo: string | null;
}

export async function promotePedidoToTurno(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: PromotePedidoInput,
): Promise<Result<{ turnoId: string; pacienteId: string }>> {
  const {
    pedidoId,
    organizationId,
    profesionalId,
    servicioId,
    fechaPropuesta,
    duracionMin,
    precioCents,
    canal,
    nombre,
    telefono,
    email,
    motivo,
  } = input;

  // a. Re-chequeo de solapamiento ANTES de cualquier mutación. Si el slot está
  //    ocupado abortamos limpio: el pedido sigue PENDIENTE. El propio pedido
  //    (aún PENDIENTE con fecha_propuesta solapada por definición) se excluye
  //    del chequeo (M53) — sin esto se auto-conflictuaba y NINGUNA reserva
  //    pública ni acepte de bandeja podía completarse.
  const ocupado = await checkSlotOcupado(
    client,
    organizationId,
    fechaPropuesta,
    duracionMin,
    profesionalId,
    pedidoId,
  );
  if (ocupado) {
    return err("conflict", "Ese horario ya no está disponible.");
  }

  // b. Resolver paciente: usar el existente o crear identidad + paciente.
  let pacienteId: string;
  if (input.pacienteId) {
    pacienteId = input.pacienteId;
  } else {
    if (telefono.length < 6) {
      return err("validation", "El pedido no tiene teléfono válido para crear el paciente.");
    }
    const partes = nombre.trim().split(/\s+/);
    const primerNombre = partes[0] || "Sin nombre";
    const apellido = partes.slice(1).join(" ") || "—";
    const nombreFull = `${primerNombre} ${apellido}`;

    const { data: identidad, error: idErr } = await client
      .from("paciente_identidad")
      .insert({
        organization_id: organizationId,
        nombre_cifrado: encryptColumn(primerNombre)!,
        apellido_cifrado: encryptColumn(apellido)!,
        tipo_doc: "DNI",
        telefono_cifrado: encryptColumn(telefono)!,
        email_cifrado: encryptColumn(email ?? null),
        nombre_hash: blindIndex(nombreFull, organizationId),
        telefono_hash: blindIndexPhone(telefono, organizationId), // M30 dedup partial UNIQUE
      })
      .select("id")
      .single();

    if (idErr || !identidad) {
      // 23505 = duplicate telefono_hash (M30): el paciente ya existe. En vez de
      // fallar, lo resolvemos y reutilizamos.
      const sqlstate = (idErr as { code?: string } | null)?.code;
      if (sqlstate === "23505") {
        const { data: existIdentidad } = await client
          .from("paciente_identidad")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("telefono_hash", blindIndexPhone(telefono, organizationId))
          .maybeSingle();
        if (!existIdentidad) {
          return err("db_error", "No se pudo resolver el paciente existente.", idErr?.message);
        }
        const { data: existPaciente } = await client
          .from("paciente")
          .select("id")
          .eq("identidad_id", existIdentidad.id)
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .maybeSingle();
        if (!existPaciente) {
          return err("db_error", "No se pudo resolver el paciente existente.", idErr?.message);
        }
        pacienteId = existPaciente.id;
        return await finishPromote();
      }
      const mapped = mapSupabaseError(idErr ?? { message: "no identidad" });
      return err(mapped.code, mapped.message, idErr?.message);
    }
    const identidadId = identidad.id;

    const { data: paciente, error: pacErr } = await client
      .from("paciente")
      .insert({
        organization_id: organizationId,
        identidad_id: identidadId,
        motivo_consulta_cifrado: encryptColumn(motivo ?? null),
        tags: [],
        profesional_principal_id: profesionalId,
      })
      .select("id")
      .single();

    if (pacErr || !paciente) {
      // Rollback identidad para no dejar una identidad huérfana sin paciente.
      await client.from("paciente_identidad").delete().eq("id", identidadId);
      const mapped = pacErr ? mapSupabaseError(pacErr) : { code: "db_error" as const, message: "No se creó el paciente." };
      return err(mapped.code, mapped.message, pacErr?.message);
    }
    pacienteId = paciente.id;

    // Business event: paciente nuevo creado desde un pedido (manual o auto).
    void trackEvent.pacienteCreated({
      orgId: organizationId,
      source: "pedido",
      hasDni: false,
      hasEmail: Boolean(email),
    });
  }

  return await finishPromote();

  // Pasos c-f compartidos por ambas ramas de resolución de paciente.
  async function finishPromote(): Promise<Result<{ turnoId: string; pacienteId: string }>> {
    // c. CAS del estado del pedido ANTES de crear el turno.
    const { data: casRows, error: casErr } = await client
      .from("pedido")
      .update({
        estado: "CONFIRMADO",
        confirmado_ts: new Date().toISOString(),
        paciente_id: pacienteId,
      })
      .eq("id", pedidoId)
      .eq("organization_id", organizationId)
      .eq("estado", "PENDIENTE")
      .select("id");

    const casDecision = decidePedidoCas(casRows?.length ?? 0, Boolean(casErr));
    if (casDecision === "db_error") {
      const mapped = mapSupabaseError(casErr ?? { message: "cas failed" });
      return err(mapped.code, "No se pudo actualizar el pedido.", casErr?.message);
    }
    if (casDecision === "conflict") {
      return err("conflict", "El pedido ya fue procesado.");
    }

    // d. Insertar turno CONFIRMADO. Si falla, rollback del CAS a PENDIENTE.
    const { data: turno, error: turnoErr } = await client
      .from("turno")
      .insert({
        organization_id: organizationId,
        paciente_id: pacienteId,
        servicio_id: servicioId,
        profesional_id: profesionalId,
        inicio: fechaPropuesta,
        duracion_min: duracionMin,
        precio_cents: precioCents ?? 0,
        origen: buildTurnoOrigenFromCanal(canal),
        estado: "CONFIRMADO",
      })
      .select("id")
      .single();

    if (turnoErr || !turno) {
      await client
        .from("pedido")
        .update({ estado: "PENDIENTE", confirmado_ts: null })
        .eq("id", pedidoId)
        .eq("organization_id", organizationId);
      return err(
        mapSupabaseError(turnoErr ?? { message: "no turno" }).code,
        "No se pudo crear el turno desde el pedido.",
        turnoErr?.message,
      );
    }

    // e. Programar recordatorios 24h/2h (fire-and-forget).
    scheduleRecordatoriosFireAndForget(organizationId, turno.id, fechaPropuesta);

    // e.2 Push a Google Calendar (fire-and-forget, fail-safe). Cubre tanto el
    //     booking público auto-confirmado como `aceptarPedido` (ambos pasan por
    //     este core). pushTurnoToGoogle ya es no-throw, pero encadenamos un
    //     .catch defensivo por consistencia con el patrón Sentry del repo.
    pushTurnoToGoogle({
      client,
      turnoId: turno.id,
      organizationId,
      profesionalMemberId: profesionalId,
    }).catch(async (e) => {
      const { captureException } = await import("@sentry/nextjs");
      captureException(e, {
        tags: { component: "pedido-accept", op: "pushTurnoToGoogle" },
        extra: { turnoId: turno.id, organizationId },
      });
    });

    // e.3 Email de confirmación al paciente (fire-and-forget, fail-safe). Cubre
    //     tanto el booking público auto-confirmado como `aceptarPedido` (ambos
    //     pasan por este core). notifyBookingConfirmada ya es no-throw; el
    //     .catch defensivo replica el patrón Sentry del repo.
    notifyBookingConfirmada({
      client,
      turnoId: turno.id,
      organizationId,
      pacienteEmail: input.email,
      pacienteNombre: input.nombre,
    }).catch(async (e) => {
      const { captureException } = await import("@sentry/nextjs");
      captureException(e, {
        tags: { component: "pedido-accept", op: "notifyBookingConfirmada" },
        extra: { turnoId: turno.id, organizationId },
      });
    });

    // f. Listo.
    return ok({ turnoId: turno.id, pacienteId });
  }
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

  // ── CR-5: chequeo de solapamiento ANTES de tocar el estado del pedido.
  //    Si el slot está ocupado abortamos sin haber modificado nada → el
  //    pedido queda PENDIENTE (no se stranda en CONFIRMADO). Excluimos el
  //    propio pedido del chequeo (M53): si inicio == fecha_propuesta se
  //    auto-conflictuaba siempre.
  const ocupado = await checkSlotOcupado(
    supabase,
    session.data.organizationId,
    inicio,
    pedido.duracion_min,
    profesionalId,
    pedidoId,
  );
  if (ocupado) {
    return err(
      "conflict",
      "Ya hay un turno a esa hora. No se confirmó el pedido.",
    );
  }

  // ── CR-7: compare-and-swap del estado. Flippeamos PENDIENTE→CONFIRMADO de
  //    forma atómica ANTES de crear el turno. La guarda `.eq('estado',
  //    'PENDIENTE')` garantiza que sólo un acepte concurrente gane: el que
  //    obtiene la fila procede, el resto recibe 0 filas → conflict.
  const { data: casRows, error: casErr } = await supabase
    .from("pedido")
    .update({
      estado: "CONFIRMADO",
      confirmado_ts: new Date().toISOString(),
      paciente_id: pacienteId,
    })
    .eq("id", pedidoId)
    .eq("organization_id", session.data.organizationId)
    .eq("estado", "PENDIENTE")
    .select("id");

  const casDecision = decidePedidoCas(casRows?.length ?? 0, Boolean(casErr));
  if (casDecision === "db_error") {
    const mapped = mapSupabaseError(casErr ?? { message: "cas failed" });
    return err(mapped.code, "No se pudo actualizar el pedido.", casErr?.message);
  }
  if (casDecision === "conflict") {
    return err("conflict", "El pedido ya fue procesado por otra persona.");
  }

  // ── Crear turno. Si falla, rollback del CAS (volver el pedido a PENDIENTE)
  //    para no dejarlo CONFIRMADO sin turno asociado.
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
    await supabase
      .from("pedido")
      .update({ estado: "PENDIENTE", confirmado_ts: null })
      .eq("id", pedidoId)
      .eq("organization_id", session.data.organizationId);
    return err(
      mapSupabaseError(turnoErr ?? { message: "no turno" }).code,
      "No se pudo crear el turno desde el pedido.",
      turnoErr?.message,
    );
  }

  // ── H-APP-1: programar recordatorios 24h/2h (los pacientes que reservan
  //    por web no los recibían). Fire-and-forget con captura Sentry.
  scheduleRecordatoriosFireAndForget(session.data.organizationId, turno.id, inicio);

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
  profesional_id: string | null;
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
      "id, organization_id, paciente_id, profesional_id, servicio_id, fecha_propuesta, duracion_min, precio_cents, canal, estado, nombre_cifrado, telefono_cifrado, email_cifrado, motivo_cifrado",
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

  // Descifrar los datos del paciente para pasarlos al core. Si pedido.paciente_id
  // ya existe, el core los ignora (reutiliza el paciente).
  const nombre = decryptColumn(pedidoRaw.nombre_cifrado) ?? "Sin nombre";
  const telefono = decryptColumn(pedidoRaw.telefono_cifrado) ?? "";
  const email = decryptColumn(pedidoRaw.email_cifrado);
  const motivo = decryptColumn(pedidoRaw.motivo_cifrado);

  // Delegamos en el core compartido `promotePedidoToTurno`: re-chequeo de slot,
  // resolución/creación del paciente (con dedup 23505), CAS PENDIENTE→CONFIRMADO,
  // insert del turno (origen vía CANAL_TO_ORIGEN [B1]) y recordatorios. El
  // profesional destino es el del pedido (booking público) o, en su defecto, el
  // member de la sesión que acepta. trackEvent.pacienteCreated se dispara dentro
  // del core cuando se crea un paciente nuevo.
  return await promotePedidoToTurno(supabase, {
    pedidoId,
    organizationId: session.data.organizationId,
    profesionalId: pedidoRaw.profesional_id ?? session.data.memberId,
    servicioId: pedidoRaw.servicio_id,
    fechaPropuesta: pedidoRaw.fecha_propuesta,
    duracionMin: pedidoRaw.duracion_min,
    precioCents: pedidoRaw.precio_cents,
    canal: pedidoRaw.canal,
    pacienteId: pedidoRaw.paciente_id,
    nombre,
    telefono,
    email,
    motivo,
  });
}
