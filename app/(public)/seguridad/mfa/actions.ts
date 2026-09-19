"use server";

import { enrollTotp, confirmTotp } from "@/lib/auth/mfa-operations";
import { err } from "@/lib/db/errors";
import { limitByKey } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function clientForAttempt(scope: string, maximum: number) {
  try {
  const client = await createSupabaseServerClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { ok: false as const, result: err("auth_required", "Volvé a iniciar sesión.") };
  const limit = await limitByKey(scope, user.id, maximum);
  if (!limit.ok) return { ok: false as const, result: err("validation", "Hubo demasiados intentos. Esperá antes de volver a probar.") };
  return { ok: true as const, client };
  } catch {
    return { ok: false as const, result: err("network", "No pudimos verificar tu sesión. Reintentá.") };
  }
}

export async function enrollMfaAction(friendlyName: string) {
  const access = await clientForAttempt("mfa-enroll", 10);
  if (!access.ok) return access.result;
  return enrollTotp(access.client, friendlyName);
}

export async function verifyMfaAction(factorId: string, code: string) {
  const access = await clientForAttempt("mfa-verify", 30);
  if (!access.ok) return access.result;
  return confirmTotp(access.client, factorId, code);
}
