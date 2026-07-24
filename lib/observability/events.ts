/**
 * Folio · Catálogo tipado de business events (Sprint 2 T2.2).
 *
 * Cada evento tiene:
 *   - Nombre canónico namespaced (`turno.created`, no `turnoCreated`).
 *   - Shape de properties tipado.
 *   - Helper que invoca `captureServerEvent` desde Server Actions / API routes.
 *
 * Para evitar plumbing manual del distinctId en cada call site, los helpers
 * aceptan un `orgId` y lo usan como distinctId (analytics es a nivel
 * organización, no a nivel usuario — multi-tenant, una clínica con N
 * profesionales se comporta como una unidad de análisis).
 *
 * Si POSTHOG_KEY no está configurada, los calls son no-op (no rompen).
 */

import { captureServerEvent, type CaptureInput } from "./posthog";

interface BaseEventProps {
  orgId: string;
  /**
   * `organization.is_internal_account` (M37) del contexto del caller. Con
   * `true` el evento NO se captura: las orgs internas/demo (demo-*,
   * lorenzomj925, folioasistencia) no deben ensuciar el funnel de PostHog
   * cuando se enciendan las keys. Opcional para no romper call sites que no
   * tienen la org cargada — undefined captura normal (orgs reales).
   */
  isInternal?: boolean;
}

/** Guard central: las orgs internas/demo no generan eventos de negocio. */
function captureUnlessInternal(
  isInternal: boolean | undefined,
  input: CaptureInput,
): Promise<void> {
  if (isInternal === true) return Promise.resolve();
  return captureServerEvent(input);
}

interface SignupCompletedProps extends BaseEventProps {
  source: "email" | "google";
}

interface OnboardingCompletedProps extends BaseEventProps {
  stepsCompleted: number;
}

interface PacienteCreatedProps extends BaseEventProps {
  source: "manual" | "walkin" | "booking" | "pedido";
  hasDni: boolean;
  hasEmail: boolean;
}

interface TurnoCreatedProps extends BaseEventProps {
  source: "manual" | "calendario" | "ficha" | "booking" | "walkin";
  servicioId: string;
}

interface TurnoClosedProps extends BaseEventProps {
  durationMin: number;
  precioCents: number;
}

interface BookingPublicCompletedProps {
  orgSlug: string;
  servicioId: string;
  /** Mismo semántica que BaseEventProps.isInternal (acá no hay orgId). */
  isInternal?: boolean;
}

interface SoapAutosavedProps extends BaseEventProps {
  turnoId: string;
}

interface DocumentoUploadedProps extends BaseEventProps {
  pacienteId: string;
  tipo: string;
  byteCount: number;
}

/**
 * Capturas server-side. Cada función recibe properties tipadas y mapea al
 * `captureServerEvent` con el evento canónico y distinctId derivado del orgId
 * (o orgSlug donde no haya orgId disponible, como en booking público).
 */
export const trackEvent = {
  signupCompleted: (p: SignupCompletedProps) =>
    captureUnlessInternal(p.isInternal, {
      distinctId: p.orgId,
      event: "signup.completed",
      properties: { source: p.source, org_id: p.orgId },
    }),

  onboardingCompleted: (p: OnboardingCompletedProps) =>
    captureUnlessInternal(p.isInternal, {
      distinctId: p.orgId,
      event: "onboarding.completed",
      properties: { steps_completed: p.stepsCompleted, org_id: p.orgId },
    }),

  pacienteCreated: (p: PacienteCreatedProps) =>
    captureUnlessInternal(p.isInternal, {
      distinctId: p.orgId,
      event: "paciente.created",
      properties: {
        source: p.source,
        has_dni: p.hasDni,
        has_email: p.hasEmail,
        org_id: p.orgId,
      },
    }),

  turnoCreated: (p: TurnoCreatedProps) =>
    captureUnlessInternal(p.isInternal, {
      distinctId: p.orgId,
      event: "turno.created",
      properties: { source: p.source, servicio_id: p.servicioId, org_id: p.orgId },
    }),

  turnoClosed: (p: TurnoClosedProps) =>
    captureUnlessInternal(p.isInternal, {
      distinctId: p.orgId,
      event: "turno.closed",
      properties: {
        duration_min: p.durationMin,
        precio_cents: p.precioCents,
        org_id: p.orgId,
      },
    }),

  bookingPublicCompleted: (p: BookingPublicCompletedProps) =>
    captureUnlessInternal(p.isInternal, {
      distinctId: p.orgSlug,
      event: "booking_public.completed",
      properties: { org_slug: p.orgSlug, servicio_id: p.servicioId },
    }),

  soapAutosaved: (p: SoapAutosavedProps) =>
    captureUnlessInternal(p.isInternal, {
      distinctId: p.orgId,
      event: "soap.autosaved",
      properties: { turno_id: p.turnoId, org_id: p.orgId },
    }),

  documentoUploaded: (p: DocumentoUploadedProps) =>
    captureUnlessInternal(p.isInternal, {
      distinctId: p.orgId,
      event: "documento.uploaded",
      properties: {
        paciente_id: p.pacienteId,
        tipo: p.tipo,
        byte_count: p.byteCount,
        org_id: p.orgId,
      },
    }),
};

/**
 * Lista de event names canónicos. Útil para alinear con PostHog dashboard
 * (cuando se definen funnels, retention cohorts, etc).
 */
export const EVENT_NAMES = {
  SIGNUP_COMPLETED: "signup.completed",
  ONBOARDING_COMPLETED: "onboarding.completed",
  PACIENTE_CREATED: "paciente.created",
  TURNO_CREATED: "turno.created",
  TURNO_CLOSED: "turno.closed",
  BOOKING_PUBLIC_COMPLETED: "booking_public.completed",
  SOAP_AUTOSAVED: "soap.autosaved",
  DOCUMENTO_UPLOADED: "documento.uploaded",
} as const;

/* ═══════════════════════════════════════════════════════════════════════
 * Landing pública (/) · funnel de marketing — eventos CLIENT-side.
 *
 * A diferencia del catálogo de arriba, estos eventos NO pasan por
 * `captureServerEvent`: los captura el browser (posthog-js) desde el island
 * <LandingAnalytics /> (components/landing/landing-analytics.tsx), gated por
 * cookie consent (ver lib/observability/posthog-client.tsx — sin
 * consentimiento explícito `posthog.init` nunca corre y toda captura es
 * no-op silencioso).
 *
 * IMPORTANTE: este módulo importa posthog-node (server-only) para los
 * helpers de arriba. Desde client components importar SOLO tipos
 * (`import type { ... } from "@/lib/observability/events"`) — un import por
 * valor arrastraría posthog-node al bundle del browser.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Sección de origen de un CTA del landing (valor del atributo `data-fl-cta`). */
export type LandingCtaSection =
  | "header"
  | "hero"
  | "pricing_solo"
  | "pricing_clinic"
  | "sticky"
  | "final";

/** `landing.viewed` — pageview del landing (una vez por visita). Sin props. */
export type LandingViewedProps = Record<string, never>;

/** `landing.cta_clicked` — click en cualquier elemento `[data-fl-cta]`. */
export interface LandingCtaClickedProps {
  /** Valor del atributo `data-fl-cta` del elemento clickeado. */
  section: LandingCtaSection;
  /** Destino del CTA — el `href` del anchor (ej. "/onboarding"). */
  target: string;
}

/** `landing.section_viewed` — sección `[data-fl-section]` vista (una vez c/u). */
export interface LandingSectionViewedProps {
  /** Valor de `data-fl-section` (hero, day, vault, bento, …). */
  section: string;
}

/** `landing.faq_opened` — `<details data-fl-faq={i}>` abierto. */
export interface LandingFaqOpenedProps {
  /** Índice del item de FAQ (valor numérico de `data-fl-faq`). */
  index: number;
}

/**
 * Mapa nombre canónico → shape de properties. El island lo consume vía
 * `import type` para tipar su helper `capture(event, props)` con literales
 * verificados en compile-time, sin ningún import por valor de este módulo.
 */
export interface LandingEventMap {
  "landing.viewed": LandingViewedProps;
  "landing.cta_clicked": LandingCtaClickedProps;
  "landing.section_viewed": LandingSectionViewedProps;
  "landing.faq_opened": LandingFaqOpenedProps;
}

export type LandingEventName = keyof LandingEventMap;
