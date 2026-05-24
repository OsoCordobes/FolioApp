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

import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Mapea errores de Supabase OAuth exchange a códigos amigables.
 * El loginPage muestra el código tal cual; cualquier cosa fuera del catálogo
 * cae a "oauth_failed" para no leak internals (rate-limit windows, internal
 * IDs, hints) al URL público.
 */
function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("too many")) return "rate_limited";
  if (lower.includes("expired") || lower.includes("invalid_grant")) return "code_expired";
  if (lower.includes("network") || lower.includes("timeout")) return "network";
  if (lower.includes("invalid") && lower.includes("code")) return "code_invalid";
  return "oauth_failed";
}

interface MemberWithOrg {
  organization_id: string | null;
  organization: { onboarding_completed: boolean | null } | null;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirect") ?? null;

  if (code) {
    const supabase = await createSupabaseServerClient();
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

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
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

  return NextResponse.redirect(`${origin}${redirectTo ?? "/hoy"}`);
}
