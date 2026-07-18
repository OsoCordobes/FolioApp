/**
 * Folio · OAuth callback handler.
 *
 * Supabase Auth redirige aquí post-OAuth (Google) y post-email-verify. Acá
 * cambiamos el `code` por una sesión y redirigimos:
 *   - Sin sesión → /login (algo falló en el exchange)
 *   - Con sesión pero sin org bootstrapeada (sin member o member sin org) →
 *     /onboarding (signup mid-flow, viene por Google o profile + member
 *     creados a medias por un retry abortado)
 *   - Con sesión + member + organization.onboarding_completed=false → /onboarding (resume)
 *   - Con sesión + member + organization.onboarding_completed=true → /hoy (o ?redirect)
 *
 * ─── Sprint 2 T2.1 · Consolidación de queries (audit Medio · perf) ──────
 *
 * El handler anterior hacía 4 round-trips seriales (exchangeCodeForSession,
 * getUser, profile, member, organization), sumando ~400-800ms post-OAuth.
 *
 * Tras T2.1: getUser + 1 query con join member→organization. El profile no
 * se chequea por separado porque la FK profile_id en member implica que
 * existe; los casos legacy "profile sin member" caen al mismo destination
 * (/onboarding) que el flow original chequeaba con un query extra inútil.
 */

import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// mapAuthError vivía acá; se extrajo a lib/auth/auth-error-map.ts (ítem 1.5)
// para testearlo con node:test y sumarle los errores de links de email
// (otp_expired / token has expired).
import { mapAuthError, parseAuthCallbackError } from "@/lib/auth/auth-error-map";
import { safeRedirect } from "@/lib/security/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface MemberWithOrg {
  organization_id: string | null;
  organization: { onboarding_completed: boolean | null } | null;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirect") ?? null;

  // Ítem 1.5 (a): GoTrue redirige con ?error=...&error_code=otp_expired (sin
  // code ni token_hash) cuando el link de email venció o ya fue usado. Cortar
  // acá con código amigable — sin esto caía al redirect genérico a /login.
  const callbackErr = parseAuthCallbackError(searchParams);
  if (callbackErr) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(callbackErr)}`);
  }

  const supabase = await createSupabaseServerClient();

  // Ítem 1.5 (b): template SSR de confirmación — ?token_hash=...&type=signup.
  // A diferencia del flujo PKCE (?code=), verifyOtp NO depende de la cookie
  // code_verifier del browser que inició el signup ⇒ funciona cross-device
  // (registrarse en el celular, abrir el mail en la PC). Requiere que F0.6
  // cambie el template "Confirm signup" a {{ .TokenHash }} (ver
  // docs/LAUNCH-RUNBOOK.md §7); mientras tanto el default {{ .ConfirmationURL }}
  // sigue entrando por el branch ?code= de abajo.
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(mapAuthError(error.message))}`,
      );
    }
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Sanitize error: Supabase error.message can leak internals (rate-limit
      // window, internal codes, hints). Mapeamos a códigos amigables y solo
      // pasamos texto crudo si el error es genuinamente desconocido (truncado
      // a 80 chars para no permitir URL injection cosmético).
      const code = mapAuthError(error.message);
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(code)}`);
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // ─── Portal del paciente (Fase 3 · P3 + M88) ────────────────────────────────
  // Un magic-link del portal llega con ?redirect=/portal. Los pacientes NO son
  // `member` (M70): la lógica de staff de abajo los mandaría a /onboarding (un
  // dead-end para un paciente). Si la sesión corresponde a una `paciente_cuenta`
  // viva, ruteamos al portal ANTES del flujo de staff.
  //
  // M88 · provisioning de primera sesión: paciente_cuenta_ensure() devuelve la
  // cuenta viva del usuario logueado, CREÁNDOLA si no existe (email = verdad del
  // server desde auth.users del propio auth.uid() — sin args, no impersona). Sin
  // esto ningún paciente podía entrar jamás (nada creaba filas paciente_cuenta y
  // paciente_cuenta_actual() era siempre NULL → sin_cuenta). La función NO
  // linkea fichas: eso sigue siendo del matcher auditado (LinkagePanel del
  // portal corre el auto-run email-only al montar, con sus guards de P3/P9).
  // NULL sólo queda para: cuenta soft-deleted (baja explícita, no se resucita)
  // o usuario auth sin email usable.
  //
  // Precedencia (humano que es paciente Y staff): sólo desviamos al portal
  // cuando el link PIDIÓ el portal (redirect empieza con /portal). Un usuario
  // que además es staff y entró por el login normal sigue el flujo de staff.
  if (redirectTo && redirectTo.startsWith("/portal")) {
    const { data: cuentaId } = await supabase.rpc("paciente_cuenta_ensure");
    if (cuentaId) {
      const safePortal = safeRedirect(redirectTo, "/portal");
      return NextResponse.redirect(`${origin}${safePortal}`);
    }
    // Pidió portal pero no hay cuenta de portal utilizable (baja explícita o
    // usuario sin email): no lo mandamos a /onboarding de staff. Al login del
    // portal con un aviso neutro.
    return NextResponse.redirect(`${origin}/portal/login?error=sin_cuenta`);
  }

  // Consolidated lookup: member + organization en 1 query con inner join.
  // Reemplaza 3 queries seriales (profile, member, organization) del flow
  // anterior. El select usa la FK `organization` (PostgREST detecta el FK
  // automáticamente por el campo organization_id en member).
  const { data: member } = await supabase
    .from("member")
    .select("organization_id, organization!inner(onboarding_completed)")
    .eq("profile_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<MemberWithOrg>();

  if (!member?.organization_id || !member.organization) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  if (member.organization.onboarding_completed !== true) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  // Open-redirect mitigation (audit 2026-05-26 finding #5): `redirect` is a
  // query param controlled by the request URL. Without `safeRedirect`, an
  // attacker could craft a callback URL like `?redirect=//evil.com` and the
  // post-login bounce would send the authenticated user off-domain. The login
  // form already wraps the same param; this closes the symmetric gap.
  const safe = safeRedirect(redirectTo, "/hoy");
  return NextResponse.redirect(`${origin}${safe}`);
}
