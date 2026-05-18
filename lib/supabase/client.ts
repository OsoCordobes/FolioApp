"use client";

/**
 * Folio · Supabase client para Client Components.
 *
 * Singleton por sesión del browser. Maneja cookies vía @supabase/ssr.
 *
 *   const supabase = createSupabaseBrowserClient();
 *   const { data } = await supabase.from('paciente').select();
 *
 * RLS se respeta vía auth.uid() del JWT.
 */

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/database.types";

let cachedClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createSupabaseBrowserClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY no definidas. Ver .env.local.example.",
    );
  }

  cachedClient = createBrowserClient<Database>(url, anon);
  return cachedClient;
}
