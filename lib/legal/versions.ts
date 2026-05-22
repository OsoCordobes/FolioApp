/**
 * Folio · versiones vigentes de los documentos legales.
 *
 * Single source of truth para que tanto las páginas (server components)
 * como los formularios de consentimiento (client components) lean los
 * mismos valores sin cruzar el límite server/client de Next.js. Importar
 * estas constantes directamente desde `app/(public)/<doc>/page.tsx`
 * provoca que el page se trate como client component (lo cual rompe el
 * `export const metadata`).
 *
 * Bump estos valores cuando los textos cambien materialmente. La columna
 * `pedido.consent_version` registra la versión vigente al momento del
 * consentimiento — útil para evidenciar qué políticas aceptó el usuario.
 */

export const PRIVACY_VERSION = "2026-05-21";
export const TERMS_VERSION = "2026-05-21";
export const COOKIES_VERSION = "2026-05-21";
