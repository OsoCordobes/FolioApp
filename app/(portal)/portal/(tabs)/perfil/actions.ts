"use server";

/**
 * Folio · Server Actions del perfil del portal (Fase 3 · P8).
 *
 * Wrapper delgado sobre lib/db/portal-perfil.ts. Existe para exponer la acción de
 * auto-edición de contacto desde el segment del portal con un límite server-action
 * explícito. Toda la seguridad (sesión del paciente + allow-list server-side + RLS
 * M71/M86) vive en el data layer; acá sólo re-validamos el shape con Zod y delegamos.
 *
 * ALLOW-LIST: el schema NO acepta nombre/apellido/documento (el data layer usa un
 * schema `.strict()` que rechaza cualquier clave de identidad). El paciente sólo
 * puede editar contacto y domicilio.
 */

import { z } from "zod";

import type { Result } from "@/lib/db/errors";
import { err } from "@/lib/db/errors";
import { updatePortalContacto } from "@/lib/db/portal-perfil";

const updateContactoInput = z.object({
  identidadId: z.string().uuid(),
  email: z.string().email().max(320).nullable().optional(),
  telefono: z.string().min(6).max(30).nullable().optional(),
  domicilioCalle: z.string().max(120).nullable().optional(),
  domicilioNumero: z.string().max(20).nullable().optional(),
  domicilioCiudad: z.string().max(60).nullable().optional(),
  domicilioProvincia: z.string().max(60).nullable().optional(),
  domicilioCp: z.string().max(15).nullable().optional(),
});

export async function actualizarContactoAction(
  input: z.infer<typeof updateContactoInput>,
): Promise<Result<{ identidadId: string }>> {
  const parsed = updateContactoInput.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos inválidos.", parsed.error.message);
  }
  return updatePortalContacto(parsed.data);
}
