/**
 * Folio · decisión de ruteo del middleware, pura y testeable.
 *
 * El `middleware.ts` raíz tenía la tabla de rutas públicas y todas las ramas de
 * gating mezcladas con el I/O (refresh de sesión, queries de audiencia,
 * construcción de responses). Eso hacía imposible testear el ruteo sin levantar
 * un runtime de middleware, que es justamente donde vivía el bug del loop de
 * login: nadie podía escribir un test que dijera "con sesión, `/` redirige a
 * /hoy Y conserva las cookies".
 *
 * Acá vive SOLO la decisión: dado un pathname y si hay sesión, ¿qué corresponde?
 * El middleware queda como adaptador delgado que ejecuta esa decisión.
 *
 * Las ramas replican exactamente el comportamiento previo — incluida la sutil:
 * un usuario de STAFF parado en /portal/login NO se redirige, porque puede
 * querer entrar a un buzón distinto.
 */

/** Rutas públicas exactas (sin sesión, pasan). */
export const PUBLIC_PATHS = [
  "/",                      // landing de marketing
  "/login",
  "/onboarding",
  "/forgot",
  "/reset-password",        // landing del mail de recuperación de Supabase
  "/privacidad",            // Aviso de privacidad (Ley 25.326) — linkeado desde el consent del signup
  "/terminos",              // Términos del servicio — ídem
  "/cookies",               // Política de cookies — la página es pública y los anónimos eran redirigidos a /login
  "/api/health",            // healthcheck (load balancer, uptime monitoring)
  "/api/analytics/refresh", // cron diario (validado por CRON_SECRET bearer)
  "/sitemap.xml",           // SEO — los crawlers no tienen sesión
  "/robots.txt",            // SEO — ídem
  "/profesionales",         // directorio público (Fase 3) — índice; los hubs van por prefijo
  "/portal/login",          // login del portal del paciente (P3) — magic-link, sin sesión
  "/cuenta-error",          // salida del ping-pong /hoy ↔ /onboarding: el usuario TIENE sesión pero su contexto de app no resuelve, así que no puede pasar por un gate que dependa de ese contexto
] as const;

/** Prefijos públicos. */
export const PUBLIC_PREFIXES = [
  "/book/",              // booking público F7
  "/t/",                 // confirmación 1-click desde el email (F7b · M90) — token HMAC, sin sesión
  "/profesionales/",     // directorio público — hubs por especialidad/provincia
  "/invitacion/",        // aceptación de invitación (M49/M51) — la página maneja con y sin sesión
  "/api/auth/",          // OAuth callbacks de Supabase
  "/api/cron/",          // Vercel Cron (validado por CRON_SECRET bearer)
  "/api/admin/",         // admin one-shot ops (validado por CRON_SECRET bearer)
  "/api/whatsapp/",      // webhook Meta WhatsApp (validado por X-Hub-Signature)
  "/api/google/",        // OAuth callback de Google + watch renew
  "/api/mercadopago/",   // webhook Mercado Pago (validado por x-signature HMAC)
  "/dev/",               // preview routes de QA; las pages hacen 404 en producción
  "/opengraph-image",    // Next sirve la ruta con sufijo hash (p.ej. /opengraph-image-pwu6ef)
] as const;

export function isPublicPath(pathname: string): boolean {
  if ((PUBLIC_PATHS as readonly string[]).includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function isPortalPath(pathname: string): boolean {
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

/**
 * Qué hacer con una request.
 *
 * `needs_audience` significa "hay que resolver si es staff, paciente o ambos
 * antes de decidir" — es la única rama que cuesta queries, por eso se limita a
 * las rutas de entrada ambiguas en vez de correr en cada navegación.
 */
export type RouteGate =
  | { kind: "pass" }
  /** Sesión vencida sobre /api/portal/*: 401 JSON, no el HTML del login de staff. */
  | { kind: "json_401" }
  | { kind: "redirect"; to: string; keepRedirectParam: boolean }
  | { kind: "needs_audience"; scope: "entry" | "portal_login" | "portal" };

export function decideRouteGate(pathname: string, hasUser: boolean): RouteGate {
  if (!hasUser) {
    if (isPublicPath(pathname)) return { kind: "pass" };
    // /api/portal/* es audiencia PORTAL pero es API: con la sesión vencida
    // responde 401 JSON. Antes, bajar "Mis datos" con la sesión caída devolvía
    // el HTML del login equivocado.
    if (pathname.startsWith("/api/portal/")) return { kind: "json_401" };
    // El portal tiene su propio login (magic-link): un anónimo que pide
    // /portal/* no va al login de staff, que pide password y es otro público.
    if (isPortalPath(pathname)) {
      return { kind: "redirect", to: "/portal/login", keepRedirectParam: false };
    }
    return { kind: "redirect", to: "/login", keepRedirectParam: true };
  }

  // Con sesión: precedencia staff vs paciente sólo en las rutas ambiguas.
  if (pathname === "/login" || pathname === "/") {
    return { kind: "needs_audience", scope: "entry" };
  }
  if (pathname === "/portal/login") {
    return { kind: "needs_audience", scope: "portal_login" };
  }
  if (isPortalPath(pathname)) {
    return { kind: "needs_audience", scope: "portal" };
  }
  return { kind: "pass" };
}

export interface Audience {
  /** Tiene al menos una membership de staff activa. */
  isMember: boolean;
  /** Tiene una `paciente_cuenta` viva (M70). */
  isPortalAccount: boolean;
}

/**
 * Destino de las rutas de entrada (`/` y `/login`) con sesión.
 * STAFF gana: un profesional que también es paciente en otro consultorio entra
 * a /hoy, no al portal. El portal es un destino explícito (magic-link con
 * redirect=/portal, o navegación directa).
 */
export function entryDestination({ isMember, isPortalAccount }: Audience): string {
  return isPortalAccount && !isMember ? "/portal" : "/hoy";
}

/**
 * Destino de /portal/login con sesión. `null` = dejar pasar.
 *
 * Ojo con esta rama: una sesión de STAFF en /portal/login **no** se redirige —
 * puede querer entrar a un buzón distinto.
 */
export function portalLoginDestination({ isPortalAccount }: Audience): string | null {
  return isPortalAccount ? "/portal" : null;
}

/**
 * Destino de /portal/* (que no sea el login) con sesión. `null` = dejar pasar.
 * Un profesional sin ficha de paciente no tiene nada que hacer en el portal.
 */
export function portalDestination({ isMember, isPortalAccount }: Audience): string | null {
  if (isPortalAccount) return null;
  return isMember ? "/hoy" : "/portal/login";
}
