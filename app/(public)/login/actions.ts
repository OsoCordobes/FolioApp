"use server";

/**
 * Folio · Server Actions de autenticación.
 *
 * Estas son las únicas APIs que el cliente toca para login/logout. Cuando
 * la action termina, retorna `{ ok: true }` o `{ ok: false, error }`. El
 * cliente decide qué redirección hacer (usualmente router.push('/hoy')
 * post-login para que el middleware refresque la sesión).
 */

import { captureException } from "@sentry/nextjs";
import { redirect } from "next/navigation";

import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export interface AuthResult {
  ok: boolean;
  error?: string;
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  if (!email || !email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
    return { ok: false, error: "Email inválido." };
  }
  // No enforzamos length >= 8 acá: el signup ya lo enforza al crear la
  // cuenta. Login no debería rechazar una password vieja que cumple la
  // policy histórica del momento en que fue creada. Auditoría LOW: dejar
  // que Supabase responda con "contraseña incorrecta" si no matchea.
  if (!password || password.length === 0) {
    return { ok: false, error: "Ingresá tu contraseña." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Default: generic error to avoid user enumeration ("no decir 'user not
    // found'"). Mantenemos ese default por seguridad.
    //
    // M38 / W6 exception: if the account exists and has ONLY Google as an
    // auth identity (no password), surface a specific message — those users
    // get stuck typing passwords that never existed. We check this AFTER the
    // failed sign-in so we don't leak whether an email is registered for
    // arbitrary lookups (the failed sign-in already confirms a session can't
    // be opened; we're only refining the *reason*).
    const specific = await maybeProviderSpecificError(email);
    return { ok: false, error: specific ?? "Email o contraseña incorrectos." };
  }
  return { ok: true };
}

/**
 * Returns a provider-specific error message when the email belongs to a
 * Google-OAuth-only account (no "email" identity = no password). Returns
 * null in every other case (account doesn't exist, account has both
 * providers, RPC fails) so the caller falls back to the generic message
 * and we preserve the no-enumeration property.
 *
 * Uses the M38 SECURITY DEFINER RPC `user_providers_by_email` so we don't
 * pay for the full admin SDK round-trip just to read the identity list.
 */
async function maybeProviderSpecificError(email: string): Promise<string | null> {
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service.rpc("user_providers_by_email", {
      p_email: email,
    });
    if (error) {
      // Silent failure: we still return the generic message. Captured for
      // observability — a broken RPC shouldn't worsen the login UX.
      captureException(error, {
        tags: { fn: "maybeProviderSpecificError" },
        extra: { email },
      });
      return null;
    }
    // RPC returns a sorted JSONB array (M38). Treat unexpected shapes as
    // "unknown" → generic error.
    if (!Array.isArray(data)) return null;
    const providers = data as string[];
    if (providers.length === 0) return null; // no user → generic
    const hasPassword = providers.includes("email");
    const hasGoogle = providers.includes("google");
    if (hasGoogle && !hasPassword) {
      return "Esta cuenta entra con Google. Probá 'Continuar con Google' arriba.";
    }
    return null;
  } catch (e) {
    captureException(e, { tags: { fn: "maybeProviderSpecificError", stage: "unexpected" } });
    return null;
  }
}

export async function signInWithGoogle(): Promise<AuthResult> {
  const supabase = await createSupabaseServerClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${appUrl}/api/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  if (data.url) {
    redirect(data.url);
  }
  return { ok: true };
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!email || !email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
    return { ok: false, error: "Email inválido." };
  }

  const supabase = await createSupabaseServerClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Phase 4 fix · /reset-password is the canonical landing.
    // /api/auth/reset stays as a 302 shim for any in-flight emails from
    // before this change (see app/api/auth/reset/route.ts).
    redirectTo: `${appUrl}/reset-password`,
  });

  if (error) {
    // Mensaje genérico (no confirmar si el email existe)
    return { ok: true };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  // Limpiar la cookie de org activa para que el próximo user en el mismo
  // navegador no herede el switcher del anterior.
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.delete("folio.active_org");

  redirect("/login");
}
