/**
 * Folio · Supabase client para Server Components, Server Actions y Route Handlers.
 *
 * Usa @supabase/ssr para integrar con Next.js App Router cookies. Cada request
 * obtiene su propio client (NO singleton — el client depende de cookies).
 *
 * Para Server Components / Server Actions:
 *   const supabase = await createSupabaseServerClient();
 *   const { data, error } = await supabase.from('paciente').select();
 *
 * Para Route Handlers (igual API).
 *
 * NO usar en client components — ahí va createSupabaseBrowserClient.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/supabase/database.types";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} no definida. Configurar en .env.local (ver .env.local.example).`,
    );
  }
  return v;
}

/**
 * Client con cookies del request actual. La sesión del usuario se respeta
 * automáticamente (RLS filtra por auth.uid()).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components no pueden setear cookies; ignore.
            // Las cookies se setean correctamente desde Route Handlers / Actions.
          }
        },
      },
    },
  );
}

/**
 * Client con service_role_key — BYPASEA RLS completamente. Usar SOLO en
 * Server Actions específicas que necesitan privilegios admin (signup flow
 * que crea Organization + Member OWNER antes que el usuario tenga sesión).
 *
 * NUNCA exponer al cliente. NUNCA usar en Route Handlers públicos.
 *
 * El service client se tipa SIN genérico Database hasta que regeneremos
 * los types desde la DB real (los stubs de F3 son demasiado conservadores
 * y TypeScript infiere `never` para los Insert types en algunos casos).
 * Esto NO afecta seguridad — RLS bypass es una propiedad del key, no del type.
 */
export function createSupabaseServiceClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createServerClient<any>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // service client no maneja cookies de sesión
        },
      },
    },
  );
}
