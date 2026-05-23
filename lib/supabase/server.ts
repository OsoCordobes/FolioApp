/**
 * Folio · Supabase client para Server Components, Server Actions y Route Handlers.
 *
 * Usa @supabase/ssr para integrar con Next.js App Router cookies. Cada request
 * obtiene su propio client (NO singleton — el client depende de cookies).
 *
 * NOTA TYPES: usamos genérico `<any>` hasta regenerar los types desde la DB
 * real con `pnpm exec supabase gen types typescript --local > lib/supabase/database.types.ts`.
 * El stub manual de database.types.ts causa inferencia a `never` en los
 * Insert types. La seguridad RLS no depende de los types — depende del JWT.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} no definida. Configurar en .env.local (ver .env.local.example).`,
    );
  }
  return v;
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createServerClient<any>(
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
          } catch (e) {
            // En Server Components Next.js no permite setear cookies — eso es
            // esperado y harmless (el middleware refresca la sesión). Pero
            // OTROS errores (header size limit, valor malformado, etc.)
            // significarían sesión rota silenciosamente. Solo tragamos el
            // caso conocido de RSC; logueamos el resto en dev para que no
            // pasen desapercibidos.
            const msg = e instanceof Error ? e.message : String(e);
            const isExpectedRSC =
              msg.includes("Cookies can only be modified") ||
              msg.includes("Server Components");
            if (!isExpectedRSC && process.env.NODE_ENV !== "production") {
              console.warn("[supabase] unexpected cookie set failure:", msg);
            }
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
