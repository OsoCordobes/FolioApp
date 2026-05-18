/**
 * Folio · Sentry client init.
 *
 * Tracks errors en el bundle del browser. Sin DSN configurada, Sentry no
 * envía datos (init es no-op).
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,                              // 10% del traffic
    replaysSessionSampleRate: 0.0,                      // off por privacidad
    replaysOnErrorSampleRate: 0.5,                      // capture replay solo si hubo error
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,                              // ocultar datos médicos
        blockAllMedia: true,
        maskAllInputs: true,
      }),
    ],
    beforeSend(event) {
      // Scrub PII básico (nombres y telefonos en el dom)
      if (event.request?.url?.includes("/pacientes/")) {
        event.request.url = event.request.url.replace(/\/pacientes\/[a-f0-9-]+/i, "/pacientes/<id>");
      }
      return event;
    },
  });
}
