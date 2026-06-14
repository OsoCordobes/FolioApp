/**
 * Folio · queries y mutations de Pedido (booking entrante).
 */

import { z } from "zod";

import { runAfterResponse } from "@/lib/after-response";
import { blindIndex, blindIndexPhone, encryptColumn, tryDecrypt } from "@/lib/crypto";
import { notifyBookingConfirmada } from "@/lib/email/notify";
import { pushTurnoToGoogle } from "@/lib/google/sync";
import { trackEvent } from "@/lib/observability/events";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { resolveProfesionalDestino } from "./profesional-destino";
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
 * creado desde un pedido aceptado/confirmado (H-APP-1). Corre post-respuesta
 * vía after() (runAfterResponse) — el caller no espera el round-trip — con
 * captura en Sentry DENTRO del callback, mismo patrón que createTurno.
 */
function scheduleRecordatoriosFireAndForget(
  organizationId: string,
  turnoId: string,
  inicioIso: string,
): void {
  runAfterResponse(() =>
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
    }),
  );
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
    //    M56: copiamos el motivo del booking a turno.nota_reserva_cifrado
    //    (re-cifrado AES-256-GCM) para que el detalle del turno muestre la
    //    aclaración del paciente sin tener que volver al pedido. Cubre tanto el
    //    acepte manual de bandeja como el auto-confirm público (ambos pasan acá).
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
        nota_reserva_cifrado: encryptColumn(motivo ?? null),
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

    // e.2 Push a Google Calendar (post-respuesta vía after(), fail-safe).
    //     Cubre tanto el booking público auto-confirmado como `aceptarPedido`
    //     (ambos pasan por este core). pushTurnoToGoogle ya es no-throw, pero
    //     encadenamos un .catch defensivo (Sentry DENTRO del after).
    runAfterResponse(() =>
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
      }),
    );

    // e.3 Email de confirmación al paciente (post-respuesta vía after(),
    //     fail-safe). Cubre tanto el booking público auto-confirmado como
    //     `aceptarPedido` (ambos pasan por este core). notifyBookingConfirmada
    //     ya es no-throw; el .catch defensivo replica el patrón Sentry.
    runAfterResponse(() =>
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
      }),
    );

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

// ─── Confirmar pedido con otro horario (TODO, sin implementación) ─────
//
// Acá vivía `confirmarPedido`: dead code sin callers que reintroducía el bug
// B1 (canal→origen crudo: INSTAGRAM/TELEFONO no existen en origen_turno → el
// INSERT reventaba) y quedó fuera de los hooks de gcal/email del core. Se
// borró en CLINICA-3 (auditoría 2026-06-12, hallazgo D).
//
// TODO("aceptar con otro horario"): cuando la bandeja ofrezca aceptar un
// pedido en una hora distinta a la propuesta, implementarlo como wrapper FINO
// de `promotePedidoToTurno` con override de `fechaPropuesta` — el core ya
// hace slot check + CAS + mapeo canal→origen (B1) + recordatorios + push
// gcal + email. NO reimplementar el flujo a mano.

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

/**
 * Decisión pura (CLINICA-3, hallazgo C): un pedido cuyo nombre Y teléfono
 * quedaron ilegibles (tryDecrypt → null por ciphertext corrupto / key drift)
 * y que no referencia un paciente existente NO se puede aceptar — no habría
 * con qué crear el paciente. Antes, el listado degradaba con tryDecrypt pero
 * "Aceptar" usaba decryptColumn crudo: la fila se LISTABA y el acepte tiraba
 * una excepción no manejada (500) fuera del contrato Result.
 */
export function pedidoIlegibleParaAceptar(input: {
  nombre: string | null;
  telefono: string | null;
  pacienteId: string | null;
}): boolean {
  return input.nombre == null && input.telefono == null && input.pacienteId == null;
}

export async function aceptarPedido(
  pedidoId: string,
  opts?: {
    /**
     * Profesional destino elegido en el picker del PedidoModal. Solo se usa
     * cuando el pedido NO trae profesional_id propio (booking público sin
     * preferencia / WhatsApp); se valida server-side como colegiado activo.
     */
    profesionalId?: string | null;
  },
): Promise<Result<{ turnoId: string; pacienteId: string }>> {
  if (!z.string().uuid().safeParse(pedidoId).success) {
    return err("validation", "ID de pedido inválido.");
  }
  if (opts?.profesionalId != null && !z.string().uuid().safeParse(opts.profesionalId).success) {
    return err("validation", "Identificador de profesional inválido.");
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
  // ya existe, el core los ignora (reutiliza el paciente). tryDecrypt (no
  // decryptColumn crudo): un ciphertext corrupto degrada a null en vez de
  // tirar una excepción fuera del contrato Result — mismo patrón que
  // listPedidos, que ya LISTA estas filas degradadas.
  const nombreDec = tryDecrypt(pedidoRaw.nombre_cifrado, "pedido.nombre_cifrado");
  const telefonoDec = tryDecrypt(pedidoRaw.telefono_cifrado, "pedido.telefono_cifrado");
  const email = tryDecrypt(pedidoRaw.email_cifrado, "pedido.email_cifrado");
  const motivo = tryDecrypt(pedidoRaw.motivo_cifrado, "pedido.motivo_cifrado");

  if (
    pedidoIlegibleParaAceptar({
      nombre: nombreDec,
      telefono: telefonoDec,
      pacienteId: pedidoRaw.paciente_id,
    })
  ) {
    return err(
      "validation",
      "El pedido tiene datos ilegibles (nombre y teléfono no se pudieron descifrar). Rechazalo y creá el turno manual desde «Agendar».",
    );
  }
  const nombre = nombreDec ?? "Sin nombre";
  const telefono = telefonoDec ?? "";

  // Profesional destino (CLINICA-3, hallazgo B): manda el del pedido (booking
  // público con preferencia). Si el pedido no trae profesional, se usa el
  // elegido en el picker (validado como colegiado activo de la org) o, sin
  // picker, el member de la sesión SOLO si es colegiado. Una sesión no
  // colegiada (secretaria) sin elección explícita → err("validation") — se
  // eliminó el fallback silencioso a session.memberId, que asignaba el turno
  // a la secretaria: invisible para el médico (RLS), fuera de su EXCLUDE M40
  // y con push de gcal al calendar equivocado.
  //
  // CLINICA-4 (review #52): el profesional PRE-SETEADO también se re-valida —
  // entre el booking y el acepte pudo haberse dado de baja (soft-delete) o
  // des-colegiado. Si quedó inválido: con elección explícita del picker se
  // reasigna (validada abajo); sin elección, err accionable en vez de crear
  // un turno cuya agenda/gcal/finanzas apuntan a un member muerto.
  let profesionalId: string | null = null;
  if (pedidoRaw.profesional_id) {
    const preset = await resolveProfesionalDestino(supabase, {
      organizationId: session.data.organizationId,
      profesionalId: pedidoRaw.profesional_id,
      sessionMemberId: session.data.memberId,
      sessionEsColegiado: session.data.esColegiado,
    });
    if (preset.ok) {
      profesionalId = preset.data;
    } else if (preset.error.code !== "validation") {
      // Error de infraestructura (DB caída, RLS, etc.): propagarlo tal cual —
      // disfrazarlo de "profesional dado de baja" mandaría a reasignar un
      // turno por un fallo transitorio.
      return preset;
    } else if (!opts?.profesionalId) {
      return err(
        "validation",
        "El profesional asignado a este pedido ya no está activo. Elegí qué profesional va a atender el turno (o creá el turno manual desde «Agendar»).",
      );
    }
    // preset inválido + picker → cae a la resolución de abajo (reasignación
    // explícita, misma validación de colegiado activo).
  }
  if (!profesionalId) {
    const profRes = await resolveProfesionalDestino(supabase, {
      organizationId: session.data.organizationId,
      profesionalId: opts?.profesionalId ?? null,
      sessionMemberId: session.data.memberId,
      sessionEsColegiado: session.data.esColegiado,
    });
    if (!profRes.ok) return profRes;
    profesionalId = profRes.data;
  }

  // Delegamos en el core compartido `promotePedidoToTurno`: re-chequeo de slot,
  // resolución/creación del paciente (con dedup 23505), CAS PENDIENTE→CONFIRMADO,
  // insert del turno (origen vía CANAL_TO_ORIGEN [B1]) y recordatorios.
  // trackEvent.pacienteCreated se dispara dentro del core cuando se crea un
  // paciente nuevo.
  return await promotePedidoToTurno(supabase, {
    pedidoId,
    organizationId: session.data.organizationId,
    profesionalId,
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
