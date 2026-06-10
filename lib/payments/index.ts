/**
 * Folio · PaymentProvider — factory (Fase E · E1).
 *
 * `getPaymentProvider()` devuelve el proveedor de cobros activo como singleton
 * lazy. Hoy el único implementado es Mercado Pago (Argentina).
 *
 * Extensión futura (proveedor europeo — MP no opera en España):
 *   1. Implementar `createEuropeanProvider(): PaymentProvider` en
 *      lib/payments/<proveedor>.ts cumpliendo lib/payments/types.ts
 *      (montos en centavos enteros, estados canónicos de dominio).
 *   2. Agregar el case correspondiente al switch de abajo.
 *   3. Setear `PAYMENT_PROVIDER=<proveedor>` en el env del deploy.
 * Los callers (lib/db/suscripcion.ts, webhook, cron) no cambian.
 */

import { createMercadoPagoProvider } from "./mercadopago";
import type { PaymentProvider } from "./types";

export type {
  ChargeAttemptInfo,
  ChargeStatus,
  CreateSubscriptionInput,
  CreateSubscriptionOutput,
  PaymentProvider,
  SubscriptionInfo,
  SubscriptionStatus,
} from "./types";

const DEFAULT_PROVIDER = "mercadopago";

let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;

  const name = process.env.PAYMENT_PROVIDER ?? DEFAULT_PROVIDER;
  switch (name) {
    case "mercadopago":
      cached = createMercadoPagoProvider();
      break;
    // case "<proveedor-europeo>": cached = createEuropeanProvider(); break;
    default:
      // Mismo patrón warn-and-fallback que resolvePlanPriceCents: un typo en la
      // env no debe tirar el billing abajo — degradamos al default con warning.
      console.warn(
        `[payments] PAYMENT_PROVIDER desconocido ("${name}"); usando ${DEFAULT_PROVIDER}.`,
      );
      cached = createMercadoPagoProvider();
      break;
  }
  return cached;
}

/** Solo para unit tests: resetea el singleton (p. ej. para probar la env). */
export function __resetPaymentProviderForTests(): void {
  cached = null;
}
