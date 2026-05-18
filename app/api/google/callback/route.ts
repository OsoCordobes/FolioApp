/**
 * Folio · /api/google/callback
 *
 * OAuth callback de Google Calendar. Recibe `code` + `state` (memberId),
 * exchange por tokens y los guarda cifrados en `integration`.
 *
 * Después dispara sync inicial: 30 días siguientes de eventos como bloqueos.
 */

import { NextResponse, type NextRequest } from "next/server";

import { encryptColumn } from "@/lib/crypto";
import { exchangeCodeForTokens } from "@/lib/google/oauth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");                      // memberId
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${origin}/configuracion?error=${encodeURIComponent(error)}#integraciones`,
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(`${origin}/configuracion?error=missing_params#integraciones`);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=oauth_no_session`);
  }

  // Verificar que el state corresponde a un member del user actual
  const { data: member } = await supabase
    .from("member")
    .select("id, organization_id")
    .eq("id", state)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.redirect(`${origin}/configuracion?error=invalid_state#integraciones`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.redirect(`${origin}/configuracion?error=no_tokens#integraciones`);
    }

    const accessCifrado = encryptColumn(tokens.access_token);
    const refreshCifrado = encryptColumn(tokens.refresh_token);
    if (!accessCifrado || !refreshCifrado) {
      return NextResponse.redirect(`${origin}/configuracion?error=encrypt_failed#integraciones`);
    }

    await supabase
      .from("integration")
      .upsert(
        {
          organization_id: member.organization_id,
          profesional_id: member.id,
          proveedor: "GOOGLE_CALENDAR",
          access_token_cifrado: accessCifrado,
          refresh_token_cifrado: refreshCifrado,
          expira_ts: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          scopes: ["https://www.googleapis.com/auth/calendar.events"],
          meta_json: { calendar_id: "primary" },
        },
        { onConflict: "organization_id,profesional_id,proveedor" },
      );

    return NextResponse.redirect(
      `${origin}/configuracion?ok=google_connected#integraciones`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[google oauth callback]", msg);
    return NextResponse.redirect(
      `${origin}/configuracion?error=${encodeURIComponent("oauth_failed")}#integraciones`,
    );
  }
}
