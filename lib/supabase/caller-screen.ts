import "server-only";

import { createClient } from "@supabase/supabase-js";

/** Dedicated anonymous RPC client. It never reads or forwards staff cookies. */
export function createCallerScreenClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("caller_screen_configuration_missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(12000) }) },
  });
}
