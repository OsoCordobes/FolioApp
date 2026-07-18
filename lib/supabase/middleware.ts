/**
 * Folio · helper de middleware para refresh de sesión Supabase.
 *
 * Lo invoca el `middleware.ts` root en cada request para mantener la cookie
 * de sesión refrescada (los tokens caducan cada hora; @supabase/ssr lo
 * maneja transparentemente si lo invocamos en cada request).
 *
 * Fail-open: si las env vars de Supabase NO están configuradas (modo dev
 * pre-F3 setup, o entorno de visual regression con mocks), retornamos sin
 * tocar nada — la app funciona con mock data y el gating del middleware
 * raíz también queda inactivo.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/supabase/database.types";

export async function updateSupabaseSession(request: NextRequest) {
  // Inyectamos el pathname de la request en los REQUEST headers para que los
  // Server Components (p.ej. el layout de (app)) puedan leerlo vía `headers()`.
  // `headers()` en un RSC devuelve los headers de la request ENTRANTE, no los
  // del response del middleware — por eso debe ir acá, sobre `request.headers`,
  // y propagarse a cada `NextResponse.next({ request: { headers } })`.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { response, user: null };
  }

  const supabase = createServerClient<Database>(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        toSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

/**
 * Folio · P3 · resolución de "audiencia" para el ruteo de precedencia del
 * middleware (staff vs paciente). Se usa SÓLO en las rutas de entrada ambiguas
 * (/, /login, /hoy, /portal…) para decidir a dónde mandar a un usuario logueado
 * — NO en cada request (sería un costo de 2 queries por navegación).
 *
 * Devuelve:
 *   · isMember      — el usuario tiene al menos una membership de staff activa.
 *   · isPortalAccount — el usuario tiene una `paciente_cuenta` viva (M70).
 *
 * Un humano puede ser AMBOS (atiende en su consultorio y es paciente en otro).
 * La PRECEDENCIA la decide el caller (middleware): en Folio, el rol de STAFF
 * gana en las rutas de la app (un profesional que entra por el login normal va a
 * /hoy aunque también tenga cuenta de paciente); el portal es un destino
 * explícito (magic-link con redirect=/portal, o navegación directa a /portal).
 *
 * Fail-open: ante env ausente o error, devuelve ambos en false (el middleware no
 * desvía y deja pasar el gating por defecto) — no bloquea por un hiccup de red.
 */
export async function resolveAudience(
  request: NextRequest,
): Promise<{ isMember: boolean; isPortalAccount: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { isMember: false, isPortalAccount: false };

  const supabase = createServerClient<Database>(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // Read-only: no seteamos cookies acá (el refresh ya lo hizo
      // updateSupabaseSession en la misma request).
      setAll() {},
    },
  });

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
