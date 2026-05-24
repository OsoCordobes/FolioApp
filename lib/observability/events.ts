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

import { captureServerEvent } from "./posthog";

interface BaseEventProps {
  orgId: string;
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
    captureServerEvent({
      distinctId: p.orgId,
      event: "signup.completed",
      properties: { source: p.source, org_id: p.orgId },
    }),

  onboardingCompleted: (p: OnboardingCompletedProps) =>
    captureServerEvent({
      distinctId: p.orgId,
      event: "onboarding.completed",
      properties: { steps_completed: p.stepsCompleted, org_id: p.orgId },
    }),

  pacienteCreated: (p: PacienteCreatedProps) =>
    captureServerEvent({
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
    captureServerEvent({
      distinctId: p.orgId,
      event: "turno.created",
      properties: { source: p.source, servicio_id: p.servicioId, org_id: p.orgId },
    }),

  turnoClosed: (p: TurnoClosedProps) =>
    captureServerEvent({
      distinctId: p.orgId,
      event: "turno.closed",
      properties: {
        duration_min: p.durationMin,
        precio_cents: p.precioCents,
        org_id: p.orgId,
      },
    }),

  bookingPublicCompleted: (p: BookingPublicCompletedProps) =>
    captureServerEvent({
      distinctId: p.orgSlug,
      event: "booking_public.completed",
      properties: { org_slug: p.orgSlug, servicio_id: p.servicioId },
    }),

  soapAutosaved: (p: SoapAutosavedProps) =>
    captureServerEvent({
      distinctId: p.orgId,
      event: "soap.autosaved",
      properties: { turno_id: p.turnoId, org_id: p.orgId },
    }),

  documentoUploaded: (p: DocumentoUploadedProps) =>
    captureServerEvent({
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
