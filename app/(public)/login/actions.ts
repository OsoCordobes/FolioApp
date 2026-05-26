"use server";

/**
 * Folio · Server Actions de autenticación.
 *
 * Estas son las únicas APIs que el cliente toca para login/logout. Cuando
 * la action termina, retorna `{ ok: true }` o `{ ok: false, error }`. El
 * cliente decide qué redirección hacer (usualmente router.push('/hoy')
 * post-login para que el middleware refresque la sesión).
 */

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    // Mensaje genérico para evitar enumeración de usuarios (no decir "user not found")
    return { ok: false, error: "Email o contraseña incorrectos." };
  }
  return { ok: true };
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

/**
 * W9 · Resend the email-confirmation link for the current user.
 *
 * Background: signup currently uses `admin.createUser({ email_confirm: true })`
 * which auto-confirms emails to bypass SMTP rate limits during the demo
 * phase (decision: keep auto-confirm + add opt-in verify-later). This
 * action lets a user proactively verify ownership of their email — useful
 * when:
 *   1. Signup auto-confirmed an email the user might have typo'd.
 *   2. The user changed their email and Supabase asks them to re-verify.
 *   3. We later flip signup to NOT auto-confirm (no code change needed
 *      to activate the banner; emailVerified will flip to false naturally).
 *
 * We surface a generic "ok" result for both success and "already verified"
 * because the latter happens whenever the auto-confirm flow took effect —
 * the banner shouldn't even be shown in that case (it gates on
 * `session.emailVerified === false`), but defending in depth keeps the
 * action idempotent from the client's perspective.
 *
 * Note on SMTP: this calls Supabase's built-in email service. Without
 * custom SMTP configured (SUPABASE Auth → SMTP Settings), the daily quota
 * is small (~30/day on free tier). Wiring a real SMTP provider (Resend /
 * Postmark / SES) is a separate follow-up but doesn't block this action.
 */
export async function requestEmailVerification(): Promise<AuthResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sesión expirada. Volvé a entrar." };
  }
  if (user.email_confirmed_at) {
    // Already verified — banner shouldn't reach here. Be polite.
    return { ok: true };
  }
  if (!user.email) {
    return { ok: false, error: "Tu cuenta no tiene email asociado." };
  }

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: user.email,
  });
  if (error) {
    // Generic message: don't expose Supabase rate-limit windows or internal
    // codes to the UI (matches the pattern from the OAuth callback error
    // sanitization). The Sentry capture gives us the real story.
    return {
      ok: false,
      error: "No pude enviar el link ahora. Probá de nuevo en unos minutos.",
    };
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
