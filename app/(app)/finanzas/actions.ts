"use server";

/**
 * Folio · Server Actions de /finanzas.
 *
 * - emitirFactura: dispara WSFEv1 contra AFIP para un pago PAGADO. Solo OWNER
 *   o DIRECTOR pueden hacerlo (compliance fiscal).
 */

import { z } from "zod";

import { emitirFacturaParaPago } from "@/lib/afip/comprobantes";
import { err, ok, type Result } from "@/lib/db/errors";
import { getActiveSession } from "@/lib/db/session";

const emitirInput = z.object({
  pagoId: z.string().uuid(),
});

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
