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
 *     Exige una invitación PENDIENTE, vigente y con el mismo email antes de
 *     crear nada.
 *
 * Tokens: el token crudo solo transita como argumento hacia la RPC (que lo
 * hashea) o hacia hashInvitationToken (sha256 local). NUNCA se persiste ni se
 * loguea acá.
 */

import { headers } from "next/headers";

import { classifySignUpOutcome } from "@/lib/auth/signup-outcome";
import { getAppUrl } from "@/lib/config/app-url";
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

import {
  checkInvitationForSignup,
  hashInvitationToken,
  isWellFormedInvitationToken,
} from "./invitation-guard";

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
  /**
   * "Confirm email" ON en Supabase: la cuenta quedó creada pero SIN sesión
   * hasta que el invitado abra el link del mail. La UI muestra "Revisá tu
   * email" en vez de refrescar la página.
   */
  needsConfirmation?: boolean;
}

/**
 * Alta de cuenta de un invitado.
 *
 * F-AUTH (auditoría): esta action creaba la cuenta con
 * `service.auth.admin.createUser({ email_confirm: true })` — service-role, o
 * sea salteando GoTrue — SIN mirar la invitación, y si el email ya existía
 * FORZABA `email_confirm: true` sobre la cuenta ajena ANTES de validar la
 * password. Cualquiera con la URL de la action podía crear cuentas
 * auto-confirmadas y anular el toggle "Confirm email" de producción.
 *
 * Ahora:
 *   1. rate-limit + Turnstile (como antes);
 *   2. la invitación tiene que existir, estar PENDIENTE, no vencida y con el
 *      MISMO email (mismas condiciones que accept_member_invitation, M49);
 *   3. el alta va por `supabase.auth.signUp` — el camino canónico del repo,
 *      que respeta el toggle "Confirm email";
 *   4. jamás tocamos el estado de confirmación de una cuenta ajena.
 *
 * Todos los caminos de fallo responden SIGNUP_GENERIC_ERROR (anti-enumeración:
 * no se distingue "token inválido" de "email que no coincide" ni de "la cuenta
 * ya existe").
 */
export async function signUpForInvitationAction(
  token: string,
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
  // la cuenta). El token de invitación tampoco es por sí solo un control de
  // abuso —un atacante con UN token válido podría reusar la pantalla— pero sí
  // acota el alta al email exacto que fue invitado (gate de abajo).
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

  // ─── Gate de invitación (F-AUTH) ────────────────────────────────────────
  // Sin esto la action era un alta de cuentas abierta al público. Leemos la
  // fila con el service client (el invitado todavía NO es member: la RLS de
  // member_invitation solo deja ver la fila a OWNER/DIRECTOR de la org, y la
  // RPC get_invitation_preview es authenticated-only). Las condiciones de
  // vigencia son las mismas que accept_member_invitation (M49): PENDIENTE, no
  // vencida y lower(email) coincidente. El token crudo solo se hashea.
  if (!isWellFormedInvitationToken(token)) {
    return { ok: false, error: SIGNUP_GENERIC_ERROR };
  }
  const service = createSupabaseServiceClient();
  const { data: invitation, error: invErr } = await service
    .from("member_invitation")
    .select("email, estado, expires_at")
    .eq("token_hash", hashInvitationToken(token))
    .maybeSingle();
  if (invErr) {
    return { ok: false, error: SIGNUP_GENERIC_ERROR };
  }
  const gate = checkInvitationForSignup(invitation, email);
  if (!gate.ok) {
    // El motivo NO se filtra al cliente (anti-enumeración): "no existe",
    // "expiró" y "es para otro email" responden idéntico.
    return { ok: false, error: SIGNUP_GENERIC_ERROR };
  }

  // ─── Alta por el camino canónico (GoTrue signUp) ─────────────────────────
  // Respeta el toggle "Confirm email" del dashboard (ON en producción):
  //   - Confirm OFF → signUp devuelve session y el ssr client setea cookies.
  //   - Confirm ON  → user sin session ⇒ needsConfirmation, la UI dice
  //     "Revisá tu email". Nunca auto-confirmamos por atrás.
  const supabase = await createSupabaseServerClient();
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${getAppUrl()}/api/auth/callback` },
  });
  const outcome = classifySignUpOutcome({
    error: signUpErr,
    user: signUpData?.user ?? null,
    session: signUpData?.session ?? null,
  });

  if (outcome.kind === "error") {
    return { ok: false, error: SIGNUP_GENERIC_ERROR };
  }
  if (outcome.kind === "session") {
    // NO bootstrapeamos org: el invitado no es OWNER de nada. Su profile +
    // member se materializan al aceptar (accept_member_invitation, M49).
    return { ok: true };
  }

  // existing_try_password (confirm OFF + email ya registrado) o
  // needs_confirmation (confirm ON). Si puede existir la cuenta, probamos la
  // password recibida: "re-signup con la password correcta = login", el mismo
  // flujo histórico de signUpAndInitOrganization.
  const shouldTryPassword =
    outcome.kind === "existing_try_password" ||
    (outcome.kind === "needs_confirmation" && outcome.maybeExisting);
  if (shouldTryPassword) {
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (!signInErr) return { ok: true };
    if (outcome.kind === "existing_try_password") {
      return { ok: false, error: SIGNUP_GENERIC_ERROR };
    }
    // Confirm ON + user ofuscado por GoTrue + password que no abre sesión:
    // respuesta idéntica a la de un alta fresca (anti-enumeración).
    return { ok: true, needsConfirmation: true };
  }
  return { ok: true, needsConfirmation: true };
}
