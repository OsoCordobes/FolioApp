/**
 * Folio · Next.js instrumentation hook.
 *
 * Carga Sentry en el runtime correcto (Node.js vs Edge). Sin DSN configurada,
 * Sentry no envía datos.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (...args: unknown[]) => {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    const { captureRequestError } = await import("@sentry/nextjs");
    return (captureRequestError as (...args: unknown[]) => unknown)(...args);
  }
};
