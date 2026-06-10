"use server";

/**
 * Folio · Server Actions de /invitacion/[token] (M49/M51 · Fase C).
 *
 *   - acceptInvitationAction: RPC SECURITY DEFINER accept_member_invitation
 *     (valida token + email de sesión, materializa profile+member, registra
 *     consentimiento Ley 25.326). Rate-limited por user y por IP.
 *   - signUpForInvitationAction: alta de cuenta MÍNIMA para un invitado que
 *     todavía no existe en auth.users. A diferencia de
 *     signUpAndInitOrganization (onboarding), NO crea organización ni member
 *     OWNER — el member se materializa recién al aceptar la invitación.
 *
 * Tokens: el token crudo solo transita como argumento hacia la RPC (que lo
 * hashea). NUNCA se persiste ni se loguea acá.
 */

import { headers } from "next/headers";

import { findUserByEmail } from "@/lib/auth/find-user-by-email";
import { err, ok, type Result } from "@/lib/db/errors";
import { setActiveOrg } from "@/lib/db/session";
import { PRIVACY_VERSION } from "@/lib/legal/versions";
import { signUpSchema } from "@/lib/onboarding/schemas";
import { formatResetMessage, limitByIp, limitByKey } from "@/lib/security/rate-limit";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

// M2 (docs/AUDIT.md · anti-enumeración): mensaje condicional único — no
// confirma ni niega que la cuenta exista.
const SIGNUP_GENERIC_ERROR =
  "No pudimos crear la cuenta con ese email. Si ya tenés una cuenta, usá “Ya tengo cuenta” con tu contraseña.";

async function callerIp(): Promise<string | null> {
  const reqHeaders = await headers();
  const ipRaw = reqHeaders.get("x-forwarded-for") ?? reqHeaders.get("x-real-ip") ?? null;
  return ipRaw ? ipRaw.split(",")[0].trim() : null;
}

// ─── Aceptar invitación ─────────────────────────────────────────────────────

export interface AcceptInvitationData {
  organizationId: string;
}

export async function acceptInvitationAction(
  token: string,
  options: { consent?: boolean } = {},
): Promise<Result<AcceptInvitationData>> {
  if (!token || token.trim().length === 0) {
    return err("validation", "El link de invitación no es válido.");
  }
  // Consentimiento (Ley 25.326 art. 14): la RPC registra la firma al crear el
  // profile del invitado; exigimos el checkbox antes de invocarla.
  if (options.consent !== true) {
    return err("validation", "Tenés que aceptar el aviso de privacidad para continuar.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return err("auth_required", "Sesión expirada. Volvé a entrar.");

  const ip = await callerIp();
  const ipLimit = await limitByIp("invitation-accept-ip", ip, 30);
  if (!ipLimit.ok) {
    return err("validation", `Demasiados intentos. ${formatResetMessage(ipLimit.resetIn)}`);
  }
  const userLimit = await limitByKey("invitation-accept", user.id, 10);
  if (!userLimit.ok) {
    return err("validation", `Demasiados intentos. ${formatResetMessage(userLimit.resetIn)}`);
  }

  const reqHeaders = await headers();
  const { data, error } = await supabase.rpc("accept_member_invitation", {
    p_token: token,
    p_consent_ip: ip,
    p_consent_user_agent: reqHeaders.get("user-agent"),
    p_consent_legal_text_version: PRIVACY_VERSION,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("no coincide")) {
      return err(
        "forbidden",
        "La invitación es para otro email. Cerrá sesión y entrá con el email que recibió la invitación.",
      );
    }
    if (msg.includes("expiró")) {
      return err("validation", "La invitación expiró. Pedile a la clínica que te invite de nuevo.");
    }
    if (msg.includes("no está pendiente")) {
      return err("validation", "Esta invitación ya no está vigente (fue revocada o usada).");
    }
    if (msg.includes("no encontrada")) {
      return err("not_found", "No encontramos esta invitación. Revisá que el link esté completo.");
    }
    return err("db_error", "No pudimos aceptar la invitación. Probá de nuevo.", msg);
  }

  const result = data as { organization_id: string; member_id: string } | null;
  if (!result?.organization_id) {
    return err("db_error", "No pudimos aceptar la invitación. Probá de nuevo.");
  }

  // Dejar la org recién aceptada como activa (cookie). Si falla no es fatal:
  // getActiveSession() igual resuelve una membership válida.
  await setActiveOrg(result.organization_id);

  return ok({ organizationId: result.organization_id });
}

// ─── Crear cuenta del invitado (sin org) ────────────────────────────────────

export interface InviteeSignUpResult {
  ok: boolean;
  error?: string;
}

export async function signUpForInvitationAction(
  email: string,
  password: string,
  options: { consent?: boolean } = {},
): Promise<InviteeSignUpResult> {
  const parsed = signUpSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  ({ email, password } = parsed.data);

  if (options.consent !== true) {
    return { ok: false, error: "Tenés que aceptar el aviso de privacidad para continuar." };
  }

  // Rate limits (sin Turnstile: a esta pantalla se llega con un token de
  // invitación no adivinable, y el accept posterior valida email + token en
  // la RPC; los límites cubren el abuso del endpoint en sí).
  const ip = await callerIp();
  const ipLimit = await limitByIp("invitation-signup", ip, 30);
  if (!ipLimit.ok) {
    return {
      ok: false,
      error: `Demasiados intentos desde tu red. ${formatResetMessage(ipLimit.resetIn)}`,
    };
  }
  const emailLimit = await limitByKey("invitation-signup-email", email, 10);
  if (!emailLimit.ok) {
    return {
      ok: false,
      error: `Demasiados intentos para este email. ${formatResetMessage(emailLimit.resetIn)}`,
    };
  }

  const service = createSupabaseServiceClient();

  // Crear el auth.user (auto-confirm, mismo criterio que el signup actual).
  // Si ya existía, intentamos abrir sesión con la password recibida — si no
  // coincide, mensaje genérico anti-enumeración.
  const { error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    const lower = createErr.message.toLowerCase();
    if (lower.includes("already") || lower.includes("registered")) {
      const existing = await findUserByEmail(service, email);
      if (!existing) return { ok: false, error: SIGNUP_GENERIC_ERROR };
      if (!existing.email_confirmed_at) {
        await service.auth.admin.updateUserById(existing.id, { email_confirm: true });
      }
      // cae al signIn de abajo
    } else {
      return { ok: false, error: SIGNUP_GENERIC_ERROR };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    return { ok: false, error: SIGNUP_GENERIC_ERROR };
  }

  // NO bootstrapeamos org: el invitado no es OWNER de nada. Su profile +
  // member se materializan al aceptar (accept_member_invitation, M49).
  return { ok: true };
}
