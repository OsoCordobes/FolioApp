"use server";

/**
 * Folio · Server Actions de /calendario.
 *
 * Acciones de inbox de pedidos: aceptar (crea paciente + turno) y rechazar
 * (marca el pedido como RECHAZADO con motivo).
 */

import { revalidatePath } from "next/cache";

import { aceptarPedido, rechazarPedido } from "@/lib/db/pedidos";
import type { Result } from "@/lib/db/errors";

export async function aceptarPedidoAction(
  pedidoId: string,
): Promise<Result<{ turnoId: string; pacienteId: string }>> {
  const result = await aceptarPedido(pedidoId);
  if (result.ok) {
    revalidatePath("/calendario");
    revalidatePath("/hoy");
  }
  return result;
}

export async function rechazarPedidoAction(
  pedidoId: string,
  motivo: string,
): Promise<Result<void>> {
  const result = await rechazarPedido(pedidoId, motivo);
  if (result.ok) {
    revalidatePath("/calendario");
  }
  return result;
}
