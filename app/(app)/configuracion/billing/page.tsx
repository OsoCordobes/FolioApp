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
  decideSubscriptionAmountSync,
  loadRecentCharges,
  loadSubscriptionForOrg,
  type CargoRow,
} from "@/lib/db/suscripcion";
import { computeMonthlyPriceCents } from "@/lib/billing/pricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Precio de display del plan Solo derivado de la capa de pricing (dominio),
// no del cliente MP (transporte) — la UI no debe importar lib/mercadopago.
const PLAN_SOLO_PRICE_ARS = computeMonthlyPriceCents("INDEPENDIENTE", 1) / 100;

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

  // Fase C · tiers + Fase E · cobro variable: para orgs CLINICA mostramos el
  // desglose base + seats Y el monto que MP efectivamente debita
  // (suscripcion.monto_cents). Si difieren con una suscripción elegible
  // (ACTIVA/MOROSA con preapproval — misma decisión pura que el sync real),
  // la UI ofrece "Actualizar monto". Seats = members activos de la org
  // (deleted_at IS NULL), incluyendo al OWNER.
  let clinicPricing: ClinicPricingView | null = null;
  if (ctx.data.organization.tipo === "CLINICA") {
    const supabase = await createSupabaseServerClient();
    const { count } = await supabase
      .from("member")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.data.organization.id)
      .is("deleted_at", null);
    const breakdown = computeClinicBreakdownCents(count ?? 1);
    const sub = subRes.data;
    const decision = decideSubscriptionAmountSync({
      tipo: "CLINICA",
      expectedCents: breakdown.totalCents,
      subscription: sub
        ? { estado: sub.estado, montoCents: sub.montoCents, mpPreapprovalId: sub.mpPreapprovalId }
        : null,
    });
    const debitaHoy =
      sub && (sub.estado === "ACTIVA" || sub.estado === "MOROSA" || sub.estado === "PAUSADA");
    clinicPricing = {
      seats: breakdown.seats,
      extraSeats: breakdown.extraSeats,
      basePriceArs: breakdown.basePriceCents / 100,
      seatPriceArs: breakdown.seatPriceCents / 100,
      totalArs: breakdown.totalCents / 100,
      montoActualArs: debitaHoy ? sub.montoCents / 100 : null,
      syncPending: decision.action === "sync",
    };
  }

  return (
    <BillingPage
      subscription={subRes.data}
      charges={charges}
      accessGate={ctx.data.accessGate}
      planPriceArs={PLAN_SOLO_PRICE_ARS}
      payerEmail={ctx.data.profile.email}
      gateBanner={sp.gate ?? null}
      activationOk={sp.activation === "ok"}
      orgTipo={ctx.data.organization.tipo}
      clinicPricing={clinicPricing}
    />
  );
}
