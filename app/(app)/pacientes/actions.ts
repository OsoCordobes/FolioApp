"use server";

/**
 * Folio · /pacientes · Server Actions.
 *
 * Wrapper de `createPaciente` (lib/db/pacientes.ts) con revalidación de la
 * ruta /pacientes después del insert. Permite crear pacientes standalone
 * desde el directorio (sin un turno asociado), complementando el flow
 * walk-in en /hoy y la confirmación de pedidos en /calendario.
 *
 * También persiste el borrador clínico del tab Plan de la ficha
 * (`saveSesionFichaAction`): slot de especialidad + SOAP → upsertSesion
 * (writer único de sesion.tool_id / tool_data_cifrado, M50).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveContext } from "@/lib/db/active-context";
import { createPaciente } from "@/lib/db/pacientes";
import { upsertSesion } from "@/lib/db/sesiones";
import { err, ok, type Result } from "@/lib/db/errors";
import { buildUpsertSesionInput } from "@/lib/especialidades/draft";

const createPacienteActionSchema = z.object({
  nombre: z.string().min(1).max(80),
  apellido: z.string().min(1).max(80),
  telefono: z.string().min(6).max(30),
  email: z.string().email().optional().or(z.literal("")),
  motivoConsulta: z.string().max(2000).optional().or(z.literal("")),
  tipoDoc: z.enum(["DNI", "LE", "LC", "CI", "PASAPORTE"]).optional(),
  numeroDoc: z.string().max(20).optional().or(z.literal("")),
});

export type CreatePacienteActionInput = z.infer<typeof createPacienteActionSchema>;

export async function createPacienteAction(
  input: CreatePacienteActionInput,
): Promise<Result<{ id: string }>> {
  const parsed = createPacienteActionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del paciente inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  const result = await createPaciente({
    nombre: d.nombre,
    apellido: d.apellido,
    telefono: d.telefono,
    email: d.email && d.email.length > 0 ? d.email : undefined,
    motivoConsulta: d.motivoConsulta && d.motivoConsulta.length > 0 ? d.motivoConsulta : undefined,
    tipoDoc: d.tipoDoc ?? "DNI",
    numeroDoc: d.numeroDoc && d.numeroDoc.length > 0 ? d.numeroDoc : undefined,
    tags: [],
  });

  if (!result.ok) return result;

  revalidatePath("/pacientes");
  return ok({ id: result.data.id });
}

// ─── Guardar sesión desde la ficha (tab Plan) ───────────────────────────────

const saveSesionFichaSchema = z.object({
  turnoId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  /** Borrador del slot clínico — opaco acá; lo valida el writer contra el
   *  schema zod del registry. null/ausente = no se tocó la herramienta. */
  toolValue: z.unknown().optional(),
  soap: z.object({
    subjetivo: z.string().max(5000),
    objetivo: z.string().max(5000),
    analisis: z.string().max(5000),
    plan: z.string().max(5000),
  }),
});

export type SaveSesionFichaActionInput = z.infer<typeof saveSesionFichaSchema>;

/**
 * Persiste el borrador del tab Plan (herramienta de especialidad + SOAP)
 * como la sesión del turno en curso del paciente (upsert 1:1 por turno_id,
 * editable hasta el lock — Ley 26.529).
 *
 * El toolId NO viaja del cliente: se deriva server-side de la especialidad
 * de la org activa (registry) y upsertSesion valida el toolData contra el
 * schema zod antes de cifrar. RLS (sesion_insert/update_clinical, M10) y el
 * trigger sesion_same_org_guard cubren tenancy y coherencia turno↔paciente.
 * PHI: nunca se loguea el contenido del borrador.
 */
export async function saveSesionFichaAction(
  input: SaveSesionFichaActionInput,
): Promise<Result<{ sesionId: string }>> {
  const parsed = saveSesionFichaSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de la sesión inválidos.", parsed.error.message);
  }

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  const result = await upsertSesion(
    buildUpsertSesionInput({
      turnoId: parsed.data.turnoId,
      pacienteId: parsed.data.pacienteId,
      especialidad: ctx.data.organization.especialidad,
      toolValue: parsed.data.toolValue ?? null,
      soap: parsed.data.soap,
    }),
  );
  if (!result.ok) return result;

  // La vuelta: la ficha re-renderiza con la sesión nueva en plan.toolHistorial.
  revalidatePath(`/pacientes/${parsed.data.pacienteId}`);
  return ok({ sesionId: result.data.id });
}
