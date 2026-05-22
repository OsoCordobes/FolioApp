"use server";

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
 *   - loadCreateTurnoMeta() devuelve servicios + pacientes recientes + memberId
 *   - createTurnoAction() crea (o reutiliza) paciente + crea turno AGENDADO
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { blindIndex, encryptColumn } from "@/lib/crypto";
import { err, mapSupabaseError, ok, type Result } from "@/lib/db/errors";
import { getActiveSession } from "@/lib/db/session";
import { listPacientesDirectorio } from "@/lib/db/pacientes";
import { createTurno, transitionTurno } from "@/lib/db/turnos";
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

export interface TransitionTurnoActionInput {
  turnoId: string;
  to: EstadoTurno;
  duracionRealMin?: number;
}

export async function transitionTurnoAction(
  input: TransitionTurnoActionInput,
): Promise<Result<void>> {
  const result = await transitionTurno({
    turnoId: input.turnoId,
    to: ESTADO_UI_TO_DB[input.to],
    duracionRealMin: input.duracionRealMin,
  });

  if (result.ok) {
    revalidatePath("/hoy");
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
  profesionalId: string;
}

/**
 * Devuelve los datos necesarios para llenar el modal de creación de turno.
 * Servicios activos de la org, pacientes recientes (hasta 50) y el memberId
 * del profesional activo (default profesional_id del turno).
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
    profesionalId: session.data.memberId,
  });
}

const createTurnoActionSchema = z
  .object({
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
    inicio: z.string().datetime({ offset: true }),
    duracionMin: z.number().int().min(5).max(480),
    origen: z.enum(["MANUAL", "WALK_IN"]).default("MANUAL"),
  })
  .refine((d) => d.pacienteId != null || d.pacienteNuevo != null, {
    message: "Hay que elegir un paciente existente o crear uno nuevo.",
  });

export type CreateTurnoActionInput = z.infer<typeof createTurnoActionSchema>;

/**
 * Crea un turno desde el modal. Si `pacienteNuevo` viene set, primero crea
 * la identidad + paciente (rollback manual de identidad si paciente falla),
 * después crea el turno usando createTurno (que también agenda recordatorios).
 */
export async function createTurnoAction(
  input: CreateTurnoActionInput,
): Promise<Result<{ turnoId: string; pacienteId: string }>> {
  const parsed = createTurnoActionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del turno inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // 1. Resolver paciente
  let pacienteId: string;
  if (d.pacienteId) {
    pacienteId = d.pacienteId;
  } else if (d.pacienteNuevo) {
    const np = d.pacienteNuevo;
    const nombreFull = `${np.nombre} ${np.apellido}`.trim();
    const { data: identidad, error: idErr } = await supabase
      .from("paciente_identidad")
      .insert({
        organization_id: session.data.organizationId,
        nombre_cifrado: encryptColumn(np.nombre)!,
        apellido_cifrado: encryptColumn(np.apellido)!,
        tipo_doc: "DNI",
        telefono_cifrado: encryptColumn(np.telefono)!,
        email_cifrado: encryptColumn(np.email && np.email.length > 0 ? np.email : null),
        nombre_hash: blindIndex(nombreFull),
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
        tags: [],
        profesional_principal_id: session.data.memberId,
      })
      .select("id")
      .single();
    if (pacErr || !paciente) {
      await supabase.from("paciente_identidad").delete().eq("id", identidad.id);
      const mapped = pacErr ? mapSupabaseError(pacErr) : { code: "db_error" as const, message: "No se creó el paciente." };
      return err(mapped.code, mapped.message, pacErr?.message);
    }
    pacienteId = paciente.id;
  } else {
    return err("validation", "Falta paciente.");
  }

  // 2. Servicio: leer precio_cents para pasar al insert
  const { data: servicio } = await supabase
    .from("servicio")
    .select("precio_cents")
    .eq("id", d.servicioId)
    .eq("organization_id", session.data.organizationId)
    .maybeSingle();

  // 3. Crear turno via createTurno (incluye scheduleRecordatorios)
  const result = await createTurno({
    paciente_id: pacienteId,
    servicio_id: d.servicioId,
    profesional_id: session.data.memberId,
    inicio: d.inicio,
    duracion_min: d.duracionMin,
    precio_cents: (servicio?.precio_cents as number | undefined) ?? 0,
    origen: d.origen,
  });

  if (!result.ok) return result;

  revalidatePath("/hoy");
  revalidatePath("/calendario");
  return ok({ turnoId: result.data.id, pacienteId });
}
