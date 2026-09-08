import "server-only";
import { verifyMfaSession } from "@/lib/auth/mfa-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeOperationsSnapshot, type OperationsSnapshot } from "@/lib/operations/model";
import { err, ok, type Result } from "./errors";
/** Independent platform access: no organization, subscription, OWNER role or service client. */
export async function getOperationsSnapshot(): Promise<Result<OperationsSnapshot>> {
  try {
    const client = await createSupabaseServerClient();
    const verified = await verifyMfaSession(client);
    if (!verified.ok) return verified;
    const aal = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal.error || aal.data?.currentLevel !== "aal2" || !verified.data.mfa.sessionValid || !verified.data.mfa.hasVerifiedFactor) return err("mfa_required", "Verificá tu acceso en dos pasos para abrir Operación.");
    // The RPC rechecks current allowlist, expiry, session and factor, then returns only aggregates.
    const { data, error } = await client.rpc("operations_snapshot").abortSignal(AbortSignal.timeout(8000));
    if (error) return error.code === "42501" ? err("forbidden", "No tenés acceso al panel de operación.") : err("db_error", "No pudimos consultar el estado de operación. Volvé a intentar.");
    return ok(normalizeOperationsSnapshot(data));
  } catch { return err("network", "No pudimos consultar el estado de operación. Volvé a intentar."); }
}
