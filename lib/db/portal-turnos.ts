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
 */

import { z } from "zod";

import { encryptColumn, tryDecrypt } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getPacienteSession } from "./paciente-session";

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
  inicio: string;
  duracionMin: number;
  estado: string;
  modalidad: string;
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
    .select("id, organization_id, inicio, duracion_min, estado, modalidad")
    .order("inicio", { ascending: false });

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, "No se pudieron listar tus turnos.", error.message);
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Nombre de la org por id, desde el fan-out de la sesión (P3).
  const nombrePorOrg = new Map<string, string | null>();
  for (const p of session.data.pacientes) {
    nombrePorOrg.set(p.organizationId, p.organizacionNombre);
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
      inicio: r.inicio as string,
      duracionMin: r.duracion_min as number,
      estado: r.estado as string,
      modalidad: (r.modalidad as string | null) ?? "presencial",
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
    .select("id, estado, inicio, organization_id")
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

  return ok({ turnoId: parsed.data.turnoId });
}

// ─── Reserva / reagenda como pedido PENDIENTE ─────────────────────────────────

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
  // El nuevo horario debe ser futuro.
  const nuevoInicioMs = new Date(parsed.data.nuevoInicio).getTime();
  if (!(nuevoInicioMs > Date.now())) {
    return err("validation", "Elegí un horario futuro para reagendar.");
  }

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
 * anti-IDOR. Duración/precio/profesional salen del servicio elegido (validado como
 * de la org de esa ficha).
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

  // Gate 1 (app): el paciente_id debe ser una de SUS fichas linkeadas. La RLS del
  // INSERT lo re-valida (Gate 2). Sin esto, un input arbitrario iría directo al
  // INSERT y sólo lo pararía la RLS — igual seguro, pero el mensaje sería peor.
  const ficha = session.data.pacientes.find((p) => p.pacienteId === parsed.data.pacienteId);
  if (!ficha) {
    return err("not_found", "Esa ficha no está vinculada a tu cuenta.");
  }
  const inicioMs = new Date(parsed.data.inicio).getTime();
  if (!(inicioMs > Date.now())) {
    return err("validation", "Elegí un horario futuro.");
  }

  const supabase = await createSupabaseServerClient();

  // El servicio, validado contra la org de la ficha. La policy servicio_select_org
  // (M09) es clinic-scoped (no la ve el paciente por RLS), así que leemos el
  // servicio con el mismo cliente anon PERO no dependemos de verlo: si la policy
  // no lo devuelve, no podemos derivar duración/precio → pedimos que el clínico
  // fije el servicio. Para robustez, resolvemos el servicio y sus datos; si la RLS
  // no lo expone, encolamos con la duración default y el clínico ajusta.
  const { data: servicio } = await supabase
    .from("servicio")
    .select("id, organization_id, duracion_min, precio_cents, profesional_id")
    .eq("id", parsed.data.servicioId)
    .eq("organization_id", ficha.organizationId)
    .maybeSingle();

  // profesional destino: el del servicio si lo trae; sino, el principal de la
  // ficha; sino null (el clínico lo resuelve al aceptar — resolverProfesionalDelPedido).
  const servicioProfesionalId =
    (servicio as { profesional_id?: string | null } | null)?.profesional_id ?? null;

  return await insertarPedidoPortal(supabase, {
    pacienteId: parsed.data.pacienteId,
    organizationId: ficha.organizationId,
    servicioId: parsed.data.servicioId,
    profesionalId: servicioProfesionalId,
    fechaPropuesta: parsed.data.inicio,
    duracionMin: (servicio as { duracion_min?: number } | null)?.duracion_min ?? 45,
    precioCents: (servicio as { precio_cents?: number | null } | null)?.precio_cents ?? null,
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
