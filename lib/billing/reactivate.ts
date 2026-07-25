/**
 * Folio · decisión pura "¿ofrecer Volver a activar?" (review PR #117).
 *
 * El paywall (PaywallHero) promete "Reactivar por $X/mes" y su CTA enfoca el
 * botón primario dentro de SubscriptionCard. Para PAUSADA y MOROSA con período
 * pagado vencido la card solo ofrecía "Cancelar suscripción" — CTA dead-end:
 * el hero vendía una reactivación que la card no dejaba ejecutar. El server SÍ
 * la soporta (createOrRenewPendingSubscription solo rechaza ACTIVA; crea un
 * preapproval nuevo y resetea el watermark mp_last_modified), así que la
 * decisión de UI vive acá, pura y testeable con node:test.
 *
 * Reglas:
 *   - PAUSADA → siempre: el gate la bloquea siempre (computeAccessGate caso 3)
 *     y un preapproval pausado no debita — crear uno nuevo es seguro.
 *   - MOROSA → solo con el gate bloqueado (período pagado vencido). Mientras
 *     el gate permite acceso, MP sigue reintentando el cobro del preapproval
 *     vigente; ofrecer uno nuevo en paralelo arriesga doble débito.
 *   - ACTIVA → nunca (el server además lo rechaza con conflict).
 *   - PENDIENTE_ACTIVACION / CANCELADA / sin suscripción → no pasa por acá:
 *     esas ramas de SubscriptionCard ya tienen su propio botón de activación.
 */

import type { EstadoSuscripcion } from "@/lib/db/suscripcion";

export function canOfferReactivate(args: {
  estado: EstadoSuscripcion;
  /** `accessGate.allowed` del contexto activo (computeAccessGate). */
  gateAllowed: boolean;
}): boolean {
  if (args.estado === "PAUSADA") return true;
  return args.estado === "MOROSA" && !args.gateAllowed;
}
