/**
 * Folio · middleware raíz.
 *
 * Responsabilidades:
 *   1. Refrescar la sesión de Supabase en cada request (cookies → JWT al día).
 *   2. Gating de auth: sin sesión y bajo (app) → /login. Audiencia portal:
 *      /portal/* → /portal/login; /api/portal/* → 401 JSON.
 *   3. Ruteo de precedencia staff vs paciente en las rutas de entrada.
 *
 * Este archivo es un ADAPTADOR delgado. La decisión de ruteo (qué es público,
 * a dónde va cada caso) vive pura y testeada en `lib/auth/route-decision.ts`;
 * el manejo de cookies y del client, en `lib/supabase/middleware.ts`.
 *
 * ⚠️ INVARIANTE: **toda** response que sale de acá tiene que llevar las cookies
 * de sesión refrescadas. El refresh token de Supabase rota, así que una
 * response que las pierde deja el token viejo en el browser y la próxima
 * request muere con "Invalid Refresh Token: Already Used" → sesión caída →
 * landing. Ese era el loop de login que reportó el cliente. Por eso no hay ni
 * un `NextResponse.redirect` pelado en este archivo: todos pasan por
 * `redirectWithCookies` / `jsonWithCookies`.
 *
 * Fail-open: sin Supabase configurado (env vars vacías) todo pasa sin
 * redirects — permite la visual regression con mock data y el dev pre-setup.
 */

import { type NextRequest } from "next/server";

import {
  decideRouteGate,
  entryDestination,
  portalDestination,
  portalLoginDestination,
} from "@/lib/auth/route-decision";
import {
  jsonWithCookies,
  redirectWithCookies,
  resolveAudience,
  updateSupabaseSession,
} from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response, user, supabase } = await updateSupabaseSession(request);
  const { pathname } = request.nextUrl;

  // Sin Supabase configurado no aplicamos gating.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return response;
  }

  const gate = decideRouteGate(pathname, Boolean(user));

  if (gate.kind === "pass") return response;

  if (gate.kind === "json_401") {
    return jsonWithCookies(
      response,
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

  if (gate.kind === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = gate.to;
    if (gate.keepRedirectParam) {
      url.searchParams.set("redirect", pathname);
    }
    return redirectWithCookies(response, url);
  }

  // needs_audience: las únicas ramas que cuestan queries.
  const audiencia = await resolveAudience(supabase);

  const destino =
    gate.scope === "entry"
      ? entryDestination(audiencia)
      : gate.scope === "portal_login"
        ? portalLoginDestination(audiencia)
        : portalDestination(audiencia);

  if (destino === null) return response;

  const url = request.nextUrl.clone();
  url.search = "";
  url.pathname = destino;
  return redirectWithCookies(response, url);
}

export const config = {
  matcher: [
    /*
     * Todas las rutas excepto:
     * - _next/static, _next/image
     * - favicon, folio.css, estáticos
     * - rutas que empiezan con `/_` (internas de Next)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|folio\\.css|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)",
  ],
};
