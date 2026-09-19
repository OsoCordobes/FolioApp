"use server";

/**
 * Folio · Server Actions de /finanzas.
 *
 * - emitirFactura: dispara WSFEv1 contra AFIP para un pago PAGADO. Solo OWNER
 *   o DIRECTOR pueden hacerlo (compliance fiscal).
 * - marcarPagoCobrado (E2): salda un pago PENDIENTE desde la tabla de
 *   transacciones ("marcar cobrado" inline).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { emitirFacturaParaPago } from "@/lib/afip/comprobantes";
import { capabilitiesForSession } from "@/lib/auth/guard";
import { getActiveContext } from "@/lib/db/active-context";
import { readFinanceMovements } from "@/lib/db/finanzas-read";
import { movementRequestSchema } from "@/lib/finanzas/filter-schema";
import type { MovementPage } from "@/lib/finanzas/movements";
import { err, ok, type Result } from "@/lib/db/errors";
import { getActiveSession } from "@/lib/db/session";
import { settlePayment } from "@/lib/db/payment-settlement";

const emitirInput = z.object({
  pagoId: z.string().uuid(),
});

export async function listFinanceMovementsAction(input: unknown): Promise<Result<MovementPage>> {
  const parsed = movementRequestSchema.safeParse(input);
  if (!parsed.success) return err("validation", "Filtros de movimientos inválidos.");
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (!capabilitiesForSession(ctx.data.session).canSeeFinanzas) return err("forbidden", "No tenés acceso a finanzas.");
  return readFinanceMovements({ organizationId: ctx.data.session.organizationId,
    startUtc: parsed.data.startUtc, endUtc: parsed.data.endUtc },
  { status: parsed.data.status, query: parsed.data.query }, parsed.data.cursor);
}

export async function emitirFacturaAction(input: z.infer<typeof emitirInput>): Promise<Result<{ numero: string }>> {
  const parsed = emitirInput.safeParse(input);
  if (!parsed.success) return err("validation", "Datos inválidos.", parsed.error.message);

  const session = await getActiveSession();
  if (!session.ok) return session;
  if (session.data.role !== "OWNER" && session.data.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER o DIRECTOR puede facturar.");
  }

  // IDOR guard: la emisión corre con service_role; el scope de organización
  // viene de la sesión activa, NUNCA del cliente.
  const result = await emitirFacturaParaPago({
    pagoId: parsed.data.pagoId,
    organizationId: session.data.organizationId,
  });
  if (!result.ok) return result;

  return ok({ numero: result.data.cae });
}

// ─── Marcar cobrado (E2 · deudores) ─────────────────────────────────────────

/** Finance keeps both canSeeFinanzas and canRegistrarCobro in its shared gate. */
export async function marcarPagoCobradoAction(pagoId: string) {
  const result = await settlePayment({ pagoId }, "finance");
  if (result.ok) for (const path of ["/finanzas", "/hoy", "/calendario"]) {
    try { revalidatePath(path); } catch { /* The persisted payment remains confirmed. */ }
  }
  if (result.ok) {
    try { revalidatePath("/pacientes/[id]", "page"); } catch { /* Best effort. */ }
  }
  return result;
}
