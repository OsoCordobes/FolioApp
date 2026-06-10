"use server";

/**
 * Folio · Server Actions de /configuracion/billing (M19).
 *
 * Solo OWNER puede ejecutarlas — el check de rol vive en cada action porque
 * Server Actions pueden ser llamadas desde cualquier client si conocés el ID.
 * RLS de `suscripcion` también lo bloquea, pero defensa en profundidad.
 *
 * DECISIÓN (Fase E, revisado 2026-06-10): billing es OWNER-only POR DISEÑO,
 * más restrictivo que capabilities.canManageOrgSettings (OWNER+DIRECTOR).
 * Espeja la RLS de M19 (solo OWNER lee `suscripcion`): el DIRECTOR administra
 * la operación, pero el contrato de pago con Folio es del dueño de la cuenta.
 * Si algún día se relaja, cambiar TAMBIÉN la policy de M19 y capabilities.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getActiveContext } from "@/lib/db/active-context";
import { err, ok, type Result } from "@/lib/db/errors";
import {
  applySubscriptionUpdate,
  cancelSubscription,
  createOrRenewPendingSubscription,
  syncSubscriptionAmount,
} from "@/lib/db/suscripcion";
import { getPaymentProvider } from "@/lib/payments";

function appUrlFromEnv(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  // Fallback: en Vercel preview/prod podemos derivar del VERCEL_URL.
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3010";
}

/**
 * Inicia la activación: crea preapproval en MP y redirige al usuario al init_point.
 * Al volver del init_point, el webhook subscription_preapproval ya habrá
 * marcado la suscripción como ACTIVA.
 */
export async function activateSubscriptionAction(): Promise<Result<{ initPoint: string }>> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER") {
    return err("forbidden", "Solo el dueño de la organización puede activar la suscripción.");
  }

  const res = await createOrRenewPendingSubscription({
    organizationId: ctx.data.organization.id,
    payerEmail: ctx.data.profile.email,
    appUrl: appUrlFromEnv(),
  });
  if (!res.ok) return res;

  // NO usamos redirect() server-side acá porque init_point es URL externa
  // y necesitamos que el cliente reciba el OK del action y haga window.location
  // (Next.js redirect() a una URL absoluta funciona, pero queremos que el
  // cliente pueda mostrar loading antes de redirigir).
  revalidatePath("/configuracion/billing");
  return ok({ initPoint: res.data.initPoint });
}

/**
 * Cancela la suscripción en MP + marca CANCELADA local. La org sigue pudiendo
 * usar Folio hasta `proxima_cobro` (período pagado).
 */
export async function cancelSubscriptionAction(): Promise<Result<void>> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER") {
    return err("forbidden", "Solo el dueño de la organización puede cancelar la suscripción.");
  }

  const res = await cancelSubscription(ctx.data.organization.id);
  if (!res.ok) return res;

  revalidatePath("/configuracion/billing");
  revalidatePath("/", "layout");
  return ok(undefined);
}

/**
 * Lazy reconcile: refresca el estado local consultando MP. Útil cuando el
 * usuario vuelve del init_point y el webhook todavía no llegó.
 */
export async function refreshSubscriptionAction(): Promise<Result<void>> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER") {
    return err("forbidden", "Solo el dueño puede refrescar el estado de la suscripción.");
  }
  if (!ctx.data.subscription.estado) {
    return ok(undefined);
  }

  const { loadSubscriptionForOrg } = await import("@/lib/db/suscripcion");
  const local = await loadSubscriptionForOrg(ctx.data.organization.id);
  if (!local.ok) return local;
  if (!local.data?.mpPreapprovalId) return ok(undefined);

  try {
    const remote = await getPaymentProvider().fetchSubscription(local.data.mpPreapprovalId);
    const upd = await applySubscriptionUpdate(remote);
    if (!upd.ok) return upd;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("network", "No se pudo consultar a Mercado Pago.", msg);
  }

  revalidatePath("/configuracion/billing");
  revalidatePath("/", "layout");
  return ok(undefined);
}

/**
 * Fase E (E2): sincroniza el monto del débito de MP con el tier + seats
 * actuales de la org. Solo OWNER de una org CLINICA — espejo del gate del
 * resto de las actions de billing; para INDEPENDIENTE la decisión interna
 * además lo saltearía (defensa en profundidad).
 */
export async function syncClinicAmountAction(): Promise<Result<void>> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  if (ctx.data.session.role !== "OWNER") {
    return err("forbidden", "Solo el dueño de la organización puede actualizar el monto.");
  }
  if (ctx.data.organization.tipo !== "CLINICA") {
    return err("forbidden", "El monto por integrantes es del plan Clínica.");
  }

  const res = await syncSubscriptionAmount(ctx.data.organization.id);
  if (!res.ok) return res;

  revalidatePath("/configuracion/billing");
  revalidatePath("/", "layout");
  return ok(undefined);
}

/**
 * Action que el client usa para redirigir al init_point usando Next redirect.
 * Lo mantenemos separado porque `redirect()` tira un throw especial que solo
 * funciona en contexto server.
 */
export async function redirectToInitPoint(initPoint: string): Promise<never> {
  redirect(initPoint);
}
