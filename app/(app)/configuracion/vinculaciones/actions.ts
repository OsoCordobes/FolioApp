"use server";

/**
 * Folio · Server Actions de vinculaciones de pacientes (Fase 3 · P9) 🔒
 *
 * Wrapper delgado sobre lib/db/paciente-claims.ts. Expone la resolución de claims
 * (aprobar/rechazar) desde la UI de /configuracion/vinculaciones. Toda la seguridad
 * (rol clínico + org de la sesión + CAS atómico + gate anti-impersonación) vive en el
 * data layer y en el RPC resolver_paciente_claim (M87); acá sólo re-validamos el
 * shape, delegamos y revalidamos la ruta para refrescar la lista.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Result } from "@/lib/db/errors";
import { err } from "@/lib/db/errors";
import {
  resolvePacienteClaim,
  type ResolvePacienteClaimResult,
} from "@/lib/db/paciente-claims";

const resolveInput = z.object({
  claimId: z.string().uuid(),
  aprobar: z.boolean(),
});

export async function resolverClaimAction(
  input: z.infer<typeof resolveInput>,
): Promise<Result<ResolvePacienteClaimResult>> {
  const parsed = resolveInput.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos inválidos.", parsed.error.message);
  }
  const result = await resolvePacienteClaim({
    claimId: parsed.data.claimId,
    aprobar: parsed.data.aprobar,
  });
  if (result.ok) {
    // Refresca la lista (el claim resuelto sale de 'pendiente').
    revalidatePath("/configuracion/vinculaciones");
  }
  return result;
}
