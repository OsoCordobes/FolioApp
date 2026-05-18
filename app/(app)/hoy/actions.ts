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
 */

import { revalidatePath } from "next/cache";

import { transitionTurno } from "@/lib/db/turnos";
import type { Result } from "@/lib/db/errors";
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
