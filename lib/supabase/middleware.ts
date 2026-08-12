/**
 * Folio · helper de middleware para el refresh de sesión de Supabase.
 *
 * Lo invoca el `middleware.ts` raíz en cada request para mantener la cookie de
 * sesión fresca (los tokens caducan cada hora; @supabase/ssr lo maneja solo si
 * lo llamamos en cada request).
 *
 * ─── El bug que arreglan estas funciones ────────────────────────────────────
 * El refresh token de Supabase ROTA: cada vez que se usa, GoTrue emite uno
 * nuevo e invalida el anterior. Eso significa que si una request refresca la
 * sesión y la response que sale al browser NO lleva las cookies nuevas, el
 * token rotado se pierde para siempre — y el request siguiente llega con el
 * viejo, que GoTrue rechaza con "Invalid Refresh Token: Already Used".
 *
 * Había dos fugas, y las dos se juntaban en el reporte del cliente ("al entrar
 * me devuelve a la página de inicio, en loop"):
 *
 *   1. Cada `NextResponse.redirect(...)` del middleware era una response NUEVA,
 *      sin las cookies refrescadas. Y con sesión, `/` y `/login` SIEMPRE
 *      redirigen — o sea que el camino más común era el que perdía el token.
 *      Por eso ahora existe `redirectWithCookies`.
 *
 *   2. Los headers de la request que se forwardean a los Server Components se
 *      clonaban ANTES de que `setAll` escribiera las cookies nuevas en
 *      `request.cookies`. Los RSC río abajo veían el header `cookie` viejo,
 *      abrían su propio client con el token ya rotado e intentaban refrescar de
 *      nuevo → la misma excepción, ahora desde el server component. El clon se
 *      rehace DESPUÉS de mutar `request.cookies` (`request.cookies.set()`
 *      escribe a través del header `cookie` de la request, así que el clon
 *      posterior sale con los tokens nuevos).
 *
 * Fail-open: si faltan las env vars de Supabase (dev pre-setup, o el entorno de
 * visual regression con mocks), devolvemos sin tocar nada.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/supabase/database.types";

type SupabaseMiddlewareClient = ReturnType<typeof createServerClient<Database>>;

/**
 * Copia TODAS las cookies de una response a otra, con todos sus atributos.
 *
 * `getAll()` devuelve objetos `ResponseCookie` completos (name, value, path,
 * domain, maxAge/expires, httpOnly, secure, sameSite) y `set(cookie)` los
 * acepta enteros. Copiar sólo name/value sería peor que no copiar nada: el
 * browser trata una cookie con distinto `path` o `sameSite` como OTRA cookie,
 * así que la sesión quedaría duplicada y rota de una forma mucho más difícil de
 * diagnosticar.
 */
export function withResponseCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}

/** `NextResponse.redirect` que se lleva puestas las cookies de sesión refrescadas. */
export function redirectWithCookies(from: NextResponse, url: URL | string): NextResponse {
  return withResponseCookies(from, NextResponse.redirect(url));
}

/** `NextResponse.json` que conserva las cookies (el 401 de /api/portal/*). */
export function jsonWithCookies(
  from: NextResponse,
  body: unknown,
  init: ResponseInit,
): NextResponse {
  return withResponseCookies(from, NextResponse.json(body, init));
}

export async function updateSupabaseSession(request: NextRequest): Promise<{
  response: NextResponse;
  user: Awaited<ReturnType<SupabaseMiddlewareClient["auth"]["getUser"]>>["data"]["user"];
  supabase: SupabaseMiddlewareClient | null;
}> {
  // `x-pathname` viaja en los REQUEST headers para que los Server Components lo
  // lean con `headers()` — en un RSC eso devuelve los headers de la request
  // ENTRANTE, no los del response del middleware. Es load-bearing para el gate
  // de billing de app/(app)/layout.tsx: estando ya en /configuracion/billing no
  // se puede redirigir a billing, sería un loop.
  const forwardHeaders = () => {
    const h = new Headers(request.headers);
    h.set("x-pathname", request.nextUrl.pathname);
    return h;
  };

  let response = NextResponse.next({ request: { headers: forwardHeaders() } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { response, user: null, supabase: null };
  }

  const supabase = createServerClient<Database>(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        // 1. Escribir en la request: `request.cookies.set` actualiza el header
        //    `cookie` subyacente.
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        // 2. Recién ahora re-clonar los headers, para que los Server Components
        //    reciban los tokens NUEVOS y no vuelvan a intentar el refresh con
        //    uno ya rotado.
        response = NextResponse.next({ request: { headers: forwardHeaders() } });
        // 3. Y mandarlas al browser.
        toSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user, supabase };
}

/**
 * Folio · P3 · resolución de "audiencia" para el ruteo de precedencia del
 * middleware (staff vs paciente). Se usa SÓLO en las rutas de entrada ambiguas
 * (/, /login, /portal…) para no pagar 2 queries por navegación.
 *
 * Recibe el client que ya creó `updateSupabaseSession`: abrir uno segundo con
 * `setAll(){}` no-op —como hacía antes— significa que si el refresh caía en ESA
 * llamada, las cookies nuevas se descartaban en silencio.
 *
 * Fail-open: ante error devuelve ambos en false (el middleware no desvía) — un
 * hiccup de red no puede sacar a nadie de la app.
 */
export async function resolveAudience(
  supabase: SupabaseMiddlewareClient | null,
): Promise<{ isMember: boolean; isPortalAccount: boolean }> {
  if (!supabase) return { isMember: false, isPortalAccount: false };

  try {
    const [{ data: cuentaId }, memberRes] = await Promise.all([
      supabase.rpc("paciente_cuenta_actual"),
      supabase
        .from("member")
        .select("id")
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      isMember: Boolean(memberRes.data),
      isPortalAccount: Boolean(cuentaId),
    };
  } catch {
    return { isMember: false, isPortalAccount: false };
  }
}
