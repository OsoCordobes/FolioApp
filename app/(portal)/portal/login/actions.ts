"use server";

/**
 * Folio · Server Actions del login del PORTAL DEL PACIENTE (Fase 3 · P3).
 *
 * A diferencia del login de staff (password + Google OAuth), el portal usa
 * MAGIC-LINK / OTP por email (`signInWithOtp`): el paciente no elige password.
 * Ventajas para este público:
 *   · Prueba de posesión del email (base del auto-link por email del matcher).
 *   · Cero fricción de "olvidé la contraseña" para pacientes ocasionales.
 *
 * Defensa (espejo del booking público, `book/[slug]/actions.ts`):
 *   · Zod estricto sobre el email.
 *   · Turnstile obligatorio (fail-closed en prod, permisivo en dev sin secret).
 *   · Rate-limit doble: por IP (10/h) y por email (5/h) — frena enum/spam de
 *     magic-links contra un buzón.
 *   · Anti-enumeración: SIEMPRE devuelve ok (no revela si el email tiene cuenta).
 *
 * El magic-link aterriza en /api/auth/callback (el MISMO callback SSR de staff:
 * verifyOtp por ?token_hash / exchange por ?code) que ya refresca la cookie de
 * sesión. Post-verify, el middleware rutea al /portal (ver middleware.ts), donde
 * corre el linkage matcher. `emailRedirectTo` apunta a /portal para que, tras el
 * callback, el usuario caiga en el portal (no en /hoy).
 */

import { headers } from "next/headers";
import { z } from "zod";

import { getAppUrl } from "@/lib/config/app-url";
import { formatResetMessage, limitByIp, limitByKey } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface PortalOtpResult {
  ok: boolean;
  error?: string;
}

const otpInput = z.object({
  email: z.string().email().max(320),
  captchaToken: z.string().optional(),
});

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const raw = h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null;
  return raw ? raw.split(",")[0]?.trim() ?? null : null;
}

/**
 * Envía un magic-link / OTP al email del paciente. Anti-enumeración: uniforme
 * ante cualquier resultado (incluido un email sin cuenta — Supabase con
 * `shouldCreateUser: false` no crea usuario, y nosotros no lo delatamos).
 *
 * DECISIÓN `shouldCreateUser`: false. El portal NO es un signup abierto: un
 * paciente accede porque una org lo cargó y luego se auto-linkea/claim. Permitir
 * crear usuarios arbitrarios por email acá abriría cuentas huérfanas sin ninguna
 * ficha. (El provisioning de la cuenta portal para pacientes nuevos es un flujo
 * aparte, fuera de P3.) Si en el futuro se abre el auto-registro, se flipea acá.
 */
export async function sendPortalMagicLink(
  input: z.infer<typeof otpInput>,
): Promise<PortalOtpResult> {
  const parsed = otpInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Ingresá un email válido." };
  }
  const email = parsed.data.email.trim().toLowerCase();

  const ip = await clientIp();

  // Rate-limit por IP y por email (mismo patrón que resendSignupConfirmation).
  const ipLimit = await limitByIp("portal-otp", ip, 10);
  if (!ipLimit.ok) {
    return { ok: false, error: `Demasiados intentos. ${formatResetMessage(ipLimit.resetIn)}` };
  }
  const emailLimit = await limitByKey("portal-otp-email", email, 5);
  if (!emailLimit.ok) {
    return { ok: false, error: `Demasiados intentos. ${formatResetMessage(emailLimit.resetIn)}` };
  }

  // Turnstile obligatorio (fail-closed en prod). Devolvemos un error claro: acá
  // sí conviene decir "captcha inválido" (no filtra si el email existe).
  const captchaOk = await verifyTurnstile(parsed.data.captchaToken, ip);
  if (!captchaOk) {
    return { ok: false, error: "Verificación anti-robot fallida. Recargá la página." };
  }

  const supabase = await createSupabaseServerClient();
  const appUrl = getAppUrl();
  // No inspeccionamos el error de Supabase: uniforme para anti-enumeración. El
  // magic-link vuelve al callback SSR y de ahí el middleware rutea a /portal.
  await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${appUrl}/api/auth/callback?redirect=/portal`,
    },
  });

  return { ok: true };
}
