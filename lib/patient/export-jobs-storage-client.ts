import "server-only";

import { createClient } from "@supabase/supabase-js";

/** Supabase Storage upload() has no per-call signal in the installed SDK.
 * A dedicated client gives every private object request a hard 15 s abort.
 * Cleanup starts at least five minutes after job expiry and requires another
 * stable-empty scan before confirmation. */
export function privateExportBucket() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("private_storage_configuration_missing");
  const boundedFetch: typeof fetch = (input, init) => {
    const timeout = AbortSignal.timeout(15000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal, cache: "no-store" });
  };
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: boundedFetch },
  }).storage.from("folio-export-packages");
}
