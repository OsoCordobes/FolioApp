/**
 * Folio · middleware raíz.
 *
 * Responsabilidades:
 *   1. Refrescar la sesión Supabase en cada request (cookies → JWT actualizado).
 *   2. Gating de auth: redirigir a /login si no hay sesión y la ruta está bajo (app).
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
 */

import { NextResponse, type NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = [
  "/login",
  "/onboarding",
  "/forgot",
  "/api/health",            // healthcheck (load balancer, uptime monitoring)
  "/api/analytics/refresh", // cron diario (validado por CRON_SECRET bearer)
];

const PUBLIC_PREFIXES = [
  "/book/",              // booking público F7
  "/api/auth/",          // OAuth callbacks Supabase
  "/api/cron/",          // Vercel Cron (validado por CRON_SECRET bearer)
  "/api/admin/",         // admin one-shot ops (migrate, etc; validado por CRON_SECRET bearer)
  "/api/whatsapp/",      // webhook Meta WhatsApp (validado por X-Hub-Signature)
  "/api/google/",        // OAuth callback Google + watch renew
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSupabaseSession(request);
  const { pathname } = request.nextUrl;

  // Header siempre seteado: el layout lo lee para decidir si el gating de
  // suscripción debe redirigir o dejar pasar (cuando ya estás en billing,
  // no podés redirigir a billing — sería loop infinito).
  response.headers.set("x-pathname", pathname);

  // Sin Supabase configurado, no aplicamos auth gating
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return response;
  }

  // Si no hay user y la ruta NO es pública → redirect a login
  if (!user && !isPublicPath(pathname) && pathname !== "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Si hay user y va a /login → redirect a /hoy
  if (user && (pathname === "/login" || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/hoy";
    return NextResponse.redirect(url);
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
