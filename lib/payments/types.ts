/**
 * Folio · PaymentProvider — abstracción de proveedor de cobros (Fase E · E1).
 *
 * Mercado Pago no opera en España: esta interfaz deja la superficie lista para
 * enchufar un proveedor europeo (Stripe/GoCardless/etc.) sin tocar los callers.
 *
 * Principios:
 *   - Tipos de DOMINIO propios: los callers (lib/db/suscripcion.ts, webhook,
 *     cron) nunca ven payloads crudos del proveedor. El mapeo proveedor↔dominio
 *     vive en cada implementación (lib/payments/mercadopago.ts).
 *   - Montos SIEMPRE en centavos enteros (int). La conversión a la unidad que
 *     espere cada API (MP usa ARS con decimales) es responsabilidad del provider.
 *   - Estados canónicos de suscripción: PENDIENTE | ACTIVA | PAUSADA |
 *     CANCELADA | MOROSA. MOROSA nunca viene del proveedor (es un estado local
 *     derivado de cargos rechazados) pero forma parte del dominio.
 *
 * La verificación de firma de webhooks NO es parte de esta interfaz: es
 * transporte específico de cada proveedor y queda en su route handler
 * (p. ej. lib/mercadopago/webhook-security.ts para el route de MP).
 */

// ─── Estados de dominio ──────────────────────────────────────────────────────

/** Estado canónico de una suscripción a nivel dominio (independiente del proveedor). */
export type SubscriptionStatus =
  | "PENDIENTE"
  | "ACTIVA"
  | "PAUSADA"
  | "CANCELADA"
  | "MOROSA";

/** Estado canónico de un intento de cobro. Espeja `EstadoCargo` de la DB. */
export type ChargeStatus = "PENDIENTE" | "APROBADO" | "RECHAZADO" | "REFUNDED";

// ─── Entidades de dominio ────────────────────────────────────────────────────

/** Snapshot de una suscripción según el proveedor, ya mapeada a dominio. */
export interface SubscriptionInfo {
  /** ID de la suscripción en el proveedor (MP: preapproval_id). */
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  /** Monto recurrente en centavos enteros. */
  amountCents: number;
  /** Moneda ISO-4217 (MP: "ARS"). */
  currency: string;
  payerEmail: string | null;
  /** Referencia externa nuestra (MP: external_reference, p. ej. `org_<uuid>`). */
  externalReference: string | null;
  /** URL de checkout para que el usuario autorice (MP: init_point). */
  checkoutUrl: string | null;
  /** Próximo cobro programado (ISO). */
  nextChargeDate: string | null;
  /**
   * Última modificación según el proveedor (ISO). Watermark para el guard de
   * orden no monotónico (CR-3): un evento con lastModified <= al guardado se
   * descarta como stale.
   */
  lastModified: string | null;
}

/** Intento de cobro recurrente, ya mapeado a dominio (MP: authorized_payment). */
export interface ChargeAttemptInfo {
  /** ID del intento en el proveedor (MP: authorized_payment.id). */
  providerChargeId: string;
  /** Suscripción a la que pertenece (MP: preapproval_id). */
  providerSubscriptionId: string;
  /** Monto del intento en centavos enteros. */
  amountCents: number;
  currency: string;
  /** Fecha del intento (ISO). null si el proveedor no la informó. */
  attemptDate: string | null;
  /**
   * Pago concreto asociado. null si el intento todavía no tiene pago
   * (MP: "scheduled" sin payment) — esos no son cobros y se ignoran.
   */
  payment: {
    /** ID del pago final en el proveedor (MP: payment.id). Idempotencia local. */
    paymentId: string;
    status: ChargeStatus;
    /** Detalle del proveedor (p. ej. motivo de rechazo). Sin PHI. */
    statusDetail: string | null;
  } | null;
}

// ─── Inputs / outputs ────────────────────────────────────────────────────────

export interface CreateSubscriptionInput {
  payerEmail: string;
  /** Referencia nuestra para correlacionar (p. ej. `org_<uuid>`). */
  externalReference: string;
  /** URL a la que vuelve el usuario después de autorizar en el proveedor. */
  backUrl: string;
  /**
   * Monto recurrente en centavos enteros (Fase E · E2): sale del tier de la
   * org al momento de activar (computeMonthlyPriceCents) — INDEPENDIENTE =
   * plan vigente; CLINICA = base + seats activos.
   */
  amountCents: number;
}

export interface CreateSubscriptionOutput {
  subscription: SubscriptionInfo;
  /** URL de checkout garantizada (si el proveedor no la devuelve, el provider tira). */
  checkoutUrl: string;
}

// ─── Interfaz ────────────────────────────────────────────────────────────────

/**
 * Contrato que implementa cada proveedor de cobros. Los métodos tiran `Error`
 * ante fallas de red/API del proveedor — los callers (capa lib/db) los
 * capturan y mapean a `Result` (`err("network", ...)`), igual que hoy.
 */
export interface PaymentProvider {
  /** Nombre canónico del proveedor (p. ej. "mercadopago"). Para logs/config. */
  readonly name: string;

  /** Crea la suscripción en el proveedor y devuelve la URL de checkout. */
  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionOutput>;

  /** Lee el estado actual de la suscripción (webhook fan-in, cron reconcile, lazy refresh). */
  fetchSubscription(providerSubscriptionId: string): Promise<SubscriptionInfo>;

  /** Cancela la suscripción en el proveedor (terminal). */
  cancelSubscription(providerSubscriptionId: string): Promise<SubscriptionInfo>;

  /** Pausa la suscripción. Opcional: no todos los proveedores lo soportan. */
  pauseSubscription?(providerSubscriptionId: string): Promise<SubscriptionInfo>;

  /**
   * Actualiza el monto recurrente (centavos enteros). Lo usa el cobro variable
   * por seats de Clínica (Fase E · E2) cuando cambia el equipo.
   */
  updateSubscriptionAmount(
    providerSubscriptionId: string,
    amountCents: number,
  ): Promise<SubscriptionInfo>;

  /** Lee un intento de cobro recurrente (webhook subscription_authorized_payment). */
  fetchChargeAttempt(providerChargeId: string): Promise<ChargeAttemptInfo>;
}
