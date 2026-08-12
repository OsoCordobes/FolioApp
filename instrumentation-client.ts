/**
 * Folio · instrumentation del CLIENTE.
 *
 * ─── Qué estaba roto ───────────────────────────────────────────────────────
 * `sentry.client.config.ts` existía, estaba bien escrito y **nadie lo
 * cargaba**. `instrumentation.ts` importa `sentry.server.config` y
 * `sentry.edge.config` según `NEXT_RUNTIME`, pero ese hook no corre en el
 * browser; y `next.config.ts` nunca pasó por `withSentryConfig`, que es el otro
 * mecanismo que inyecta el init del cliente.
 *
 * Resultado: **ningún error del browser llegaba a Sentry**. Todos los crashes
 * de la ficha —la pantalla donde el profesional trabaja— eran invisibles. El
 * dashboard de Sentry mostraba sólo errores de servidor, así que el silencio se
 * leía como "no hay errores de cliente" en vez de "no estamos escuchando".
 *
 * Next 15.3+ carga `instrumentation-client.ts` automáticamente en el bundle del
 * browser. Importar acá el config que ya existía es todo lo que faltaba.
 *
 * Nota sobre source maps: subirlas necesita `withSentryConfig` con
 * `SENTRY_AUTH_TOKEN` / org / project. Sin eso los stack traces llegan
 * minificados —útiles igual, pero no legibles—. Está anotado como gap en
 * docs/audit/known-gaps.md; no se activa acá para no acoplar el build a un
 * secreto que puede no estar seteado.
 */

import * as Sentry from "@sentry/nextjs";

import "./sentry.client.config";

/**
 * Instrumentación de las navegaciones del App Router. Sin esto, las
 * transacciones de pageload/navigation no se enlazan entre sí.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
