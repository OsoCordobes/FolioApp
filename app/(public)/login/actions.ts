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
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAppUrl } from "@/lib/config/app-url";
import { formatResetMessage, limitByIp, limitByKey } from "@/lib/security/rate-limit";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export interface AuthResult {
  ok: boolean;
  error?: string;
  /**
   * Código machine-readable opcional para que la UI ramifique sin regex
   * sobre el mensaje (ítem 1.5: "email_not_confirmed" muestra el botón de
   * reenviar link).
   */
  code?: string;
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
    // Ítem 1.5: cuenta creada con "Confirm email" ON que todavía no confirmó.
    // GoTrue ya distingue este caso en su propio error ("Email not confirmed"),
    // así que mapearlo no agrega enumeración que GoTrue no filtre igual —
    // decisión consciente pro-UX (spec 1.5, riesgo #4). La UI muestra un
    // botón "Reenviar link" cuando code === "email_not_confirmed".
    if (/email not confirmed/i.test(error.message)) {
      return {
        ok: false,
        error: "Tu email todavía no está confirmado. Revisá tu casilla o reenviá el link.",
        code: "email_not_confirmed",
      };
    }
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
  const appUrl = getAppUrl();
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
  const appUrl = getAppUrl();
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
 * Ítem 1.5 · Reenvía el link de confirmación de signup SIN requerir sesión.
 *
 * Con "Confirm email" ON el user recién registrado NO tiene sesión hasta
 * confirmar — el resend W9 (`requestEmailVerification`, que exige sesión)
 * es inútil para él. Esta action cubre ese gap: la llama el CheckEmailPanel
 * ("Revisá tu email") y el botón "Reenviar link" del login cuando la cuenta
 * existe pero no está confirmada.
 *
 * Anti-enumeración: siempre devuelve `{ ok: true }` aunque Supabase falle o
 * el email no exista/ya esté confirmado — el caller no puede distinguir.
 * Abuso: rate-limit doble server-side (10/h por IP + 5/h por email) +
 * cooldown de 60s por email propio de GoTrue como backstop + cooldown
 * client-side del panel. Con Upstash sin provisionar (F0.4) los límites son
 * fail-open por diseño (lib/security/rate-limit.ts).
 */
export async function resendSignupConfirmation(email: string): Promise<AuthResult> {
  if (!email || !email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
    return { ok: false, error: "Email inválido." };
  }

  const reqHeaders = await headers();
  const ipRaw = reqHeaders.get("x-forwarded-for") ?? reqHeaders.get("x-real-ip") ?? null;
  const ip = ipRaw ? ipRaw.split(",")[0].trim() : null;
  const ipLimit = await limitByIp("resend-confirm", ip, 10);
  if (!ipLimit.ok) {
    return {
      ok: false,
      error: `Demasiados reenvíos. ${formatResetMessage(ipLimit.resetIn)}`,
    };
  }
  const emailLimit = await limitByKey("resend-confirm-email", email, 5);
  if (!emailLimit.ok) {
    return {
      ok: false,
      error: `Demasiados reenvíos. ${formatResetMessage(emailLimit.resetIn)}`,
    };
  }

  const supabase = await createSupabaseServerClient();
  const appUrl = getAppUrl();
  await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${appUrl}/api/auth/callback` },
  });
  // Uniforme incluso ante error de Supabase (anti-enumeración; GoTrue tiene
  // su propio cooldown 60s/email como backstop del abuso).
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

  // Ítem 1.5: rate-limit server-side (antes solo había cooldown client-side
  // en sessionStorage del banner — trivialmente bypasseable). Mismo scope
  // que resendSignupConfirmation para que ambos paths compartan la ventana.
  const emailLimit = await limitByKey("resend-confirm-email", user.email, 5);
  if (!emailLimit.ok) {
    return {
      ok: false,
      error: `Demasiados reenvíos. ${formatResetMessage(emailLimit.resetIn)}`,
    };
  }

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: user.email,
    // Ítem 1.5: sin emailRedirectTo el link caía al Site URL default de
    // Supabase; ahora aterriza en el callback que rutea según el estado del
    // onboarding (mismo destino que el link original de signup).
    options: { emailRedirectTo: `${getAppUrl()}/api/auth/callback` },
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

  // Al landing público (no /login): desde ahí hay "Ingresar" para volver a entrar.
  redirect("/");
}
