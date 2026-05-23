/**
 * Folio · OAuth callback handler.
 *
 * Supabase Auth redirige aquí post-OAuth (Google) y post-email-verify. Acá
 * cambiamos el `code` por una sesión y redirigimos:
 *   - Sin sesión → /login (algo falló en el exchange)
 *   - Con sesión, sin profile → /onboarding (signup mid-flow, viene por Google)
 *   - Con sesión + profile + onboarding_completed=false → /onboarding (resume)
 *   - Con sesión + profile + onboarding_completed=true → /hoy (o el redirect param)
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

  // Verificar estado del onboarding antes de mandar a la app. Un usuario que
  // tiene profile + member pero no terminó el wizard debe volver a onboarding,
  // no aterrizar en /hoy con datos incompletos.
  const { data: profile } = await supabase
    .from("profile")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  const { data: member } = await supabase
    .from("member")
    .select("organization_id")
    .eq("profile_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!member?.organization_id) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  const { data: org } = await supabase
    .from("organization")
    .select("onboarding_completed")
    .eq("id", member.organization_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!org || org.onboarding_completed === false) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  return NextResponse.redirect(`${origin}${redirectTo ?? "/hoy"}`);
}
