/**
 * Folio · self-service de turnos del PORTAL DEL PACIENTE (Fase 3 · P4).
 *
 * Espejo, del lado paciente, de lib/db/turnos.ts (staff). El paciente autenticado
 * (getPacienteSession → paciente_cuenta_actual() → auth.uid()) puede, sobre SUS
 * turnos y SUS fichas linkeadas:
 *
 *   1. CANCELAR un turno propio — sólo AGENDADO/CONFIRMADO, sólo fuera de la
 *      ventana de corte (organization.portal_cancel_cutoff_horas, default 24h).
 *      Es un UPDATE estado→CANCELADO por el cliente ANON (RLS M71+M84): la policy
 *      turno_cancel_portal + el trigger-guard turno_portal_cancel_guard fijan las
 *      invariantes (sólo estado cambia, origen AGENDADO/CONFIRMADO, ventana). La
 *      máquina de estados M09 y el EXCLUDE M40 son el backstop transaccional.
 *      Cancelar dispara los MISMOS side-effects que la cancelación del staff
 *      (recordatorios pendientes + evento de Google) y le avisa al profesional.
 *
 *   2. RESERVAR / REAGENDAR — NO muta `turno`: cae como `pedido` PENDIENTE para
 *      confirmación del clínico (respeta auto_confirmar_reservas: promoteo lo hace
 *      el staff o el auto-confirm, NUNCA el paciente por RLS). El pedido queda
 *      atado a la ficha `paciente` propia (self-INSERT policy pedido_insert_portal),
 *      canal 'PORTAL' (fuera del constraint WEB-consent de M39; el paciente ya está
 *      autenticado). Reagenda = mismo servicio/profesional que el turno original,
 *      nuevo horario propuesto.
 *
 * PRINCIPIO ANTI-IDOR (crítico): TODA query scopea desde la sesión del paciente
 * (cuenta_id = auth.uid() vía las policies M71/M84), NUNCA desde un id que mande el
 * cliente. El turnoId/pacienteId que llega por argumento SÓLO se usa dentro de un
 * filtro que la RLS ya restringe a lo que el paciente posee: si no es suyo, la RLS
 * devuelve 0 filas (cancel) o el WITH CHECK rechaza el INSERT (reserva). El paciente
 * NO tiene acceso a `sesion` (SOAP) — eso es estructural (M71).
 *
 * DEFENSAS DE LAS SOLICITUDES (D2): un `pedido` PENDIENTE bloquea su rango en
 * `slot_ocupado` y en la grilla pública, así que una solicitud sin validar no es
 * sólo ruido en la bandeja: le saca horarios reales al consultorio. Por eso toda
 * solicitud pasa por rate-limit por cuenta, cap de horizonte y validación contra
 * la grilla que el profesional realmente ofrece — las mismas defensas del
 * booking público (limitByIp/limitByKey + slotEstaOfrecido + ventana de 60 días).
 */

import { z } from "zod";

import { runAfterResponse } from "@/lib/after-response";
import {
  AvailabilityDbError,
  getSlotsDisponibles,
  slotEstaOfrecido,
  type Slot,
} from "@/lib/booking/availability";
import { encryptColumn, tryDecrypt } from "@/lib/crypto";
import { notifyTurnoCanceladoPorPaciente } from "@/lib/email/notify";
import { cancelTurnoEnGoogle } from "@/lib/google/sync";
import { bookingSlugDeOrg } from "@/lib/portal/portal-booking";
import { formatResetMessage, limitByKey } from "@/lib/security/rate-limit";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getPacienteSession } from "./paciente-session";
import { resolveProfesionalPublico } from "./profesional-destino";
import { cancelRecordatoriosForTurno } from "./recordatorios";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

// ─── Constantes de dominio ────────────────────────────────────────────────────

/** Estados de turno desde los que el PACIENTE puede cancelar por sí mismo. El
 * trigger-guard M84 y la máquina de estados M09 lo re-validan en DB; esta lista es
 * la copia pura para el pre-check de UX (mensaje claro antes del round-trip). Nunca
 * EN_SALA/ATENDIENDO/CERRADO/… — un turno en curso o cerrado no lo cancela el
 * paciente. */
export const ESTADOS_CANCELABLES_PACIENTE = ["AGENDADO", "CONFIRMADO"] as const;

/** Fallback del cutoff de cancelación si la org no trae el valor (columna con
 * DEFAULT 24 en M84; el fallback cubre filas leídas antes del backfill del default
 * o un NULL inesperado). */
export const PORTAL_CANCEL_CUTOFF_HORAS_DEFAULT = 24;

/**
 * Horizonte máximo (en días) que el portal acepta para una solicitud de turno.
 * El zod sólo exigía un datetime válido, así que una propuesta al año 9999
 * entraba sin chistar — y como TODO `pedido` PENDIENTE bloquea su rango en
 * `slot_ocupado` y en la grilla pública (getSlotsDisponibles), esa fila quedaba
 * ocupando la agenda del profesional para siempre. Mismo cap que ya aplica el
 * booking público en createPedidoPublico.
 */
export const PORTAL_HORIZONTE_DIAS = 60;

/**
 * Solicitudes de turno (reserva + reagenda, mismo cupo) que el portal acepta
 * por cuenta de paciente y por hora. La clave es la CUENTA y no la IP: el
 * endpoint exige sesión, la cuenta sale de auth.uid() (no se spoofea) y los
 * pacientes de un mismo consultorio comparten IP con frecuencia (CGNAT móvil,
 * wifi del edificio). Mismo criterio que el rate-limit de vinculación
 * (lib/portal/link-actions.ts).
 */
export const PORTAL_SOLICITUDES_MAX_POR_HORA = 5;

/** Estados de `turno` que ocupan agenda (los que la grilla resta y contra los
 * que se chequea el solape del fallback). Espeja getSlotsDisponibles y
 * checkSlotOcupado. */
const ESTADOS_TURNO_VIVO = ["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO"] as const;

/** Lookback del chequeo de solape: un turno puede durar hasta 480 min (8 h) y
 * arrancar antes de la ventana propuesta pero seguir pisándola. Mismo lookback
 * que checkSlotOcupado y que el fallback de createPedidoPublico. */
const LOOKBACK_TURNO_LARGO_MS = 8 * 60 * 60_000;

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers PUROS (testeables sin DB) — ventana de corte + doble-booking
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ¿El paciente puede cancelar este turno AHORA? Función pura: decide contra el
 * estado y la ventana de corte, sin tocar DB. La verdad la fija el trigger-guard
 * M84 (misma regla); esto es el pre-check para un mensaje accionable.
 *
 *   - estado ∈ {AGENDADO, CONFIRMADO} (nunca EN_SALA/ATENDIENDO/CERRADO/…),
 *   - inicio > now + cutoff horas (fuera de la ventana de corte).
 */
export function puedeCancelarPaciente(input: {
  estado: string;
  inicioMs: number;
  nowMs: number;
  cutoffHoras: number;
}): { ok: true } | { ok: false; reason: "estado" | "ventana" } {
  if (!(ESTADOS_CANCELABLES_PACIENTE as readonly string[]).includes(input.estado)) {
    return { ok: false, reason: "estado" };
  }
  const cutoffMs = Math.max(0, input.cutoffHoras) * 60 * 60_000;
  if (input.inicioMs <= input.nowMs + cutoffMs) {
    return { ok: false, reason: "ventana" };
  }
  return { ok: true };
}

/**
 * ¿El horario propuesto para una reagenda/reserva del portal solapa con algún
 * turno vivo del MISMO profesional? Función pura (testeable sin DB). Half-open
 * overlap [inicio, fin). El pedido resultante NO crea el turno (lo hace el clínico
 * o el auto-confirm, que re-chequea con checkSlotOcupado + EXCLUDE M40); este
 * pre-check evita encolar un pedido obviamente en conflicto y da feedback inmediato.
 *
 * `excludeTurnoId`: al reagendar, el turno que se está moviendo sigue vivo y no
 * debe contarse como conflicto contra su propio horario nuevo (mismo criterio que
 * reagendarTurno en lib/db/turnos.ts).
 */
export function propuestaSolapa(
  propuestaInicioMs: number,
  propuestaFinMs: number,
  turnosVivos: Array<{ id: string; inicioMs: number; finMs: number }>,
  excludeTurnoId?: string | null,
): boolean {
  return turnosVivos.some((t) => {
    if (excludeTurnoId && t.id === excludeTurnoId) return false;
    return propuestaInicioMs < t.finMs && t.inicioMs < propuestaFinMs;
  });
}

/** Por qué el portal rechaza un horario propuesto (reserva o reagenda). */
export type RechazoHorarioPortal = "pasado" | "horizonte" | "no_ofrecido";

/**
 * Decisión PURA sobre el horario que el paciente propone desde el portal.
 * Tres capas, en orden de costo creciente para el atacante:
 *
 *   1. `pasado`      — el instante ya pasó (o no es una fecha parseable).
 *   2. `horizonte`   — está más allá de PORTAL_HORIZONTE_DIAS días. Sin este
 *                      cap, un pedido bloqueaba un rango de agenda a diez años
 *                      vista y nadie lo iba a ver nunca en la bandeja.
 *   3. `no_ofrecido` — la grilla del profesional NO ofrece ese slot. Es la
 *                      misma regla del booking público (slotEstaOfrecido sobre
 *                      getSlotsDisponibles): el paciente sólo puede pedir
 *                      horarios que la agenda realmente publica, no timestamps
 *                      inventados que después bloquean reservas legítimas.
 *
 * `slotsOfrecidos: null` significa "la grilla no es computable" (turno sin
 * profesional o sin servicio, org no reservable, profesional sin disponibilidad
 * cargada). En ese caso la capa 3 se omite y el caller cae al chequeo de solape
 * (propuestaSolapa) — ver `validarHorarioPortal`.
 */
export function decidirHorarioPortal(input: {
  inicioMs: number;
  nowMs: number;
  slotsOfrecidos: Slot[] | null;
  horizonteDias?: number;
}): { ok: true } | { ok: false; reason: RechazoHorarioPortal } {
  if (!Number.isFinite(input.inicioMs) || input.inicioMs <= input.nowMs) {
    return { ok: false, reason: "pasado" };
  }
  const horizonteDias = Math.max(0, input.horizonteDias ?? PORTAL_HORIZONTE_DIAS);
  if (input.inicioMs > input.nowMs + horizonteDias * 24 * 60 * 60_000) {
    return { ok: false, reason: "horizonte" };
  }
  if (
    input.slotsOfrecidos !== null &&
    !slotEstaOfrecido(input.slotsOfrecidos, new Date(input.inicioMs).toISOString())
  ) {
    return { ok: false, reason: "no_ofrecido" };
  }
  return { ok: true };
}

/**
 * Decisión pura del profesional destino de una reserva NUEVA del portal, a
 * partir de los profesionales VINCULADOS al servicio (tabla M:N
 * `servicio_profesional`, M02 — `servicio` NO tiene columna profesional_id).
 * El caller ya filtró los vínculos a colegiados activos vivos:
 *
 *   - exactamente 1 vinculado → ese (el servicio define a su profesional);
 *   - 0 o varios → fallback_org: resolución org-level como el booking público
 *     sin elección explícita (resolveProfesionalPublico: único colegiado →
 *     ese; ninguno → la org no recibe reservas), PERO con la adaptación del
 *     portal para "varios" (ver adaptarFallbackOrgPortal).
 */
export function decideProfesionalPorServicio(
  vinculadosValidos: string[],
): { kind: "usar"; profesionalId: string } | { kind: "fallback_org" } {
  if (vinculadosValidos.length === 1) {
    return { kind: "usar", profesionalId: vinculadosValidos[0] };
  }
  return { kind: "fallback_org" };
}

/**
 * Adaptación PURA (testeable sin DB) del fallback org-level al portal. En el
 * booking público, el err("validation") de resolveProfesionalPublico ("elegí
 * con qué profesional…", varios colegiados sin elección) es RECUPERABLE: el
 * wizard muestra el picker y reintenta con profesionalId. El portal NO tiene
 * picker (nuevaReservaSchema no pide profesionalId), así que ese mismo err
 * sería un dead-end terminal: ninguna reserva nueva podría tener éxito para
 * servicios con 0 o ≥2 vinculados en una org multi-profesional, y el mensaje
 * pediría una elección imposible.
 *
 * Se degrada a profesional_id NULL: insertarPedidoPortal lo acepta y el staff
 * asigna el profesional al aceptar (resolverProfesionalDelPedido +
 * picker del PedidoModal, lib/db/pedidos.ts) — la degradación que ya usa
 * solicitarReagendaPortal para turnos sin profesional.
 *
 * La discriminación por code es segura: en el camino sin param de
 * resolveProfesionalPublico, mapSupabaseError nunca emite "validation"
 * (lib/db/errors.ts), así que "validation" ⇔ "hay varios, hay que elegir".
 * "not_found" (org sin colegiados: nadie podría aceptar el pedido) y los
 * errores de infra pasan tal cual.
 */
export function adaptarFallbackOrgPortal(res: Result<string>): Result<string | null> {
  if (!res.ok && res.error.code === "validation") return ok(null);
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Listado (whitelist seguro — NUNCA SOAP/tool_data/riesgo)
// ═══════════════════════════════════════════════════════════════════════════════

/** Un turno tal como lo ve el paciente en el portal. WHITELIST explícito: sólo
 * campos operativos (cuándo, con quién, estado). NUNCA SOAP, tool_data, notas ni
 * flags de riesgo — esos viven en `sesion`, a la que el paciente no tiene acceso
 * (M71). El nombre del servicio/profesional se muestra sólo si la RLS lo expone. */
export interface PortalTurnoView {
  id: string;
  organizationId: string;
  organizacionNombre: string | null;
  /** Slug del booking público de la org (bookingSlug del fan-out de sesión) —
   * lo usa el picker de reagenda para pedir slots REALES vía fetchSlotsPublico.
   * null si la org no está listada/viva → el portal cae al horario libre. */
  organizacionSlug: string | null;
  inicio: string;
  duracionMin: number;
  estado: string;
  modalidad: string;
  /** Ids operativos del turno (NUNCA datos clínicos): alimentan el picker de
   * slots de la reagenda con el MISMO servicio/profesional del turno. */
  servicioId: string | null;
  profesionalId: string | null;
  cutoffHoras: number;
  /** ¿El paciente puede cancelar/reagendar este turno ahora? (pura, para la UI). */
  cancelable: boolean;
}

/**
 * Lista los turnos del paciente logueado (todas sus fichas linkeadas), bajo RLS
 * (turno_select_portal, M71) — sólo devuelve turnos que cuelgan de su cuenta. Es un
 * WHITELIST de campos operativos; el SOAP es estructuralmente inalcanzable (no hay
 * policy de `sesion` para el paciente). Ordena por inicio descendente.
 */
export async function listTurnosPortal(): Promise<Result<PortalTurnoView[]>> {
  const session = await getPacienteSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // Sólo columnas operativas. Nada de `sesion`. El paciente NO es member ⇒ no puede
  // leer `organization` (org_select_own, M02), así que el nombre de la org sale del
  // fan-out de la sesión (mismo dato que ve /portal) y el cutoff del helper DEFINER
  // portal_cancel_cutoff (RPC), no de un embed que la RLS devolvería NULL.
  const { data, error } = await supabase
    .from("turno")
    .select(
      "id, organization_id, inicio, duracion_min, estado, modalidad, servicio_id, profesional_id",
    )
    .order("inicio", { ascending: false });

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, "No se pudieron listar tus turnos.", error.message);
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Nombre + slug reservable de la org por id, desde el fan-out de la sesión (P3).
  const nombrePorOrg = new Map<string, string | null>();
  const slugPorOrg = new Map<string, string | null>();
  for (const p of session.data.pacientes) {
    nombrePorOrg.set(p.organizationId, p.organizacionNombre);
    slugPorOrg.set(p.organizationId, p.bookingSlug);
  }

  // Cutoff por org distinta, resuelto una vez cada uno vía el helper DEFINER.
  const orgIds = Array.from(new Set(rows.map((r) => r.organization_id as string)));
  const cutoffPorOrg = new Map<string, number>();
  await Promise.all(
    orgIds.map(async (orgId) => {
      const { data: c } = await supabase.rpc("portal_cancel_cutoff", { p_org: orgId });
      cutoffPorOrg.set(
        orgId,
        typeof c === "number" ? c : PORTAL_CANCEL_CUTOFF_HORAS_DEFAULT,
      );
    }),
  );

  const now = Date.now();
  const out = rows.map((r): PortalTurnoView => {
    const orgId = r.organization_id as string;
    const cutoffHoras = cutoffPorOrg.get(orgId) ?? PORTAL_CANCEL_CUTOFF_HORAS_DEFAULT;
    const cancelable = puedeCancelarPaciente({
      estado: r.estado as string,
      inicioMs: new Date(r.inicio as string).getTime(),
      nowMs: now,
      cutoffHoras,
    }).ok;
    return {
      id: r.id as string,
      organizationId: orgId,
      organizacionNombre: nombrePorOrg.get(orgId) ?? null,
      organizacionSlug: slugPorOrg.get(orgId) ?? null,
      inicio: r.inicio as string,
      duracionMin: r.duracion_min as number,
      estado: r.estado as string,
      modalidad: (r.modalidad as string | null) ?? "presencial",
      servicioId: (r.servicio_id as string | null) ?? null,
      profesionalId: (r.profesional_id as string | null) ?? null,
      cutoffHoras,
      cancelable,
    };
  });

  return ok(out);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Acciones del portal
// ═══════════════════════════════════════════════════════════════════════════════

const cancelarSchema = z.object({ turnoId: z.string().uuid() });

/**
 * Cancela un turno del paciente logueado. RLS-enforced end-to-end:
 *   1. Sesión de portal (paciente_cuenta viva).
 *   2. SELECT del turno POR EL CLIENTE ANON — la policy turno_select_portal (M71)
 *      sólo devuelve turnos que cuelgan de la cuenta del paciente. Si no es suyo →
 *      0 filas → not_found (anti-IDOR: nunca confiamos en el turnoId a secas).
 *   3. Pre-check de estado + ventana (pura) para un mensaje claro.
 *   4. UPDATE estado→CANCELADO POR EL CLIENTE ANON — la policy turno_cancel_portal
 *      + el trigger-guard M84 son la verdad; el update devuelve 0 filas si la RLS
 *      lo rechaza (ventana/propiedad) y el guard RAISE 42501 (→ forbidden) si se
 *      intenta algo fuera de la regla.
 */
export async function cancelarTurnoPortal(input: {
  turnoId: string;
}): Promise<Result<{ turnoId: string }>> {
  const parsed = cancelarSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Turno inválido.", parsed.error.message);
  }

  const session = await getPacienteSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // 2. El turno, leído bajo RLS del paciente (turno_select_portal, M71 — sólo lo
  //    ve si es suyo). NO embebemos `organization`: el paciente no es member y no
  //    puede leerla (org_select_own, M02). El cutoff sale del helper DEFINER (RPC).
  const { data: turno, error: selErr } = await supabase
    .from("turno")
    .select("id, estado, inicio, organization_id, profesional_id")
    .eq("id", parsed.data.turnoId)
    .maybeSingle();

  if (selErr) {
    const mapped = mapSupabaseError(selErr);
    return err(mapped.code, mapped.message, selErr.message);
  }
  if (!turno) {
    return err("not_found", "No encontramos ese turno.");
  }

  // 3. Cutoff de la org vía el helper DEFINER (una sola fuente de verdad con la
  //    policy y el trigger-guard). Pre-check pura (estado + ventana) → mensaje
  //    accionable antes del UPDATE. Si la RPC falla, caemos al default (el
  //    trigger-guard sigue siendo la verdad, así que un default optimista sólo
  //    afectaría el mensaje, no la seguridad).
  const { data: cutoffRaw } = await supabase.rpc("portal_cancel_cutoff", {
    p_org: turno.organization_id as string,
  });
  const cutoffHoras =
    typeof cutoffRaw === "number" ? cutoffRaw : PORTAL_CANCEL_CUTOFF_HORAS_DEFAULT;

  const decision = puedeCancelarPaciente({
    estado: turno.estado as string,
    inicioMs: new Date(turno.inicio as string).getTime(),
    nowMs: Date.now(),
    cutoffHoras,
  });
  if (!decision.ok) {
    if (decision.reason === "estado") {
      return err(
        "transition_invalid",
        "Este turno ya no se puede cancelar desde el portal. Comunicate con el consultorio.",
      );
    }
    return err(
      "forbidden",
      `Ya pasó la ventana para cancelar en línea (hasta ${cutoffHoras} h antes). Llamá al consultorio.`,
    );
  }

  // 4. UPDATE estado→CANCELADO bajo RLS. El .eq('estado', ...) hace un CAS suave
  //    (si otro cambió el estado en el medio, 0 filas). turno_cancel_portal (USING
  //    ventana + propiedad, WITH CHECK estado=CANCELADO) y el trigger-guard son la
  //    frontera dura; acá sólo pedimos el cambio permitido.
  const { data: updated, error: updErr } = await supabase
    .from("turno")
    .update({ estado: "CANCELADO", atendiendo_desde: null })
    .eq("id", parsed.data.turnoId)
    .in("estado", ESTADOS_CANCELABLES_PACIENTE as unknown as string[])
    .select("id");

  if (updErr) {
    const mapped = mapSupabaseError(updErr);
    // El trigger-guard RAISE con ERRCODE 42501 → mapSupabaseError lo mapea a
    // 'forbidden' (mensaje genérico); lo enriquecemos para el portal.
    if (mapped.code === "forbidden") {
      return err(
        "forbidden",
        "No se pudo cancelar el turno (fuera de ventana o estado no permitido).",
        updErr.message,
      );
    }
    return err(mapped.code, mapped.message, updErr.message);
  }
  if (!updated || updated.length === 0) {
    // RLS lo rechazó (ventana/propiedad) o el estado cambió entre el select y el
    // update. No revelamos cuál — mensaje neutro.
    return err(
      "conflict",
      "No se pudo cancelar el turno. Actualizá la página e intentá de nuevo.",
    );
  }

  // 5. Side-effects de la cancelación — espejo de transitionTurno(→CANCELADO) y
  //    del 1-click público. Sin esto el UPDATE quedaba huérfano: el evento
  //    seguía VIVO en el Google Calendar del profesional (que veía el hueco
  //    ocupado y no lo reofrecía, mientras el booking público sí lo liberaba →
  //    dos pacientes a la misma hora) y los recordatorios pendientes salían
  //    igual para un turno que ya no existe.
  //
  //    Van por el SERVICE client: `integration` y `recordatorio_job` no tienen
  //    policy para el paciente (el anon leería 0 filas y los side-effects serían
  //    no-ops silenciosos). Post-respuesta y fail-safe, con el captureException
  //    DENTRO del callback: un side-effect que falla no revierte la cancelación
  //    —el turno YA está cancelado— pero tampoco se pierde en silencio.
  const turnoId = parsed.data.turnoId;
  const organizationId = turno.organization_id as string;
  const profesionalMemberId = (turno.profesional_id as string | null) ?? null;
  const service = createSupabaseServiceClient();

  runAfterResponse(() =>
    cancelRecordatoriosForTurno(turnoId).catch(async (e) => {
      const { captureException } = await import("@sentry/nextjs");
      captureException(e, {
        tags: { component: "portal-turnos", op: "cancelRecordatorios" },
        extra: { turnoId, organizationId },
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
      }).catch(async (e) => {
        const { captureException } = await import("@sentry/nextjs");
        captureException(e, {
          tags: { component: "portal-turnos", op: "cancelTurnoEnGoogle" },
          extra: { turnoId, organizationId },
        });
      }),
    );
  }

  // Aviso al profesional: hasta acá el paciente liberaba el turno EN SILENCIO y
  // el consultorio se enteraba al abrir el calendario (o no se enteraba).
  runAfterResponse(() =>
    notifyTurnoCanceladoPorPaciente({
      client: service,
      turnoId,
      organizationId,
      profesionalId: profesionalMemberId,
    }).catch(async (e: unknown) => {
      const { captureException } = await import("@sentry/nextjs");
      captureException(e, {
        tags: { component: "portal-turnos", op: "notifyTurnoCancelado" },
        extra: { turnoId, organizationId },
      });
    }),
  );

  return ok({ turnoId: parsed.data.turnoId });
}

// ─── Reserva / reagenda como pedido PENDIENTE ─────────────────────────────────

/** Traduce el motivo del rechazo puro al `Result` que ve el paciente. */
function errorHorarioPortal(reason: RechazoHorarioPortal): Result<never> {
  if (reason === "pasado") {
    return err("validation", "Elegí un horario futuro.");
  }
  if (reason === "horizonte") {
    return err(
      "validation",
      `Sólo podemos tomar solicitudes hasta ${PORTAL_HORIZONTE_DIAS} días adelante. Elegí una fecha más cercana.`,
    );
  }
  return err(
    "conflict",
    "Ese horario no está disponible en la agenda. Elegí uno de los horarios que ofrece el consultorio.",
  );
}

/**
 * La grilla que el profesional realmente ofrece para ese horario, o `null` si
 * no es computable. `null` NO es un error: es el mismo estado en el que el
 * picker del portal se degrada al horario libre (ReagendaPicker cae a "manual"
 * cuando fetchSlotsPublico no puede responder). Gatear contra una grilla que la
 * UI nunca mostró rechazaría solicitudes legítimas, así que el server espeja
 * exactamente las condiciones del picker:
 *
 *   - org viva y listada (bookingSlugDeOrg — es el predicado con el que el
 *     portal decide si hay link público /book/{slug} para pedir slots),
 *   - servicio existente y activo (la duración del servicio define la grilla:
 *     usamos ESA, no la del turno, para que los slots caigan en los mismos
 *     instantes que vio el paciente),
 *   - profesional resuelto (sin profesional no hay agenda que consultar),
 *   - profesional con disponibilidad activa cargada (si nunca configuró
 *     horarios, la grilla está vacía por falta de setup, no porque el día esté
 *     lleno: gatear ahí dejaría al consultorio sin reagenda por el portal).
 *
 * Un error de DB SÍ es error (fail-closed): preferimos rechazar la solicitud a
 * dejar pasar un horario sin validar por un fallo transitorio.
 */
async function slotsOfrecidosPortal(
  service: ServiceClient,
  input: {
    organizationId: string;
    profesionalId: string | null;
    servicioId: string | null;
    inicioMs: number;
  },
): Promise<Result<Slot[] | null>> {
  if (!input.profesionalId || !input.servicioId) return ok(null);

  const { data: org, error: orgErr } = await service
    .from("organization")
    .select("slug, opt_out_public_listing, deleted_at, slot_margen_min")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (orgErr) {
    return err("db_error", "No pudimos validar el horario. Probá de nuevo.", orgErr.message);
  }
  if (
    !org ||
    bookingSlugDeOrg({
      slug: (org.slug as string | null) ?? null,
      optOutPublicListing: Boolean(org.opt_out_public_listing),
      deletedAt: (org.deleted_at as string | null) ?? null,
    }) === null
  ) {
    return ok(null);
  }

  const { data: servicio, error: servErr } = await service
    .from("servicio")
    .select("duracion_min")
    .eq("id", input.servicioId)
    .eq("organization_id", input.organizationId)
    .eq("activo", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (servErr) {
    return err("db_error", "No pudimos validar el horario. Probá de nuevo.", servErr.message);
  }
  if (!servicio) return ok(null);

  const { data: disp, error: dispErr } = await service
    .from("disponibilidad_profesional")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("member_id", input.profesionalId)
    .eq("activa", true)
    .limit(1);
  if (dispErr) {
    return err("db_error", "No pudimos validar el horario. Probá de nuevo.", dispErr.message);
  }
  if (!disp || disp.length === 0) return ok(null);

  const duracionMin = servicio.duracion_min as number;
  try {
    // Ventana mínima que contiene el horario pedido: la grilla se deriva por día
    // AR y por franja, así que un slot ofrecido en la ventana de 14 días del
    // picker también aparece acá. Mismo recorte que hace createPedidoPublico.
    const slots = await getSlotsDisponibles({
      organizationId: input.organizationId,
      profesionalId: input.profesionalId,
      duracionMin,
      rangeStart: new Date(),
      rangeEnd: new Date(input.inicioMs + duracionMin * 60_000 + 60_000),
      margenMin: (org.slot_margen_min as number | null) ?? 0,
    });
    return ok(slots);
  } catch (e) {
    if (e instanceof AvailabilityDbError) {
      // `e.message` es el mensaje CRUDO de Postgres (availability.ts lo
      // construye con `dispsErr.message` y hermanos), y el `message` de un
      // Result es lo que se le muestra al usuario. Un paciente del portal
      // intentando sacar turno terminaba leyendo un error de base de datos en
      // inglés. El crudo se conserva en `detail`, que es donde va a parar el
      // log y nunca a la pantalla.
      return err(
        "db_error",
        "No pudimos consultar los horarios disponibles. Probá de nuevo en un momento.",
        e.message,
      );
    }
    throw e;
  }
}

/**
 * Gate de horario de TODA solicitud del portal (reserva nueva y reagenda).
 * Antes de esto, lo único que se validaba era "el instante es futuro": un POST
 * directo al server action podía encolar pedidos a cualquier hora inventada, y
 * cada pedido PENDIENTE bloquea su rango en `slot_ocupado` y en la grilla
 * pública → un solo paciente podía tapar la agenda y hacer que el booking
 * público rechazara reservas reales.
 *
 * Capas: horizonte + grilla (`decidirHorarioPortal`) y, cuando la grilla no es
 * computable, el piso mínimo de no pisar un turno vivo (`propuestaSolapa`, con
 * el turno que se está moviendo excluido de su propio conflicto).
 */
async function validarHorarioPortal(
  service: ServiceClient,
  input: {
    organizationId: string;
    profesionalId: string | null;
    servicioId: string | null;
    /** Duración del pedido resultante — define el rango del chequeo de solape. */
    duracionMin: number;
    inicioIso: string;
    /** Turno que se está reagendando: no cuenta como conflicto de sí mismo. */
    excludeTurnoId?: string | null;
  },
): Promise<Result<void>> {
  const inicioMs = new Date(input.inicioIso).getTime();
  const nowMs = Date.now();

  // Capas 1 y 2 antes de tocar la DB: una fecha del año 9999 no merece queries.
  const tiempo = decidirHorarioPortal({ inicioMs, nowMs, slotsOfrecidos: null });
  if (!tiempo.ok) return errorHorarioPortal(tiempo.reason);

  const grilla = await slotsOfrecidosPortal(service, {
    organizationId: input.organizationId,
    profesionalId: input.profesionalId,
    servicioId: input.servicioId,
    inicioMs,
  });
  if (!grilla.ok) return grilla;

  const decision = decidirHorarioPortal({ inicioMs, nowMs, slotsOfrecidos: grilla.data });
  if (!decision.ok) return errorHorarioPortal(decision.reason);
  if (grilla.data !== null) return ok(undefined);

  // Sin grilla: al menos exigimos que el rango no pise un turno vivo. Scope por
  // profesional cuando lo hay (una clínica no debe rechazar el horario del
  // cardiólogo porque la psicóloga está ocupada); org-wide sólo cuando el
  // pedido todavía no tiene profesional asignado (bloqueo conservador, mismo
  // criterio que el `profesional_id IS NULL` del RPC slot_ocupado).
  const finMs = inicioMs + Math.max(0, input.duracionMin) * 60_000;
  let query = service
    .from("turno")
    .select("id, inicio, duracion_min")
    .eq("organization_id", input.organizationId)
    .in("estado", ESTADOS_TURNO_VIVO as unknown as string[])
    .is("deleted_at", null)
    .gte("inicio", new Date(inicioMs - LOOKBACK_TURNO_LARGO_MS).toISOString())
    .lt("inicio", new Date(finMs).toISOString())
    .limit(50);
  if (input.profesionalId) query = query.eq("profesional_id", input.profesionalId);

  const { data: vivos, error: vivosErr } = await query;
  if (vivosErr) {
    return err("db_error", "No pudimos validar el horario. Probá de nuevo.", vivosErr.message);
  }

  const solapa = propuestaSolapa(
    inicioMs,
    finMs,
    ((vivos ?? []) as Array<{ id: string; inicio: string; duracion_min: number }>).map((t) => {
      const start = new Date(t.inicio).getTime();
      return { id: t.id, inicioMs: start, finMs: start + t.duracion_min * 60_000 };
    }),
    input.excludeTurnoId ?? null,
  );
  if (solapa) {
    return err(
      "conflict",
      "Ese horario se superpone con otro turno. Elegí otro y el consultorio lo confirma.",
    );
  }
  return ok(undefined);
}

/**
 * Cupo por cuenta de las solicitudes del portal (reserva + reagenda comparten
 * scope: si no, el mismo paciente hacía 5 de cada una). Fail-closed en prod
 * cuando Upstash está provisionado — ver lib/security/rate-limit.ts.
 */
async function limitarSolicitudesPortal(cuentaId: string): Promise<Result<void>> {
  const rl = await limitByKey(
    "portal.turno.solicitar",
    cuentaId,
    PORTAL_SOLICITUDES_MAX_POR_HORA,
  );
  if (!rl.ok) {
    return err(
      "forbidden",
      `Enviaste demasiadas solicitudes seguidas. ${formatResetMessage(rl.resetIn)}`,
    );
  }
  return ok(undefined);
}

const reagendarSchema = z.object({
  turnoId: z.string().uuid(),
  nuevoInicio: z.string().datetime({ offset: true }),
  motivo: z.string().max(2000).optional(),
});

/**
 * Solicita reagendar un turno del paciente: NO mueve el turno (eso lo confirma el
 * clínico), sino que encola un `pedido` PENDIENTE con el nuevo horario propuesto,
 * atado a la MISMA ficha/servicio/profesional del turno original. El clínico lo ve
 * en su bandeja y confirma (promoteo → turno CONFIRMADO), o el auto-confirm lo hace
 * si la org lo tiene activo. El turno original NO se toca acá (el paciente puede
 * cancelarlo por separado, o el clínico lo reagenda al confirmar).
 *
 * RLS-enforced: el turno se lee bajo turno_select_portal (sólo si es suyo). El
 * pedido se inserta bajo pedido_insert_portal (WITH CHECK paciente_owns + org
 * coherente + PENDIENTE). El paciente_id sale del turno propio, NUNCA de input.
 */
export async function solicitarReagendaPortal(
  input: z.infer<typeof reagendarSchema>,
): Promise<Result<{ pedidoId: string }>> {
  const parsed = reagendarSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de la solicitud inválidos.", parsed.error.message);
  }

  const session = await getPacienteSession();
  if (!session.ok) return session;

  const limite = await limitarSolicitudesPortal(session.data.cuentaId);
  if (!limite.ok) return limite;

  const supabase = await createSupabaseServerClient();

  // El turno original, bajo RLS (sólo si es suyo). De acá salen paciente/servicio/
  // profesional/org/duración — NUNCA del cliente (anti-IDOR).
  const { data: turno, error: selErr } = await supabase
    .from("turno")
    .select("id, estado, paciente_id, servicio_id, profesional_id, organization_id, duracion_min, precio_cents")
    .eq("id", parsed.data.turnoId)
    .maybeSingle();

  if (selErr) {
    const mapped = mapSupabaseError(selErr);
    return err(mapped.code, mapped.message, selErr.message);
  }
  if (!turno) {
    return err("not_found", "No encontramos ese turno.");
  }
  // Sólo tiene sentido reagendar un turno todavía "vivo" (agendado/confirmado). Un
  // turno cerrado/cancelado/atendido no se reagenda desde el portal.
  if (!(ESTADOS_CANCELABLES_PACIENTE as readonly string[]).includes(turno.estado as string)) {
    return err(
      "transition_invalid",
      "Este turno ya no se puede reagendar desde el portal. Comunicate con el consultorio.",
    );
  }
  // El horario propuesto: futuro, dentro del horizonte y —cuando la grilla del
  // profesional es computable— uno de los slots que esa grilla ofrece. El turno
  // que se está moviendo se excluye del chequeo de solape: sigue vivo hasta que
  // el clínico confirme, y no debe bloquear su propio horario nuevo.
  const horario = await validarHorarioPortal(createSupabaseServiceClient(), {
    organizationId: turno.organization_id as string,
    profesionalId: (turno.profesional_id as string | null) ?? null,
    servicioId: (turno.servicio_id as string | null) ?? null,
    duracionMin: turno.duracion_min as number,
    inicioIso: parsed.data.nuevoInicio,
    excludeTurnoId: turno.id as string,
  });
  if (!horario.ok) return horario;

  return await insertarPedidoPortal(supabase, {
    pacienteId: turno.paciente_id as string,
    organizationId: turno.organization_id as string,
    servicioId: (turno.servicio_id as string | null) ?? null,
    profesionalId: (turno.profesional_id as string | null) ?? null,
    fechaPropuesta: parsed.data.nuevoInicio,
    duracionMin: turno.duracion_min as number,
    precioCents: (turno.precio_cents as number | null) ?? null,
    motivo: parsed.data.motivo ?? null,
  });
}

const nuevaReservaSchema = z.object({
  pacienteId: z.string().uuid(),
  servicioId: z.string().uuid(),
  inicio: z.string().datetime({ offset: true }),
  motivo: z.string().max(2000).optional(),
});

/**
 * Solicita un turno NUEVO (no reagenda) desde el portal: encola un `pedido`
 * PENDIENTE atado a una ficha `paciente` propia. El paciente_id llega por
 * argumento PERO se valida contra su sesión (debe estar en session.pacientes) y la
 * RLS del INSERT (pedido_insert_portal: paciente_owns) lo re-valida — doble gate
 * anti-IDOR.
 *
 * Duración/precio salen del servicio elegido, leído con el SERVICE client
 * scopeado a la org de la ficha (el paciente NO tiene policy sobre `servicio` —
 * la lectura anon devolvería siempre 0 filas). Mismo patrón que el booking
 * público (createPedidoPublico): service client + filtros de org explícitos y
 * obligatorios. El profesional destino se resuelve vía `servicio_profesional`
 * (M:N, M02): exactamente 1 vinculado válido → ese; 0 o varios → regla del
 * booking público sin elección (resolveProfesionalPublico) ADAPTADA al portal:
 * con varios colegiados el pedido entra con profesional_id NULL y el staff lo
 * asigna al aceptar (adaptarFallbackOrgPortal — sin picker acá, el err de
 * "elegí profesional" sería un dead-end). El INSERT del pedido sigue saliendo
 * por el cliente ANON bajo RLS (Gate 2 intacto).
 */
export async function solicitarTurnoPortal(
  input: z.infer<typeof nuevaReservaSchema>,
): Promise<Result<{ pedidoId: string }>> {
  const parsed = nuevaReservaSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de la solicitud inválidos.", parsed.error.message);
  }

  const session = await getPacienteSession();
  if (!session.ok) return session;

  const limite = await limitarSolicitudesPortal(session.data.cuentaId);
  if (!limite.ok) return limite;

  // Gate 1 (app): el paciente_id debe ser una de SUS fichas linkeadas. La RLS del
  // INSERT lo re-valida (Gate 2). Sin esto, un input arbitrario iría directo al
  // INSERT y sólo lo pararía la RLS — igual seguro, pero el mensaje sería peor.
  const ficha = session.data.pacientes.find((p) => p.pacienteId === parsed.data.pacienteId);
  if (!ficha) {
    return err("not_found", "Esa ficha no está vinculada a tu cuenta.");
  }
  // Pre-check barato (puro): fecha pasada o fuera del horizonte se rechaza antes
  // de gastar queries. El gate completo —contra la grilla real— corre abajo, una
  // vez resuelto el profesional destino.
  const tiempo = decidirHorarioPortal({
    inicioMs: new Date(parsed.data.inicio).getTime(),
    nowMs: Date.now(),
    slotsOfrecidos: null,
  });
  if (!tiempo.ok) return errorHorarioPortal(tiempo.reason);

  const supabase = await createSupabaseServerClient();

  // El servicio, leído con el SERVICE client (RLS no aplica: el paciente no tiene
  // policy sobre `servicio` y el anon devolvería 0 filas SIEMPRE) pero scopeado
  // explícitamente a la org de la ficha YA validada contra la sesión — mismo
  // patrón que createPedidoPublico (app/(public)/book/[slug]/actions.ts). Mismos
  // filtros que allá: activo y no borrado. Un servicio inexistente/inactivo/de
  // otra org es un error real del pedido, no una degradación silenciosa.
  const service = createSupabaseServiceClient();
  const { data: servicio, error: servErr } = await service
    .from("servicio")
    .select("id, duracion_min, precio_cents")
    .eq("id", parsed.data.servicioId)
    .eq("organization_id", ficha.organizationId)
    .eq("activo", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (servErr) {
    const mapped = mapSupabaseError(servErr);
    return err(mapped.code, "No se pudo validar el servicio elegido.", servErr.message);
  }
  if (!servicio) {
    return err("not_found", "Servicio no disponible.");
  }

  // Profesional destino vía servicio_profesional (M:N, M02 — `servicio` NO tiene
  // columna profesional_id). Vínculos activos cuyo member sigue siendo colegiado
  // vivo (mismo predicado que resolveProfesionalPublico; el !inner filtra por el
  // join). limit(2) alcanza para distinguir 0 / 1 / varios; ORDER BY member_id
  // para determinismo.
  const { data: vinculados, error: vincErr } = await service
    .from("servicio_profesional")
    .select("member_id, member!inner(id)")
    .eq("servicio_id", parsed.data.servicioId)
    .eq("organization_id", ficha.organizationId)
    .eq("activo", true)
    .eq("member.es_colegiado", true)
    .is("member.deleted_at", null)
    .order("member_id", { ascending: true })
    .limit(2);

  if (vincErr) {
    const mapped = mapSupabaseError(vincErr);
    return err(
      mapped.code,
      "No se pudo resolver el profesional del servicio.",
      vincErr.message,
    );
  }

  const decision = decideProfesionalPorServicio(
    ((vinculados ?? []) as Array<{ member_id: string }>).map((v) => v.member_id),
  );

  let profesionalId: string | null;
  if (decision.kind === "usar") {
    profesionalId = decision.profesionalId;
  } else {
    // 0 o varios vinculados → resolución org-level como el booking público sin
    // elección explícita: único colegiado de la org → ese; ninguno → err
    // not_found (la org no puede recibir reservas). Con VARIOS colegiados el
    // público devuelve err("validation") y su wizard muestra el picker; acá NO
    // hay picker (nuevaReservaSchema no pide profesionalId), así que ese err
    // sería un dead-end irrecuperable — se degrada a profesional_id NULL y el
    // staff asigna al aceptar (ver adaptarFallbackOrgPortal).
    const profRes = adaptarFallbackOrgPortal(
      await resolveProfesionalPublico(service, {
        organizationId: ficha.organizationId,
        profesionalId: null,
      }),
    );
    if (!profRes.ok) return profRes;
    profesionalId = profRes.data;
  }

  // El horario tiene que ser uno de los que la agenda del profesional ofrece
  // (misma grilla que el booking público). Sin profesional resuelto no hay
  // grilla que consultar y el gate cae al chequeo de solape.
  const horario = await validarHorarioPortal(service, {
    organizationId: ficha.organizationId,
    profesionalId,
    servicioId: parsed.data.servicioId,
    duracionMin: servicio.duracion_min as number,
    inicioIso: parsed.data.inicio,
  });
  if (!horario.ok) return horario;

  return await insertarPedidoPortal(supabase, {
    pacienteId: parsed.data.pacienteId,
    organizationId: ficha.organizationId,
    servicioId: parsed.data.servicioId,
    profesionalId,
    fechaPropuesta: parsed.data.inicio,
    duracionMin: servicio.duracion_min as number,
    precioCents: (servicio.precio_cents as number | null) ?? null,
    motivo: parsed.data.motivo ?? null,
  });
}

/**
 * Core compartido: inserta el `pedido` PENDIENTE bajo la RLS del paciente
 * (pedido_insert_portal). El nombre del solicitante se resuelve leyendo la PII de
 * la ficha propia (paciente_identidad, readable por el paciente vía M71) para
 * satisfacer nombre_cifrado NOT NULL — pero como el pedido lleva paciente_id, el
 * promoteo del clínico REUSA la ficha e IGNORA estos campos (ver
 * promotePedidoToTurno). canal 'PORTAL' evita el constraint WEB-consent de M39.
 */
async function insertarPedidoPortal(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: {
    pacienteId: string;
    organizationId: string;
    servicioId: string | null;
    profesionalId: string | null;
    fechaPropuesta: string;
    duracionMin: number;
    precioCents: number | null;
    motivo: string | null;
  },
): Promise<Result<{ pedidoId: string }>> {
  // Nombre para nombre_cifrado (NOT NULL). Leemos la identidad de la ficha propia
  // (RLS M71 la deja leer). Si por algún motivo no se puede descifrar, caemos a un
  // placeholder — el pedido lleva paciente_id, así que el promoteo reusa la ficha
  // y el nombre del pedido es sólo un rótulo de bandeja.
  const { data: pac } = await supabase
    .from("paciente")
    .select("identidad_id, paciente_identidad(nombre_cifrado, apellido_cifrado, telefono_cifrado)")
    .eq("id", input.pacienteId)
    .maybeSingle();

  const idEmbedRaw = (pac as { paciente_identidad?: unknown } | null)?.paciente_identidad;
  const idEmbed = Array.isArray(idEmbedRaw) ? idEmbedRaw[0] : idEmbedRaw;
  const nombre = tryDecrypt(
    (idEmbed as { nombre_cifrado?: Buffer | null } | undefined)?.nombre_cifrado ?? null,
    "paciente_identidad.nombre",
  );
  const apellido = tryDecrypt(
    (idEmbed as { apellido_cifrado?: Buffer | null } | undefined)?.apellido_cifrado ?? null,
    "paciente_identidad.apellido",
  );
  const telefono = tryDecrypt(
    (idEmbed as { telefono_cifrado?: Buffer | null } | undefined)?.telefono_cifrado ?? null,
    "paciente_identidad.telefono",
  );
  const nombreFull = [nombre, apellido].filter(Boolean).join(" ").trim() || "Paciente del portal";

  const { data: pedido, error } = await supabase
    .from("pedido")
    .insert({
      organization_id: input.organizationId,
      canal: "PORTAL",
      estado: "PENDIENTE",
      paciente_id: input.pacienteId,
      nombre_cifrado: encryptColumn(nombreFull)!,
      telefono_cifrado: encryptColumn(telefono),
      fecha_propuesta: input.fechaPropuesta,
      duracion_min: input.duracionMin,
      servicio_id: input.servicioId,
      profesional_id: input.profesionalId,
      motivo_cifrado: encryptColumn(input.motivo),
      precio_cents: input.precioCents,
    })
    .select("id")
    .single();

  if (error || !pedido) {
    const mapped = mapSupabaseError(error ?? { message: "no pedido" });
    return err(mapped.code, "No se pudo registrar tu solicitud.", error?.message);
  }
  return ok({ pedidoId: pedido.id });
}
