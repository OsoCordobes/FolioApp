/**
 * Folio · /api/google/callback
 *
 * OAuth callback de Google Calendar. Recibe `code` + `state` y hace exchange
 * por tokens que guarda cifrados en `integration`.
 *
 * ─── Anti-CSRF (state + cookie) ────────────────────────────────────────────
 * El `state` es un nonce aleatorio cuya copia vive en la cookie httpOnly
 * `folio.gcal_oauth` (la setea connectGoogleCalendar al iniciar el flow, junto
 * con el memberId y el flag de onboarding). Acá se exige igualdad EXACTA entre
 * el `state` del query y el de la cookie ANTES de cualquier exchange, y el
 * memberId sale de la COOKIE — nunca del query.
 *
 * Antes el `state` era el memberId crudo: cualquiera podía autorizar su propia
 * cuenta de Google y mandarle a un colega logueado el link del callback con el
 * memberId del colega; los tokens del atacante quedaban como integración de la
 * víctima y cada turno de la víctima se pusheaba con nombre y email del
 * paciente al calendario del atacante. Detalle completo en
 * lib/google/oauth-state.ts.
 *
 * La cookie se BORRA en todos los caminos (éxito, error de Google, state malo,
 * exchange fallido): es de un solo uso.
 *
 * La verificación de que el member es del usuario logueado se mantiene como
 * defensa en profundidad, no como reemplazo del state.
 *
 * El flag `onb` de la cookie (Step 7 del wizard) hace que el callback vuelva a
 * /onboarding?gcal=ok|error en vez de /configuracion — antes el flujo expulsaba
 * del wizard y el resume rebotaba al Step 6.
 *
 * Después dispara sync inicial: 30 días siguientes de eventos como bloqueos.
 */

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { encryptColumn } from "@/lib/crypto";
import { exchangeCodeForTokens } from "@/lib/google/oauth";
import {
  googleOAuthStateCookieOptions,
  verifyGoogleOAuthState,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "@/lib/google/oauth-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// OAuth callback: exchange de código por tokens contra Google + cifrado +
// sync inicial de 30 días de eventos. Margen sobre el default por la red.
export const maxDuration = 60;

/**
 * Borra la cookie de state en la respuesta. Mismos atributos que el seteo
 * (googleOAuthStateCookieOptions) — con atributos distintos el browser no la
 * borraría y el nonce quedaría reutilizable hasta su maxAge.
 */
function clearStateCookie(res: NextResponse): NextResponse {
  res.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", googleOAuthStateCookieOptions(0));
  return res;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const cookieStore = await cookies();
  const verified = verifyGoogleOAuthState(
    cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value ?? null,
    searchParams.get("state"),
  );
  // Solo dato de navegación (a dónde volver), nunca de autorización.
  const fromOnboarding = verified.fromOnboarding;

  const failRedirect = (errCode: string) =>
    clearStateCookie(
      NextResponse.redirect(
        fromOnboarding
          ? `${origin}/onboarding?gcal=error&reason=${encodeURIComponent(errCode)}`
          : `${origin}/configuracion?error=${encodeURIComponent(errCode)}#integraciones`,
      ),
    );

  if (error) {
    return failRedirect(error);
  }

  // Anti-CSRF ANTES del exchange: sin cookie válida no se toca Google.
  if (!verified.ok) {
    // El reason no viaja crudo al usuario (no da nada accionable y sí un
    // oráculo); queda en logs para soporte. Sin PII: solo el motivo.
    console.warn(`[google oauth callback] state rechazado: ${verified.reason}`);
    return failRedirect(
      verified.reason === "expirado" ? "state_expirado" : "state_invalido",
    );
  }
  const memberId = verified.memberId;

  if (!code) {
    return failRedirect("missing_params");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return clearStateCookie(
      NextResponse.redirect(`${origin}/login?error=oauth_no_session`),
    );
  }

  // Defensa en profundidad: el memberId de la cookie tiene que ser un member
  // del usuario logueado igual. (El state ya garantiza que este browser inició
  // el flow; esto cubre el caso de la sesión cambiada a mitad de camino.)
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

    return clearStateCookie(
      NextResponse.redirect(
        fromOnboarding
          ? `${origin}/onboarding?gcal=ok`
          : `${origin}/configuracion?ok=google_connected#integraciones`,
      ),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[google oauth callback]", msg);
    return failRedirect("oauth_failed");
  }
}
