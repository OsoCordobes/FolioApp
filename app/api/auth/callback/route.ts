/**
 * Folio · OAuth callback handler.
 *
 * Supabase Auth redirige aquí post-OAuth (Google) y post-email-verify. Acá
 * cambiamos el `code` por una sesión y redirigimos:
 *   - Si el usuario ya tiene Profile → /hoy
 *   - Si el usuario es nuevo (no tiene Profile) → /onboarding (continúa desde paso 2)
 */

import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirect") ?? null;

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  // Decidir destino: si el user tiene Profile + Member → app; si no → onboarding step 2
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const { data: profile } = await supabase
    .from("profile")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  return NextResponse.redirect(`${origin}${redirectTo ?? "/hoy"}`);
}
