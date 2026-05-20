/**
 * Folio · /configuracion/billing (Server Component).
 *
 * Página de gestión de la suscripción Folio (M19).
 *   - Solo accesible para OWNER (otros roles → not_found).
 *   - Muestra estado actual + próximo cobro + historial de cargos.
 *   - Botones para activar / cancelar / reactivar.
 *
 * El gating de "grace expired → forzar entrada acá" está en (app)/layout.tsx.
 * Esta página acepta query param `?gate=<reason>` para banner contextual.
 */

import { notFound } from "next/navigation";

import { BillingPage } from "@/components/billing/billing-page";
import { getActiveContext } from "@/lib/db/active-context";
import {
  loadRecentCharges,
  loadSubscriptionForOrg,
  type CargoRow,
} from "@/lib/db/suscripcion";
import { MP_PLAN_PRICE_ARS } from "@/lib/mercadopago/client";

export const dynamic = "force-dynamic";

export default async function BillingRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ gate?: string; activation?: string }>;
}) {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar /configuracion/billing: ${ctx.error.message}`);
  }

  // Solo OWNER ve billing. Cualquier otro rol → 404 (no leak de que existe).
  if (ctx.data.session.role !== "OWNER") {
    notFound();
  }

  const sp = await searchParams;
  const subRes = await loadSubscriptionForOrg(ctx.data.organization.id);
  if (!subRes.ok) {
    throw new Error(`Error leyendo suscripción: ${subRes.error.message}`);
  }

  let charges: CargoRow[] = [];
  if (subRes.data) {
    const chargesRes = await loadRecentCharges(subRes.data.id, 12);
    if (chargesRes.ok) charges = chargesRes.data;
  }

  return (
    <BillingPage
      subscription={subRes.data}
      charges={charges}
      accessGate={ctx.data.accessGate}
      planPriceArs={MP_PLAN_PRICE_ARS}
      payerEmail={ctx.data.profile.email}
      gateBanner={sp.gate ?? null}
      activationOk={sp.activation === "ok"}
    />
  );
}
