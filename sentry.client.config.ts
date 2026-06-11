/**
 * Folio · Sentry client init.
 *
 * Tracks errors en el bundle del browser. Sin DSN configurada, Sentry no
 * envía datos (init es no-op).
 *
 * Perf (R4): Session Replay NO se registra estático — con
 * `replaysSessionSampleRate: 0` el integration solo sirve para el replay
 * on-error, así que se carga lazy vía `Sentry.lazyLoadIntegration` (baja el
 * bundle del CDN de Sentry post-init y lo agrega con `addIntegration`; los
 * sample rates del init siguen aplicando). El host browser.sentry-cdn.com
 * está allowlisteado en el CSP script-src (next.config.ts). Trade-off
 * aceptado: un error que ocurra antes de que termine la carga del chunk no
 * tiene replay (con session rate 0 igual no había buffer previo).
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,                              // 10% del traffic
    replaysSessionSampleRate: 0.0,                      // off por privacidad
    replaysOnErrorSampleRate: 0.5,                      // capture replay solo si hubo error
    beforeSend(event) {
      // Scrub PII básico (nombres y telefonos en el dom)
      if (event.request?.url?.includes("/pacientes/")) {
        event.request.url = event.request.url.replace(/\/pacientes\/[a-f0-9-]+/i, "/pacientes/<id>");
      }
      return event;
    },
  });

  // Replay lazy (fuera del critical path). Si la carga falla (offline,
  // adblock, CSP), el error tracking sigue funcionando sin replay.
  Sentry.lazyLoadIntegration("replayIntegration")
    .then((replayIntegration) => {
      Sentry.addIntegration(
        replayIntegration({
          maskAllText: true,                            // ocultar datos médicos
          blockAllMedia: true,
          maskAllInputs: true,
        }),
      );
    })
    .catch(() => {
      // no-op: sin replay, pero Sentry sigue capturando errores
    });
}
