"use server";
import { safeLog } from "@/lib/observability/safe-log";


/**
 * Folio · /hoy · Server Actions.
 *
 * Wrapper de `transitionTurno` (lib/db/turnos.ts) con revalidación de la
 * ruta /hoy después de cada cambio de estado. Esto garantiza que los datos
 * que renderiza el Server Component padre se refresquen tras la transición.
 *
 * El Client Component aplica la transición optimistamente; esta action es
 * la fuente de verdad. Si rechaza, el cliente revierte el estado local.
 *
 * También expone el flujo de creación rápida (walk-in / agendar manual):
 *   - loadCreateTurnoMeta() devuelve servicios + pacientes recientes +
 *     colegiados activos (picker de profesional) + datos de la sesión
 *   - createTurnoAction() crea (o reutiliza) paciente + crea turno AGENDADO
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ProfesionalLite } from "@/lib/agenda/profesional";
import { createManualTurno } from "@/lib/db/manual-turno";
import { normalizarBusqueda } from "@/lib/format/busqueda";
import { err, ok, type Result } from "@/lib/db/errors";
import { aceptarPedidoConHorario } from "@/lib/db/pedidos";
import { listProfesionalesLite } from "@/lib/db/members";
import { getActiveSession } from "@/lib/db/session";
import { listPacientesDirectorio } from "@/lib/db/pacientes";
import { reagendarTurno, transitionTurno, type TransitionTurnoResult } from "@/lib/db/turnos";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EstadoTurno } from "@/lib/types";

const ESTADO_UI_TO_DB: Record<
  EstadoTurno,
  "AGENDADO" | "CONFIRMADO" | "EN_SALA" | "ATENDIENDO" | "CERRADO" | "NO_ASISTIO" | "CANCELADO" | "REAGENDADO"
> = {
  agendado: "AGENDADO",
  confirmado: "CONFIRMADO",
  en_sala: "EN_SALA",
  atendiendo: "ATENDIENDO",
  cerrado: "CERRADO",
  no_asistio: "NO_ASISTIO",
  cancelado: "CANCELADO",
  reagendado: "REAGENDADO",
};

/**
 * E1 · cobro elegido en el mini-diálogo al cerrar un turno. Espejo del
 * `cobroCierreSchema` de lib/db/turnos.ts (la validación real vive allá).
 * `pagado=false` = "quedó debiendo" → pago PENDIENTE visible en /finanzas.
 */
export interface CobroCierreActionInput {
  montoCents: number;
  metodo: "EFECTIVO" | "TRANSFERENCIA" | "MERCADOPAGO" | "TARJETA" | "OBRA_SOCIAL";
  pagado: boolean;
}

export interface TransitionTurnoActionInput {
  turnoId: string;
  to: EstadoTurno;
  duracionRealMin?: number;
  /** Solo con to === "cerrado": método/monto/estado del cobro registrado. */
  cobro?: CobroCierreActionInput;
}

/**
 * PR #118: el Result propaga `pagoRegistrado` de transitionTurno para que el
 * cliente pueda avisar cuando el turno cerró pero el cobro NO se registró
 * (cierre y pago no son atómicos — ver TransitionTurnoResult en lib/db/turnos).
 */
export async function transitionTurnoAction(
  input: TransitionTurnoActionInput,
): Promise<Result<TransitionTurnoResult>> {
  const result = await transitionTurno({
    turnoId: input.turnoId,
    to: ESTADO_UI_TO_DB[input.to],
    duracionRealMin: input.duracionRealMin,
    cobro: input.to === "cerrado" ? input.cobro : undefined,
  });

  if (result.ok) {
    revalidatePath("/hoy");
  }
  return result;
}

// ─── Reagendar turno ─────────────────────────────────────────────────────────

const reagendarTurnoActionSchema = z.object({
  operacionId: z.string().uuid(),
  turnoId: z.string().uuid(),
  nuevoInicio: z.string().datetime({ offset: true }),
  nuevaDuracionMin: z.number().int().min(5).max(480).optional(),
});

export type ReagendarTurnoActionInput = z.infer<typeof reagendarTurnoActionSchema>;

/**
 * Reagenda un turno desde el modal de /hoy: el original queda REAGENDADO y se
 * crea uno nuevo con el mismo paciente/servicio/profesional/precio en el
 * horario elegido. La sesión activa la valida `reagendarTurno` (lib/db) como
 * primer paso — igual que transitionTurnoAction delega en transitionTurno.
 *
 * M119: ambas escrituras y sus trabajos se confirman juntas. La revalidación
 * posterior no convierte una operación confirmada en un resultado incierto.
 */
export async function reagendarTurnoAction(
  input: ReagendarTurnoActionInput,
): Promise<Result<{ nuevoTurnoId: string }>> {
  const parsed = reagendarTurnoActionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del reagendado inválidos.", parsed.error.message);
  }

  const result = await reagendarTurno(parsed.data);
  if (result.ok) {
    try {
      revalidatePath("/hoy");
      revalidatePath("/calendario");
    } catch { /* El recibo confirmado conserva su resultado. */ }
  }
  return result;
}

// ─── Create turno (modal walk-in / agendar manual) ──────────────────────────

export interface ServicioPickerRow {
  id: string;
  nombre: string;
  duracionMin: number;
  precioCents: number;
}

export interface PacientePickerRow {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string | null;
}

export interface CreateTurnoMeta {
  servicios: ServicioPickerRow[];
  pacientes: PacientePickerRow[];
  /** Colegiados activos de la org — alimenta el picker de profesional. */
  profesionales: ProfesionalLite[];
  /** member.id de la sesión (default del picker si es colegiado). */
  sessionMemberId: string;
  sessionEsColegiado: boolean;
}

/**
 * Devuelve los datos necesarios para llenar el modal de creación de turno:
 * servicios activos de la org, pacientes recientes (hasta 50), colegiados
 * activos (CLINICA-3: picker de profesional, visible solo con >1) y el
 * member de la sesión para resolver el default del picker.
 *
 * Los 50 pacientes son solo las sugerencias INICIALES del typeahead (query
 * vacía + matches instantáneos): la búsqueda real sobre el directorio
 * completo la hace `searchPacientesAction` con debounce desde el modal —
 * mantener el slice evita mandar toda la PII de la org en cada apertura.
 */
export async function loadCreateTurnoMeta(): Promise<Result<CreateTurnoMeta>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  const { data: servicios, error: servErr } = await supabase
    .from("servicio")
    .select("id, nombre, duracion_min, precio_cents")
    .eq("organization_id", session.data.organizationId)
    .eq("activo", true)
    .is("deleted_at", null)
    .order("nombre");
  if (servErr) return err("db_error", "Error listando servicios.", servErr.message);

  const pacientesRes = await listPacientesDirectorio();
  if (!pacientesRes.ok) return pacientesRes;

  // Colegiados para el picker. Si la lectura falla, degradamos a lista vacía
  // con warn (mismo patrón que /hoy y /calendario): el modal sigue operable y
  // la validación server-side de createTurnoAction es el gate real.
  const profsRes = await listProfesionalesLite(session.data.organizationId);
  if (!profsRes.ok) {
    safeLog("warn", "app.app.hoy.actions.L187", { error: profsRes.error });
  }

  return ok({
    servicios: (servicios ?? []).map((s) => ({
      id: s.id as string,
      nombre: s.nombre as string,
      duracionMin: s.duracion_min as number,
      precioCents: (s.precio_cents as number) ?? 0,
    })),
    pacientes: pacientesRes.data.slice(0, 50).map((p) => ({
      id: p.id,
      nombre: p.nombre ?? "",
      apellido: p.apellido ?? "",
      telefono: p.telefono,
    })),
    profesionales: profsRes.ok ? profsRes.data : [],
    sessionMemberId: session.data.memberId,
    sessionEsColegiado: session.data.esColegiado,
  });
}

/**
 * Búsqueda del typeahead del modal de crear turno sobre el directorio
 * COMPLETO de la org (encargo C3): el modal solo recibe los últimos 50
 * pacientes en la metadata, así que en una clínica grande un paciente
 * antiguo daba "Sin resultados" e invitaba a crear un DUPLICADO de historia
 * clínica. Esta action reusa `listPacientesDirectorio` (el mismo fetcher —
 * y el mismo descifrado — que ya paga /pacientes) y matchea con
 * `normalizarBusqueda` en ambos lados, para que "jose" encuentre a "José".
 *
 * Cap de resultados en 8: es lo que el typeahead muestra — no viaja PII
 * de más al cliente. El teléfono matchea por dígitos ("351555" encuentra
 * a "+54 351 555-0199").
 */
export async function searchPacientesAction(q: string): Promise<Result<PacientePickerRow[]>> {
  const query = normalizarBusqueda(String(q ?? ""));
  if (query.length < 2) return ok([]);

  const res = await listPacientesDirectorio();
  if (!res.ok) return res;

  const digitos = query.replace(/\D/g, "");
  const matches = res.data
    .filter((p) => {
      const nombreCompleto = normalizarBusqueda(`${p.nombre ?? ""} ${p.apellido ?? ""}`);
      if (nombreCompleto.includes(query)) return true;
      if (digitos.length >= 3) {
        const tel = (p.telefono ?? "").replace(/\D/g, "");
        if (tel.includes(digitos)) return true;
      }
      return false;
    })
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      nombre: p.nombre ?? "",
      apellido: p.apellido ?? "",
      telefono: p.telefono,
    }));

  return ok(matches);
}

const createTurnoActionSchema = z
  .object({
    operacionId: z.string().uuid(),
    pacienteId: z.string().uuid().optional(),
    pacienteNuevo: z
      .object({
        nombre: z.string().min(1).max(80),
        apellido: z.string().min(1).max(80),
        telefono: z.string().min(6).max(30),
        email: z.string().email().optional().or(z.literal("")),
      })
      .optional(),
    servicioId: z.string().uuid(),
    /**
     * Profesional destino elegido en el picker (CLINICA-3). Opcional: si no
     * viene y la sesión es colegiada, se usa la sesión; si no viene y la
     * sesión NO es colegiada (secretaria), err("validation") — nunca más el
     * hardcodeo silencioso a session.memberId.
     */
    profesionalId: z.string().uuid().optional(),
    inicio: z.string().datetime({ offset: true }),
    duracionMin: z.number().int().min(5).max(480),
    origen: z.enum(["MANUAL", "WALK_IN"]).default("MANUAL"),
    /**
     * Pedido de origen cuando el turno manual nace desde el PedidoModal
     * ("crear turno manual" para un pedido de la bandeja). Si viene, tras
     * crear el turno el pedido se marca CONFIRMADO — antes quedaba PENDIENTE
     * para siempre (dead-end del flujo de pedidos entrantes).
     */
    pedidoId: z.string().uuid().optional(),
  })
  .refine((d) => (d.pacienteId != null) !== (d.pacienteNuevo != null), {
    message: "Hay que elegir un paciente existente o crear uno nuevo.",
  });

export type CreateTurnoActionInput = z.infer<typeof createTurnoActionSchema>;

/** El paciente y el turno se confirman juntos mediante un intento durable. */
export async function createTurnoAction(
  input: CreateTurnoActionInput,
): Promise<Result<{ turnoId: string; pacienteId: string }>> {
  const parsed = createTurnoActionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del turno inválidos.", parsed.error.message);
  }
  const d = parsed.data;
  if (d.pedidoId) {
    // A request owns its identity; the manual picker cannot adopt another patient.
    const converted = await aceptarPedidoConHorario(d.pedidoId, {
      fechaHora: d.inicio, servicioId: d.servicioId, profesionalId: d.profesionalId,
      expectedPacienteId: d.pacienteId, pacienteNuevo: d.pacienteNuevo,
    });
    if (converted.ok) { revalidatePath("/hoy"); revalidatePath("/calendario"); }
    return converted;
  }

  const result = await createManualTurno(d);
  if (!result.ok) return result;
  // The visit is committed. A cache invalidation failure cannot change that fact.
  try { revalidatePath("/hoy"); revalidatePath("/calendario"); revalidatePath("/pacientes"); } catch { /* The next navigation reloads persisted data. */ }
  return result;
}
