/**
 * Folio · Google OAuth 2.0 setup.
 *
 * Flow:
 *   1. /configuracion/integraciones · Conectar Google → redirige a Google con
 *      scopes calendar + offline_access (refresh_token).
 *   2. Google → /api/google/callback?code=...&state=memberId
 *   3. Server exchange code → access_token + refresh_token, cifrar y guardar
 *      en tabla `integration`.
 *   4. Crear watch channel para que Google avise cambios (push notifications
 *      a /api/google/webhook).
 *
 * Scopes mínimos:
 *   - https://www.googleapis.com/auth/calendar.events (lectura+escritura)
 *   - https://www.googleapis.com/auth/calendar.readonly (fallback)
 *
 * En F11 considerar: domain-wide delegation para Google Workspace clinicas.
 */

import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

function getOAuthCreds() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI no configurados. Crear OAuth client en Google Cloud Console y setear en .env.local.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function makeOAuth2Client(refreshToken?: string) {
  const { clientId, clientSecret, redirectUri } = getOAuthCreds();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  if (refreshToken) client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/** URL para enviar al user (start de OAuth). */
export function getAuthUrl(state: string): string {
  const client = makeOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",     // garantiza refresh_token
    prompt: "consent",          // siempre re-pide consent (asegura refresh_token)
    scope: SCOPES,
    state,                      // memberId u otro identificador (verificado en callback)
    include_granted_scopes: true,
  });
}

/** Exchange code → tokens al final del flow. */
export async function exchangeCodeForTokens(code: string) {
  const client = makeOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/** Refresh manual (cron F9 cuando expira_ts < now() + 5min). */
export async function refreshAccessToken(refreshToken: string) {
  const client = makeOAuth2Client(refreshToken);
  const { credentials } = await client.refreshAccessToken();
  return credentials;
}
