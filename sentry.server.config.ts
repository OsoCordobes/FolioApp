/**
 * Folio · Sentry server init (Node.js runtime).
 *
 * Tracks errores en Server Components, Server Actions y API routes.
 */

import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Scrub: jamás reportar el body de requests porque puede contener
      // datos clínicos / PII.
      if (event.request) {
        delete event.request.data;
      }
      return event;
    },
  });
}
