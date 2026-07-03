/**
 * Folio · Dominio único de la app (ítem 1.3).
 *
 * Única fuente para URLs absolutas del deployment. Reemplaza lib/base-url.ts
 * y todos los fallbacks hardcodeados a folio-app-ten.vercel.app.
 *
 * IMPORTANTE: process.env.NEXT_PUBLIC_APP_URL debe leerse como expresión
 * literal completa (nunca process.env[name] ni destructuring) — Next la
 * inlinea en build en TODOS los bundles (server y client), así el valor es
 * idéntico en SSR y browser (sin hydration mismatch cuando está seteada).
 *
 * Nunca throwea: en browser sin env cae a window.location.origin; en server
 * sin env cae a las system envs de Vercel (VERCEL_PROJECT_PRODUCTION_URL es
 * el dominio de producción del proyecto y se actualiza solo cuando F0.2
 * agregue el dominio custom) y por último a localhost:3010.
 */

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/** URL absoluta con protocolo, sin trailing slash. Server-safe y client-safe. */
export function getAppUrl(): string {
  // .trim(): un `vercel env pull` puede materializar la var como "" (o con
  // whitespace) — sin trim, "   " es truthy y new URL("   ") rompe el build.
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);
  if (typeof window !== "undefined") return window.location.origin;
  // Las VERCEL_* no llevan protocolo (Vercel las expone como host). En el
  // client bundle son undefined (no NEXT_PUBLIC_), pero el branch de window
  // corta antes — el orden es correcto.
  const prodDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prodDomain) return `https://${stripTrailingSlash(prodDomain)}`;
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${stripTrailingSlash(vercelUrl)}`;
  return "http://localhost:3010";
}

/** Host para display (ej. "folio-app-ten.vercel.app"), sin protocolo. */
export function getAppHost(): string {
  return getAppUrl().replace(/^https?:\/\//, "");
}
