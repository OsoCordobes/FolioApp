/**
 * Folio · mapeo de errores del callback de auth a códigos amigables.
 *
 * Extraído de app/api/auth/callback/route.ts (ítem 1.5) para poder
 * testearlo con node:test y reusarlo entre el exchange PKCE (?code=),
 * el verifyOtp del template SSR (?token_hash=) y los errores que GoTrue
 * manda por query params (?error_code=otp_expired).
 *
 * El loginPage muestra el código traducido (OAUTH_ERROR_MESSAGES en
 * components/auth/login-form.tsx); cualquier cosa fuera del catálogo cae a
 * "oauth_failed" para no leak internals (rate-limit windows, internal IDs,
 * hints) al URL público.
 */

export function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("too many")) return "rate_limited";
  // Links de confirmación de email vencidos/ya usados: GoTrue responde
  // "otp_expired" (query param) o "Email link is invalid or has expired" /
  // "Token has expired or is invalid" (verifyOtp).
  if (lower.includes("otp") || lower.includes("token has expired")) return "code_expired";
  if (lower.includes("expired") || lower.includes("invalid_grant")) return "code_expired";
  if (lower.includes("network") || lower.includes("timeout")) return "network";
  if (lower.includes("invalid") && lower.includes("code")) return "code_invalid";
  return "oauth_failed";
}

/**
 * GoTrue redirige al callback con `?error=access_denied&error_code=otp_expired
 * &error_description=...` cuando el link de email venció o ya fue usado —
 * sin `code` ni `token_hash`. Devuelve el código amigable o null si la URL
 * no trae params de error.
 */
export function parseAuthCallbackError(searchParams: URLSearchParams): string | null {
  const error = searchParams.get("error");
  const errorCode = searchParams.get("error_code");
  const errorDescription = searchParams.get("error_description");
  if (!error && !errorCode && !errorDescription) return null;
  // error_code es el más específico ("otp_expired"); description y error
  // aportan texto extra por si el code no matchea nada del catálogo.
  const combined = [errorCode, errorDescription, error].filter(Boolean).join(" ");
  return mapAuthError(combined);
}
