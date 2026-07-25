/**
 * Folio · middleware raíz.
 *
 * Responsabilidades:
 *   1. Refrescar la sesión Supabase en cada request (cookies → JWT actualizado).
 *   2. Gating de auth: redirigir a /login si no hay sesión y la ruta está bajo (app).
 *      Audiencia portal sin sesión: /portal/* → /portal/login; /api/portal/* → 401 JSON.
 *   3. Gating reverso: si hay sesión y el usuario va a /login, redirigir a /hoy.
 *
 * Fail-open: si Supabase NO está configurado (env vars vacías), todo pasa
 * sin redirects — esto permite visual regression con mock data y modo
 * dev pre-F3 setup.
 *
 * Skip patterns:
 *   - /_next/* — assets de Next
 *   - /api/auth/callback — Supabase OAuth callbacks
 *   - /folio.css, favicons, public assets — estáticos
 *   - /book/* — booking público (no requiere auth, F7)
 *   - /dev/* — preview routes para QA visual; en producción cada page
 *     responde 404 vía notFound() (defensa en profundidad).
 */

import { NextResponse, type NextRequest } from "next/server";

import { resolveAudience, updateSupabaseSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = [
  "/",                      // landing de marketing
  "/login",
  "/onboarding",
  "/forgot",
  "/reset-password",        // Supabase password-recovery email landing (Phase 4)
  "/privacidad",            // Aviso de privacidad (Ley 25.326) — linkeado desde consent del signup
  "/terminos",              // Términos del servicio — linkeado desde consent del signup
  "/cookies",               // Política de cookies — bugfix: la página es pública (app/(public)/cookies) pero anónimos eran redirigidos a /login
  "/api/health",            // healthcheck (load balancer, uptime monitoring)
  "/api/analytics/refresh", // cron diario (validado por CRON_SECRET bearer)
  "/sitemap.xml",           // SEO — generado por app/sitemap.ts; los crawlers no tienen sesión
  "/robots.txt",            // SEO — generado por app/robots.ts; ídem
  "/profesionales",         // directorio público (Fase 3) — índice; los hubs van por PUBLIC_PREFIXES
  "/portal/login",          // login del portal del paciente (Fase 3 · P3) — magic-link, sin sesión
];

const PUBLIC_PREFIXES = [
  "/book/",              // booking público F7
  "/profesionales/",     // directorio público (Fase 3) — hubs por especialidad/provincia
  "/invitacion/",        // aceptación de invitación de equipo (M49/M51) — la página maneja ambos estados (con y sin sesión)
  "/api/auth/",          // OAuth callbacks Supabase
  "/api/cron/",          // Vercel Cron (validado por CRON_SECRET bearer)
  "/api/admin/",         // admin one-shot ops (migrate, etc; validado por CRON_SECRET bearer)
  "/api/whatsapp/",      // webhook Meta WhatsApp (validado por X-Hub-Signature)
  "/api/google/",        // OAuth callback Google + watch renew
  "/api/mercadopago/",   // webhook Mercado Pago (validado por x-signature HMAC)
  "/dev/",               // dev-only preview routes (decoration, card-moods, etc.) — pages themselves 404 in NODE_ENV=production
  "/opengraph-image",    // imagen OG del landing — Next sirve la ruta con sufijo hash (p.ej. /opengraph-image-pwu6ef), por eso prefix
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSupabaseSession(request);
  const { pathname } = request.nextUrl;

  // El `x-pathname` lo inyecta `updateSupabaseSession` sobre los REQUEST
  // headers (no el response) para que el layout lo lea vía `headers()`. El
  // layout lo usa para el gating de suscripción: cuando ya estás en billing
  // no podés redirigir a billing — sería loop infinito.

  // Sin Supabase configurado, no aplicamos auth gating
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return response;
  }

  const isPortalPath = pathname === "/portal" || pathname.startsWith("/portal/");
  const isPortalLogin = pathname === "/portal/login";

  // ─── Sin sesión ─────────────────────────────────────────────────────────────
  // Ruta no pública → login. El portal tiene SU PROPIO login (magic-link): un
  // anónimo que pide /portal (o cualquier /portal/*) va a /portal/login, no al
  // login de staff (que pide password y es otro público).
  if (!user && !isPublicPath(pathname)) {
    // /api/portal/* también es audiencia PORTAL, pero es API: con la sesión
    // vencida respondemos 401 JSON (mismo shape de error que las routes de
    // /api/portal/*) en vez de redirigir al login de STAFF — antes, descargar
    // "Mis datos" con sesión vencida devolvía el HTML del login equivocado.
    if (pathname.startsWith("/api/portal/")) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "auth_required",
            message: "Tu sesión expiró. Volvé a entrar al portal.",
          },
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const url = request.nextUrl.clone();
    if (isPortalPath) {
      url.pathname = "/portal/login";
    } else {
      url.pathname = "/login";
      url.searchParams.set("redirect", pathname);
    }
    return NextResponse.redirect(url);
  }

  // ─── Con sesión · ruteo de PRECEDENCIA staff vs paciente (P3) ────────────────
  // Un humano puede ser member (staff) Y paciente_cuenta (portal) a la vez. La
  // precedencia se resuelve SÓLO en las rutas de entrada ambiguas para no pagar
  // el costo de resolveAudience() en cada request:
  //   · /login, / (raíz)  → si es SÓLO paciente (no staff) → /portal; si es
  //     staff (aunque también sea paciente) → /hoy. STAFF gana en la app.
  //   · /portal/login      → si ya hay sesión con cuenta de portal → /portal.
  //   · /portal/* (no login) → si el user NO es cuenta de portal pero SÍ es
  //     staff → /hoy (un profesional sin ficha no tiene nada que hacer en el
  //     portal); si no es ninguno → /portal/login (defensa; no debería pasar
  //     con sesión válida de portal).
  if (user) {
    if (pathname === "/login" || pathname === "/") {
      const { isMember, isPortalAccount } = await resolveAudience(request);
      const url = request.nextUrl.clone();
      url.search = "";
      url.pathname = isPortalAccount && !isMember ? "/portal" : "/hoy";
      return NextResponse.redirect(url);
    }

    if (isPortalLogin) {
      const { isPortalAccount } = await resolveAudience(request);
      if (isPortalAccount) {
        const url = request.nextUrl.clone();
        url.search = "";
        url.pathname = "/portal";
        return NextResponse.redirect(url);
      }
      // Sesión de staff en /portal/login: no lo forzamos a portal. Lo dejamos
      // ver el login del portal (puede querer entrar a un buzón distinto).
      return response;
    }

    if (isPortalPath) {
      const { isMember, isPortalAccount } = await resolveAudience(request);
      if (!isPortalAccount) {
        const url = request.nextUrl.clone();
        url.search = "";
        url.pathname = isMember ? "/hoy" : "/portal/login";
        return NextResponse.redirect(url);
      }
      // Cuenta de portal en /portal/* → dejar pasar.
      return response;
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths excepto:
     * - _next/static, _next/image
     * - favicon, folio.css, archivos estáticos
     * - rutas que start con `/_` (internal Next.js)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|folio\\.css|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)",
  ],
};
