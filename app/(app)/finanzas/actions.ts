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
import { capabilitiesFor } from "@/lib/auth/capabilities";
import { finanzasScopeMemberId } from "@/lib/auth/finanzas-scope";
import { err, mapSupabaseError, ok, type Result } from "@/lib/db/errors";
import { getActiveSession } from "@/lib/db/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

// ─── Marcar cobrado (E2 · deudores) ─────────────────────────────────────────

const pagoIdSchema = z.string().uuid();

/**
 * Pasa un pago PENDIENTE/PARCIAL a PAGADO. El pago nace PENDIENTE cuando el
 * cierre del turno se registró con "quedó debiendo" (mini-diálogo de /hoy) y
 * se salda acá cuando el paciente finalmente paga.
 *
 * Autorización en capas:
 *   - capabilities.canRegistrarCobro (espejo de la RLS pago_write_admin).
 *   - scoping org EXPLÍCITO vía el turno del pago (pago no tiene organization_id
 *     propio — mismo razonamiento que lib/db/finanzas.ts).
 *   - PROFESIONAL sin canSeeFinanzasAll: solo puede saldar pagos de SUS turnos
 *     (mismo scoping que la página — fix del leak E1).
 */
export async function marcarPagoCobradoAction(pagoId: string): Promise<Result<void>> {
  const parsed = pagoIdSchema.safeParse(pagoId);
  if (!parsed.success) {
    return err("validation", "Pago inválido.");
  }

  const session = await getActiveSession();
  if (!session.ok) return session;

  const caps = capabilitiesFor(session.data.role, session.data.esColegiado);
  if (!caps.canRegistrarCobro || !caps.canSeeFinanzas) {
    return err("forbidden", "Tu rol no puede registrar cobros.");
  }

  const supabase = await createSupabaseServerClient();

  // 1. Leer el pago con su turno para validar org (y profesional, si el rol
  //    solo ve lo propio). La RLS ya filtra, pero el chequeo explícito evita
  //    el cross-org con multi-membresía.
  const { data: pagoRow, error: selErr } = await supabase
    .from("pago")
    .select("id, estado, turno:turno_id!inner(organization_id, profesional_id)")
    .eq("id", parsed.data)
    .maybeSingle();

  if (selErr) {
    const mapped = mapSupabaseError(selErr);
    return err(mapped.code, mapped.message, selErr.message);
  }
  const pago = pagoRow as
    | { id: string; estado: string; turno: { organization_id: string; profesional_id: string | null } | null }
    | null;
  if (!pago || !pago.turno || pago.turno.organization_id !== session.data.organizationId) {
    return err("not_found", "El pago no existe o no es de tu organización.");
  }

  const scopeMemberId = finanzasScopeMemberId(caps, session.data.memberId);
  if (scopeMemberId && pago.turno.profesional_id !== scopeMemberId) {
    return err("forbidden", "Solo podés registrar cobros de tus propios turnos.");
  }

  if (pago.estado === "PAGADO") {
    // Idempotente: ya estaba cobrado (doble click, otra pestaña). No es error.
    return ok(undefined);
  }

  // 2. Saldar: PAGADO + pagado_ts (el CHECK pago_consistency de M09 exige
  //    ambos juntos). El guard .neq evita pisar un pagado_ts existente si otro
  //    usuario lo cobró en el medio (carrera benigna → ok igual).
  const { error: updErr } = await supabase
    .from("pago")
    .update({ estado: "PAGADO", pagado_ts: new Date().toISOString() })
    .eq("id", parsed.data)
    .neq("estado", "PAGADO")
    .select("id");

  if (updErr) {
    const mapped = mapSupabaseError(updErr);
    return err(mapped.code, mapped.message, updErr.message);
  }

  revalidatePath("/finanzas");
  return ok(undefined);
}
