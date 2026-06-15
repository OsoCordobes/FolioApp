/**
 * Folio · queries y mutations de Turno.
 *
 * Usa la vista `turno_extendido` (M14) que ya hace el JOIN con paciente,
 * servicio y pago — minimiza round-trips.
 *
 * RLS se aplica automáticamente (la vista hereda con security_invoker=true).
 */

import { z } from "zod";

import { runAfterResponse } from "@/lib/after-response";
import { cancelTurnoEnGoogle, pushTurnoToGoogle } from "@/lib/google/sync";
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
  id?: string;
  inicio?: string;
  fecha_propuesta?: string;
  duracion_min: number;
}

/**
 * `decideSlotOcupado` — función pura que decide si un slot está ocupado a
 * partir de las filas candidatas (turnos, pedidos y bloqueos) que se
 * solapan con el rango [inicio, fin). Aislada para poder testearla sin DB.
 *
 * `excludePedidoId` (M53): el pedido que se está promoviendo a turno no debe
 * contarse como conflicto contra sí mismo — sin esto, TODA promoción de un
 * pedido con fecha_propuesta se auto-conflictuaba y el booking público
 * fallaba siempre.
 *
 * `excludeTurnoId` (reagendar): análogo para turnos — al reagendar, el turno
 * que se está moviendo sigue vivo (AGENDADO/CONFIRMADO) durante el chequeo
 * del horario nuevo y se contaría a sí mismo como conflicto si el horario
 * nuevo solapa con el viejo (ej.: correr el turno 15 minutos).
 */
export function decideSlotOcupado(
  inicioMs: number,
  finMs: number,
  candidatos: {
    turnos: SlotConflictRow[] | null;
    pedidos: SlotConflictRow[] | null;
    bloqueos: SlotConflictRow[] | null;
  },
  excludePedidoId?: string | null,
  excludeTurnoId?: string | null,
): boolean {
  const overlapsWith = (rows: SlotConflictRow[] | null, field: "inicio" | "fecha_propuesta") =>
    (rows ?? []).some((r) => {
      const startMs = new Date(r[field]!).getTime();
      const endMs = startMs + r.duracion_min * 60_000;
      return slotRangesOverlap(inicioMs, finMs, startMs, endMs);
    });

  const pedidos = excludePedidoId
    ? (candidatos.pedidos ?? []).filter((p) => p.id !== excludePedidoId)
    : candidatos.pedidos;

  const turnos = excludeTurnoId
    ? (candidatos.turnos ?? []).filter((t) => t.id !== excludeTurnoId)
    : candidatos.turnos;

  return (
    overlapsWith(turnos, "inicio") ||
    overlapsWith(pedidos, "fecha_propuesta") ||
    overlapsWith(candidatos.bloqueos, "inicio")
  );
}

/**
 * Chequea si un slot [inicio, inicio+duracionMin) ya está ocupado para el
 * PROFESIONAL (M54: per-profesional, no org-wide — en una clínica el turno
 * del cardiólogo no bloquea a la psicóloga; el EXCLUDE de M40, que keyea por
 * profesional_id, sigue siendo el backstop transaccional). Mismo enfoque que
 * el booking público: intenta el RPC `slot_ocupado` (M44 → M53 → M54) y, si
 * falla, cae al chequeo manual contra turno + pedido + bloqueo con la MISMA
 * semántica:
 *   · turno   — solo los del profesional.
 *   · bloqueo — solo los del profesional (agenda personal, NOT NULL desde M09).
 *   · pedido  — los del profesional MÁS los sin profesional asignado
 *               (legacy/WhatsApp): bloquean conservadoramente hasta asignarse.
 *
 * `excludePedidoId` (M53): al promover un pedido a turno, ese pedido sigue
 * PENDIENTE durante el chequeo y se contaría a sí mismo como conflicto. El
 * caller (promotePedidoToTurno) pasa su id para excluirlo
 * tanto en el RPC como en el fallback.
 *
 * `excludeTurnoId` (M54, reagendar): el turno que se está moviendo se excluye
 * del chequeo del horario nuevo (auto-conflicto si los rangos solapan). El RPC
 * lo recibe como `p_exclude_turno`, así el pre-check del reagendado y el
 * chequeo interno de createTurno comparten el MISMO camino y semántica
 * (review PR #44, B1: la divergencia pre-check manual vs create RPC producía
 * huérfanos determinísticos en clínicas multi-profesional).
 */
export async function checkSlotOcupado(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  inicioIso: string,
  duracionMin: number,
  profesionalId: string,
  excludePedidoId?: string | null,
  excludeTurnoId?: string | null,
): Promise<boolean> {
  const inicioDate = new Date(inicioIso);
  const finDate = new Date(inicioDate.getTime() + duracionMin * 60_000);

  // RPC M54: per-profesional + exclusión de pedido Y de turno. Corre SIEMPRE
  // (el skip-RPC pre-M54 quedó obsoleto: `p_exclude_turno` cubre el
  // auto-conflicto del reagendado dentro del propio RPC).
  const overlap = await supabase.rpc("slot_ocupado", {
    p_org: organizationId,
    p_inicio: inicioDate.toISOString(),
    p_fin: finDate.toISOString(),
    p_exclude_pedido: excludePedidoId ?? null,
    p_profesional: profesionalId,
    p_exclude_turno: excludeTurnoId ?? null,
  });

  if (!(overlap.error || overlap.data === null)) {
    return overlap.data === true;
  }

  // Fallback manual (mismo patrón que createPedidoPublico). Ventana de -8h
  // para capturar turnos largos que arrancan antes pero todavía solapan
  // (la duración máxima de un turno es 480min = 8h).
  const finIso = finDate.toISOString();
  const lookbackIso = new Date(inicioDate.getTime() - 8 * 60 * 60_000).toISOString();

  let pedidoQuery = supabase
    .from("pedido")
    .select("id, fecha_propuesta, duracion_min")
    .eq("organization_id", organizationId)
    .eq("estado", "PENDIENTE")
    // M54: pedidos del profesional + los sin asignar (bloqueo conservador,
    // misma semántica que el RPC).
    .or(`profesional_id.eq.${profesionalId},profesional_id.is.null`)
    .not("fecha_propuesta", "is", null)
    .gte("fecha_propuesta", lookbackIso)
    .lt("fecha_propuesta", finIso)
    .limit(20);
  // M53: excluir el pedido en promoción (ver doc de la función).
  if (excludePedidoId) pedidoQuery = pedidoQuery.neq("id", excludePedidoId);

  let turnoQuery = supabase
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
    .limit(20);
  // Reagendar: excluir el turno que se está moviendo (ver doc de la función).
  if (excludeTurnoId) turnoQuery = turnoQuery.neq("id", excludeTurnoId);

  const [{ data: turnoConflict }, { data: pedidoConflict }, { data: bloqueoConflict }] =
    await Promise.all([
      turnoQuery,
      pedidoQuery,
      supabase
        .from("bloqueo")
        .select("id, inicio, duracion_min")
        .eq("organization_id", organizationId)
        // M54: el bloqueo es agenda personal (profesional_id NOT NULL desde
        // M09) — la ausencia del cardiólogo no bloquea a la psicóloga.
        .eq("profesional_id", profesionalId)
        .gte("inicio", lookbackIso)
        .lt("inicio", finIso)
        .limit(20),
    ]);

  return decideSlotOcupado(
    inicioDate.getTime(),
    finDate.getTime(),
    {
      turnos: turnoConflict as SlotConflictRow[] | null,
      pedidos: pedidoConflict as SlotConflictRow[] | null,
      bloqueos: bloqueoConflict as SlotConflictRow[] | null,
    },
    excludePedidoId,
    excludeTurnoId,
  );
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
  opts?: {
    /**
     * M56: literal bytea (`\\x…`) ya cifrado de la nota de reserva. Se usa al
     * reagendar para arrastrar el motivo del booking del turno original al
     * reemplazo (sin re-descifrar/re-cifrar — ya viene como wire). Opcional:
     * los callers normales (Agendar manual) lo omiten y la columna queda NULL.
     */
    notaReservaCifrado?: string | null;
  },
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
      // M56: arrastra la nota de reserva del original al reagendar (undefined
      // → la columna queda NULL, comportamiento histórico del Agendar manual).
      ...(opts?.notaReservaCifrado != null
        ? { nota_reserva_cifrado: opts.notaReservaCifrado }
        : {}),
    })
    .select("id")
    .single();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("db_error", "No se creó el turno.");

  // Programar recordatorios 24h y 2h (idempotente vía UNIQUE turno_id,tipo).
  // Si el insert de recordatorios falla no rollbackeamos el turno — el dispatcher
  // reintentará via /api/cron y/o el user puede re-programarlos desde la UI.
  // Corre post-respuesta vía after() (runAfterResponse) capturando errores en
  // Sentry DENTRO del callback (auditoría MEDIUM-observabilidad: el patrón
  // `void promise` silenciaba fallos previamente).
  runAfterResponse(() =>
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
    }),
  );

  // Push a Google Calendar (post-respuesta, fail-safe — nunca cambia el Result).
  runAfterResponse(() =>
    pushTurnoToGoogle({
      client: supabase,
      turnoId: data.id,
      organizationId: session.data.organizationId,
      profesionalMemberId: parsed.data.profesional_id,
    }).catch(async (err) => {
      const { captureException } = await import("@sentry/nextjs");
      captureException(err, {
        tags: { component: "turno-create", op: "pushTurnoToGoogle" },
        extra: { turnoId: data.id, organizationId: session.data.organizationId },
      });
    }),
  );

  return ok({ id: data.id });
}

// ─── State machine: transicionar turno ─────────────────────────────────

/**
 * Estados cuyo ingreso cancela los side-effects pendientes del turno
 * (recordatorios programados + evento de Google Calendar): el turno ya no va
 * a ocurrir como estaba agendado. NO_ASISTIO incluido (auditoría CLINICA-3,
 * hallazgo E): sin esto el calendar del médico seguía mostrando el evento de
 * un paciente que no vino, y un recordatorio aún pendiente (ej. ausencia
 * marcada antes de la hora del turno) podía dispararse igual. Si después se
 * re-cita (NO_ASISTIO → REAGENDADO, carve-out M09), el turno NUEVO programa
 * sus propios recordatorios y evento — re-cancelar el viejo es idempotente.
 */
export const ESTADOS_CANCELAN_SIDE_EFFECTS = ["CANCELADO", "REAGENDADO", "NO_ASISTIO"] as const;

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
  } else {
    // turno_atendiendo_consistency (M09): atendiendo_desde solo puede estar
    // seteado mientras estado = ATENDIENDO. Sin este null, cerrar/cancelar un
    // turno en atención viola el CHECK y la transición se rechaza siempre.
    patch.atendiendo_desde = null;
  }
  if (parsed.data.to === "CERRADO" && parsed.data.duracionRealMin != null) {
    patch.duracion_real_min = parsed.data.duracionRealMin;
  }

  const { data: updatedRows, error } = await supabase
    .from("turno")
    .update(patch)
    .eq("id", parsed.data.turnoId)
    .eq("organization_id", session.data.organizationId)
    .select("profesional_id, precio_cents");

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, mapped.message, error.message);
  }

  // UPDATE sin filas afectadas (id inexistente, soft-deleted u otra org vía
  // RLS): PostgREST NO lo reporta como error — devolvía ok() y la UI
  // optimista quedaba mintiendo un estado que nunca se persistió.
  if (!updatedRows || updatedRows.length === 0) {
    return err("not_found", "El turno no existe o no es de tu organización.");
  }

  const profesionalMemberId = (updatedRows?.[0]?.profesional_id as string | undefined) ?? null;
  const precioCents = (updatedRows?.[0]?.precio_cents as number | undefined) ?? 0;

  // Registrar el cobro al cerrar. El dashboard de /hoy ya cuenta los turnos
  // CERRADOS como recaudado; sin esta fila /finanzas (que lee `pago`) mostraba
  // $0 para el mismo día. Idempotente vía UNIQUE(turno_id); no-fatal: si la
  // RLS lo rechaza (rol sin permiso de pagos) el cierre del turno sigue
  // valiendo y el pago se puede registrar después desde finanzas.
  if (parsed.data.to === "CERRADO" && precioCents > 0) {
    const { error: pagoErr } = await supabase.from("pago").upsert(
      {
        turno_id: parsed.data.turnoId,
        monto_cents: precioCents,
        metodo: "EFECTIVO",
        estado: "PAGADO",
        pagado_ts: new Date().toISOString(),
        notas: "Registrado automáticamente al cerrar el turno.",
      },
      { onConflict: "turno_id", ignoreDuplicates: true },
    );
    if (pagoErr) {
      const { captureException } = await import("@sentry/nextjs");
      captureException(new Error(`pago auto-registro falló: ${pagoErr.message}`), {
        tags: { component: "turno-transition", op: "autoPago" },
        extra: { turnoId: parsed.data.turnoId },
      });
    }
  }

  // Hooks de transición de estado para la cola de recordatorios.
  // Post-respuesta vía after() con captura Sentry DENTRO del callback
  // (mismo razonamiento que createTurno).
  if (parsed.data.to === "CERRADO") {
    runAfterResponse(() =>
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
      }),
    );
  }
  if ((ESTADOS_CANCELAN_SIDE_EFFECTS as readonly string[]).includes(parsed.data.to)) {
    runAfterResponse(() =>
      cancelRecordatoriosForTurno(parsed.data.turnoId).catch(async (err) => {
        const { captureException } = await import("@sentry/nextjs");
        captureException(err, {
          tags: { component: "turno-transition", op: "cancelRecordatorios" },
          extra: { turnoId: parsed.data.turnoId, newEstado: parsed.data.to },
        });
      }),
    );

    // Cancelar el evento en Google Calendar (post-respuesta, fail-safe).
    if (profesionalMemberId) {
      runAfterResponse(() =>
        cancelTurnoEnGoogle({
          client: supabase,
          turnoId: parsed.data.turnoId,
          organizationId: session.data.organizationId,
          profesionalMemberId,
        }).catch(async (err) => {
          const { captureException } = await import("@sentry/nextjs");
          captureException(err, {
            tags: { component: "turno-transition", op: "cancelTurnoEnGoogle" },
            extra: { turnoId: parsed.data.turnoId, newEstado: parsed.data.to },
          });
        }),
      );
    }
  }

  return ok(undefined);
}

// ─── Reagendar turno ────────────────────────────────────────────────────

/**
 * Estados desde los que el trigger `turno_record_transition` (M09, security
 * definer desde M47, AGENDADO→EN_SALA agregado en M57) permite transicionar a
 * REAGENDADO. Verificado contra la matriz real del SQL:
 *
 *   AGENDADO   → CONFIRMADO | EN_SALA | CANCELADO | REAGENDADO | NO_ASISTIO
 *   CONFIRMADO → EN_SALA | NO_ASISTIO | CANCELADO | REAGENDADO
 *   EN_SALA    → ATENDIENDO | CANCELADO
 *   ATENDIENDO → CERRADO
 *   NO_ASISTIO → REAGENDADO          ← carve-out deliberado: un no-show se
 *                                       puede re-citar (la UI de /hoy solo
 *                                       expone Reagendar en agendado|confirmado;
 *                                       NO_ASISTIO queda habilitado a nivel
 *                                       data layer para flujos futuros).
 *
 * Función pura (testeable sin DB): validamos en app ANTES de mutar para
 * devolver un mensaje claro en vez del genérico "transición no permitida"
 * del trigger.
 */
export const ESTADOS_REAGENDABLES = ["AGENDADO", "CONFIRMADO", "NO_ASISTIO"] as const;

export function puedeReagendarEstado(estado: string): boolean {
  return (ESTADOS_REAGENDABLES as readonly string[]).includes(estado);
}

const reagendarSchema = z.object({
  turnoId: z.string().uuid(),
  nuevoInicio: z.string().datetime({ offset: true }),
  nuevaDuracionMin: z.number().int().min(5).max(480).optional(),
});

export type ReagendarTurnoInput = z.infer<typeof reagendarSchema>;

/**
 * Reagenda un turno: marca el original como REAGENDADO y crea uno nuevo con
 * el mismo paciente/servicio/profesional/precio en el horario nuevo.
 *
 * Orden deliberado:
 *   1. SELECT org-scoped + validación de estado (puedeReagendarEstado).
 *   2. checkSlotOcupado del horario nuevo con excludeTurnoId → err("conflict")
 *      temprano, sin tocar nada. Desde M54 este pre-check va por el MISMO RPC
 *      per-profesional que usa createTurno en (4) — semánticas idénticas, la
 *      divergencia B1 del review de PR #44 (pre-check manual pasaba, create
 *      org-wide fallaba post-transición) ya no puede ocurrir.
 *   3. transitionTurno(→REAGENDADO) PRIMERO — sus hooks existentes cancelan
 *      recordatorios + evento de Google Calendar del turno viejo. Acá se
 *      dispara `hooks.onTransitioned` (si vino): hubo mutación real, el
 *      caller debe revalidar SUS rutas aunque (4) falle después (I2).
 *   4. createTurno — programa recordatorios + push a Google Calendar nuevos.
 *
 * Riesgo residual (documentado, follow-up RPC transaccional):
 *   - TOCTOU entre (2) y (4): otro turno puede ganar el slot en el medio. El
 *     EXCLUDE de M40 es el backstop — createTurno devuelve conflict (23P01)
 *     y NO se inserta nada solapado.
 *   - Si (4) falla por cualquier causa, el viejo ya quedó REAGENDADO (estado
 *     terminal, no hay vuelta atrás sin RPC transaccional). Devolvemos un
 *     err explícito pidiendo crear el turno a mano; no se pierde información
 *     clínica (el turno viejo sigue visible como Reagendado).
 */
export async function reagendarTurno(
  input: ReagendarTurnoInput,
  hooks?: {
    /**
     * Se invoca apenas el turno original queda REAGENDADO (mutación
     * irreversible) — ANTES del createTurno. El caller (server action) lo usa
     * para revalidatePath: si el create falla después, la UI igual tiene que
     * dejar de mostrar el turno viejo como agendado (review PR #44, I2).
     */
    onTransitioned?: () => void;
  },
): Promise<Result<{ nuevoTurnoId: string }>> {
  const parsed = reagendarSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del reagendado inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // 1. Turno original, org-scoped (RLS además filtra por scope del rol).
  //    M56: traemos nota_reserva_cifrado para arrastrarla al reemplazo — el
  //    reagendado no debe perder el motivo del booking original.
  const { data: turno, error: selErr } = await supabase
    .from("turno")
    .select("id, estado, paciente_id, servicio_id, profesional_id, precio_cents, duracion_min, nota_reserva_cifrado")
    .eq("id", parsed.data.turnoId)
    .eq("organization_id", session.data.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (selErr) {
    const mapped = mapSupabaseError(selErr);
    return err(mapped.code, mapped.message, selErr.message);
  }
  if (!turno) {
    return err("not_found", "El turno no existe o no es de tu organización.");
  }
  if (!puedeReagendarEstado(turno.estado as string)) {
    return err(
      "transition_invalid",
      "Solo se pueden reagendar turnos agendados, confirmados o con ausencia registrada.",
    );
  }

  const duracionNueva = parsed.data.nuevaDuracionMin ?? (turno.duracion_min as number);

  // 2. Chequeo del horario nuevo excluyendo el turno que estamos moviendo
  //    (sin exclusión, mover un turno solapando su propio rango viejo se
  //    auto-conflictuaría siempre).
  const ocupado = await checkSlotOcupado(
    supabase,
    session.data.organizationId,
    parsed.data.nuevoInicio,
    duracionNueva,
    turno.profesional_id as string,
    null,
    parsed.data.turnoId,
  );
  if (ocupado) {
    return err("conflict", "Ese horario ya está ocupado.");
  }

  // 3. Marcar el original como REAGENDADO. transitionTurno ya se encarga de
  //    cancelar recordatorios + evento gcal del viejo (hooks post-respuesta).
  const transitioned = await transitionTurno({
    turnoId: parsed.data.turnoId,
    to: "REAGENDADO",
  });
  if (!transitioned.ok) return transitioned;

  // Mutación irreversible consumada: avisar al caller (revalidatePath) ANTES
  // de intentar el create — si falla, la UI igual debe refrescarse (I2).
  hooks?.onTransitioned?.();

  // 4. Crear el turno nuevo (programa recordatorios + push gcal nuevos).
  //    M56: arrastra la nota de reserva del original (ya viene como wire bytea
  //    `\\x…`; se re-inserta tal cual sin descifrar — no es PHI legible acá).
  const created = await createTurno(
    {
      paciente_id: turno.paciente_id as string,
      servicio_id: turno.servicio_id as string,
      profesional_id: turno.profesional_id as string,
      inicio: parsed.data.nuevoInicio,
      duracion_min: duracionNueva,
      precio_cents: turno.precio_cents as number,
      origen: "MANUAL",
    },
    { notaReservaCifrado: (turno.nota_reserva_cifrado as string | null) ?? null },
  );
  if (!created.ok) {
    // El viejo ya quedó REAGENDADO (terminal) — sin RPC transaccional no se
    // puede revertir. Mensaje accionable para que el turno no se pierda.
    return err(
      created.error.code,
      `El turno original quedó marcado como reagendado, pero no se pudo crear el nuevo: ${created.error.message} Creá el turno a mano desde «Agendar».`,
      created.error.detail,
    );
  }

  return ok({ nuevoTurnoId: created.data.id });
}

// ─── Walk-in: crea paciente (si nuevo) + turno EN_SALA ─────────────────
// Implementación en lib/db/walk-in.ts (necesita cifrado de PII, más involved).
