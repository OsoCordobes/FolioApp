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
  let response = NextResponse.next({ request });

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
        response = NextResponse.next({ request });
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
