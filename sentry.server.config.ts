/** Error-only telemetry. Clinical replay, traces and raw request data are disabled. */
import * as Sentry from "@sentry/nextjs";
import { PRIVATE_SENTRY_OPTIONS } from "@/lib/observability/privacy";

if (process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? "development",
    ...PRIVATE_SENTRY_OPTIONS,
  });
}
