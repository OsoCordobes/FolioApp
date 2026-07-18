"use server";

/**
 * Folio · Server Actions de turnos del portal (Fase 3 · P4).
 *
 * Wrapper delgado sobre lib/db/portal-turnos.ts. Existe para exponer las acciones
 * desde el segment del portal con un límite server-action explícito. Toda la lógica
 * de seguridad (sesión del paciente + RLS M71/M84) vive en el data layer; acá sólo
 * re-validamos el shape con Zod y delegamos.
 */

import { z } from "zod";

import type { Result } from "@/lib/db/errors";
import { err } from "@/lib/db/errors";
import {
  cancelarTurnoPortal,
  solicitarReagendaPortal,
  solicitarTurnoPortal,
} from "@/lib/db/portal-turnos";

const cancelarInput = z.object({ turnoId: z.string().uuid() });

export async function cancelarTurnoAction(
  input: z.infer<typeof cancelarInput>,
): Promise<Result<{ turnoId: string }>> {
  const parsed = cancelarInput.safeParse(input);
  if (!parsed.success) return err("validation", "Datos inválidos.", parsed.error.message);
  return cancelarTurnoPortal({ turnoId: parsed.data.turnoId });
}

const reagendarInput = z.object({
  turnoId: z.string().uuid(),
  nuevoInicio: z.string().datetime({ offset: true }),
  motivo: z.string().max(2000).optional(),
});

export async function solicitarReagendaAction(
  input: z.infer<typeof reagendarInput>,
): Promise<Result<{ pedidoId: string }>> {
  const parsed = reagendarInput.safeParse(input);
  if (!parsed.success) return err("validation", "Datos inválidos.", parsed.error.message);
  return solicitarReagendaPortal(parsed.data);
}

const nuevaReservaInput = z.object({
  pacienteId: z.string().uuid(),
  servicioId: z.string().uuid(),
  inicio: z.string().datetime({ offset: true }),
  motivo: z.string().max(2000).optional(),
});

export async function solicitarTurnoAction(
  input: z.infer<typeof nuevaReservaInput>,
): Promise<Result<{ pedidoId: string }>> {
  const parsed = nuevaReservaInput.safeParse(input);
  if (!parsed.success) return err("validation", "Datos inválidos.", parsed.error.message);
  return solicitarTurnoPortal(parsed.data);
}
