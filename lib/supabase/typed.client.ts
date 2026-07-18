"use client";

/**
 * Folio · wrapper Supabase TIPADO para CÓDIGO NUEVO (browser / Client
 * Components). Contraparte de `typed.ts` (server) — separada en su propio
 * módulo `"use client"` para no arrastrar `server-only` a los bundles del
 * cliente.
 *
 * El client del browser (`client.ts`) YA está parametrizado con `<Database>`,
 * así que este wrapper es un alias tipado explícito por simetría de nombres con
 * el lado server (`createTypedServerClient` / `createTypedServiceClient`). Uso:
 *
 *   import { createTypedBrowserClient } from "@/lib/supabase/typed.client";
 *   const supabase = createTypedBrowserClient();
 *
 * RLS se respeta vía `auth.uid()` del JWT; estos tipos NO son la frontera de
 * seguridad (CLAUDE.md). Ver `typed.ts` para el contexto completo del PR S1.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Cliente tipado para Client Components (singleton por sesión del browser).
 * Equivalente tipado de `createSupabaseBrowserClient`.
 */
export function createTypedBrowserClient(): SupabaseClient<Database> {
  return createSupabaseBrowserClient() as unknown as SupabaseClient<Database>;
}
