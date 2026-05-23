"use server";

/**
 * Folio · /pacientes · Server Actions.
 *
 * Wrapper de `createPaciente` (lib/db/pacientes.ts) con revalidación de la
 * ruta /pacientes después del insert. Permite crear pacientes standalone
 * desde el directorio (sin un turno asociado), complementando el flow
 * walk-in en /hoy y la confirmación de pedidos en /calendario.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createPaciente } from "@/lib/db/pacientes";
import { err, ok, type Result } from "@/lib/db/errors";

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
