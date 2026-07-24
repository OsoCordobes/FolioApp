/**
 * Folio · /api/google/callback
 *
 * OAuth callback de Google Calendar. Recibe `code` + `state` y hace exchange
 * por tokens que guarda cifrados en `integration`.
 *
 * `state` = `<memberId>` o `<memberId>:onb`. El sufijo `:onb` lo agrega
 * connectGoogleCalendar("onboarding") (Step 7 del wizard): con él, el
 * callback vuelve a /onboarding?gcal=ok|error en vez de /configuracion —
 * antes el flujo expulsaba del wizard y el resume rebotaba al Step 6.
 *
 * Después dispara sync inicial: 30 días siguientes de eventos como bloqueos.
 */

import { NextResponse, type NextRequest } from "next/server";

import { encryptColumn } from "@/lib/crypto";
import { exchangeCodeForTokens } from "@/lib/google/oauth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// OAuth callback: exchange de código por tokens contra Google + cifrado +
// sync inicial de 30 días de eventos. Margen sobre el default por la red.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawState = searchParams.get("state");
  const error = searchParams.get("error");

  // state = "<memberId>" | "<memberId>:onb" (retorno al wizard de onboarding).
  const [memberId, stateFlag] = (rawState ?? "").split(":");
  const fromOnboarding = stateFlag === "onb";

  const failRedirect = (errCode: string) =>
    NextResponse.redirect(
      fromOnboarding
        ? `${origin}/onboarding?gcal=error&reason=${encodeURIComponent(errCode)}`
        : `${origin}/configuracion?error=${encodeURIComponent(errCode)}#integraciones`,
    );

  if (error) {
    return failRedirect(error);
  }
  if (!code || !memberId) {
    return failRedirect("missing_params");
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
    .eq("id", memberId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!member) {
    return failRedirect("invalid_state");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      return failRedirect("no_tokens");
    }

    const accessCifrado = encryptColumn(tokens.access_token);
    const refreshCifrado = encryptColumn(tokens.refresh_token);
    if (!accessCifrado || !refreshCifrado) {
      return failRedirect("encrypt_failed");
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
          // Reconectar limpia la marca de integración muerta (invalid_grant):
          // sin esto, el nudge de /hoy y el "Reconectar" de /configuracion
          // seguirían encendidos hasta el próximo sync exitoso.
          ultimo_error: null,
          ultimo_error_ts: null,
        },
        { onConflict: "organization_id,profesional_id,proveedor" },
      );

    return NextResponse.redirect(
      fromOnboarding
        ? `${origin}/onboarding?gcal=ok`
        : `${origin}/configuracion?ok=google_connected#integraciones`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[google oauth callback]", msg);
    return failRedirect("oauth_failed");
  }
}
