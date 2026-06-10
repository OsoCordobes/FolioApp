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

import { BillingPage, type ClinicPricingView } from "@/components/billing/billing-page";
import { computeClinicBreakdownCents } from "@/lib/billing/pricing";
import { getActiveContext } from "@/lib/db/active-context";
import {
  loadRecentCharges,
  loadSubscriptionForOrg,
  type CargoRow,
} from "@/lib/db/suscripcion";
import { MP_PLAN_PRICE_ARS } from "@/lib/mercadopago/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  // Fase C · tiers: para orgs CLINICA mostramos el desglose base + seats
  // (SOLO display — el preapproval de MP sigue cobrando el plan vigente;
  // el débito variable por integrante llega en Fase E). Seats = members
  // activos de la org (deleted_at IS NULL), incluyendo al OWNER.
  let clinicPricing: ClinicPricingView | null = null;
  if (ctx.data.organization.tipo === "CLINICA") {
    const supabase = await createSupabaseServerClient();
    const { count } = await supabase
      .from("member")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.data.organization.id)
      .is("deleted_at", null);
    const breakdown = computeClinicBreakdownCents(count ?? 1);
    clinicPricing = {
      seats: breakdown.seats,
      extraSeats: breakdown.extraSeats,
      basePriceArs: breakdown.basePriceCents / 100,
      seatPriceArs: breakdown.seatPriceCents / 100,
      totalArs: breakdown.totalCents / 100,
    };
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
      orgTipo={ctx.data.organization.tipo}
      clinicPricing={clinicPricing}
    />
  );
}
