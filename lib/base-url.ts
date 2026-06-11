/**
 * Folio · Base URL pública del deployment.
 *
 * Única fuente para construir URLs absolutas (metadataBase, sitemap, robots,
 * JSON-LD). `NEXT_PUBLIC_APP_URL` manda; sin ella caemos al dominio Vercel
 * de producción. Server-safe y client-safe (solo lee env NEXT_PUBLIC).
 */

export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://folio-app-ten.vercel.app";
}
