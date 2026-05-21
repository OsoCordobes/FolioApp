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
      // Scrub IDs en URLs clínicas para no enviar identificadores de paciente
      // ni turno a Sentry. El UUID/hex se reemplaza por <id> en todas las
      // rutas que pueden tener datos sensibles.
      if (event.request?.url) {
        event.request.url = event.request.url.replace(
          /\/(pacientes|focus|sesiones|book|turno|pedidos|consentimientos)\/[a-z0-9-]+/gi,
          "/$1/<id>",
        );
      }
      return event;
    },
  });
}
