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
import { writeAuditEntry } from "@/lib/db/audit";
import { err, ok, type Result } from "@/lib/db/errors";
import { setActiveOrg } from "@/lib/db/session";
import { syncSubscriptionAmountInBackground } from "@/lib/db/suscripcion";
import { PRIVACY_VERSION } from "@/lib/legal/versions";
import { signUpSchema } from "@/lib/onboarding/schemas";
import { formatResetMessage, limitByIp, limitByKey } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
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

  const result = data as
    | { organization_id: string; member_id: string; role?: string }
    | null;
  if (!result?.organization_id) {
    return err("db_error", "No pudimos aceptar la invitación. Probá de nuevo.");
  }

  // Audit (Ley 26.529 art. 18): registrar la aceptación app-side. Preferimos
  // esto a tocar la RPC SECURITY DEFINER (menos riesgo). El INSERT lo hace el
  // service client de writeAuditEntry (la RLS de audit_log bloquea INSERT
  // directo). El actor es el propio invitado; el email es PII y va en el
  // payload (ver writeAuditEntry). resource_id = el member materializado.
  await writeAuditEntry({
    organizationId: result.organization_id,
    actorId: user.id,
    actorRole: result.role ?? null,
    action: "member_invitation.accept",
    resourceType: "member",
    resourceId: result.member_id,
    payload: { email: user.email ?? null, role: result.role ?? null },
    // Contexto de red ya computado para rate-limit/consentimiento (Ley 26.529
    // art. 18): el mismo IP/UA que firma el consentimiento ARCO de la RPC.
    ip,
    userAgent: reqHeaders.get("user-agent"),
  });

  // Dejar la org recién aceptada como activa (cookie). Si falla no es fatal:
  // getActiveSession() igual resuelve una membership válida.
  await setActiveOrg(result.organization_id);

  // Fase E (E2): aceptar la invitación suma (o revive — la RPC hace ON
  // CONFLICT ... deleted_at = NULL) un seat → sincronizamos el monto del
  // débito de la org CLINICA. Fire-and-forget: jamás rompe la aceptación;
  // si MP falla, el cron de reconciliación lo reintenta. Para orgs
  // INDEPENDIENTE la decisión interna lo saltea sin tocar nada.
  syncSubscriptionAmountInBackground(result.organization_id, "accept-invitation");

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
  options: { consent?: boolean; turnstileToken?: string | null } = {},
): Promise<InviteeSignUpResult> {
  const parsed = signUpSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  ({ email, password } = parsed.data);

  if (options.consent !== true) {
    return { ok: false, error: "Tenés que aceptar el aviso de privacidad para continuar." };
  }

  // F-AUTH (defensa en profundidad): este endpoint crea una auth.user real
  // (PII médica). El rate-limit solo, sin captcha, deja la puerta abierta a
  // alta automatizada de cuentas para sondear emails / inflar auth.users. Se
  // exige Turnstile igual que el signup de onboarding (mismo helper, mismo
  // flujo: el cliente emite el token y el server lo verifica ANTES de crear
  // la cuenta). El argumento token de invitación no es un control de abuso:
  // un atacante con UN token válido podría reusar esta pantalla N veces.
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
  // Turnstile obligatorio en producción. En dev (sin TURNSTILE_SECRET_KEY) el
  // verifier es no-op (true) para no romper el dev loop — mismo criterio que
  // signUpAndInitOrganization.
  const captchaOk = await verifyTurnstile(options.turnstileToken, ip);
  if (!captchaOk) {
    return {
      ok: false,
      error: "No pude verificar el captcha. Recargá la página y probá de nuevo.",
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
