/**
 * Folio · mensajes de los errores de ingreso, en castellano.
 *
 * Estaba embebido en components/auth/login-form.tsx, que es un client
 * component. El aviso de retorno de la landing necesita el mismo catálogo —
 * si cada pantalla escribe su propia versión del mismo error, terminan
 * diciendo cosas distintas del mismo problema.
 *
 * Los códigos los produce lib/auth/auth-error-map.ts (mapAuthError /
 * parseAuthCallbackError). Un código fuera del catálogo cae al genérico: el
 * código crudo NUNCA se le muestra al usuario.
 */

export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "No pude completar el ingreso con Google. Reintentá.",
  rate_limited: "Demasiados intentos seguidos. Esperá un minuto y reintentá.",
  // Neutral: este código ahora también lo emiten los links de confirmación
  // de email (otp_expired / verifyOtp), no solo el exchange de Google.
  code_expired: "El link expiró o ya fue usado. Pedí uno nuevo.",
  code_invalid: "El código de Google no es válido. Reintentá el ingreso.",
  network: "Hubo un problema de red al validar tu ingreso. Reintentá.",
  // El canje del link funcionó pero la sesión no quedó guardada (cookies
  // bloqueadas, ventana de incógnito que se cerró, o el link abierto en un
  // navegador distinto del que lo pidió). Decirlo así evita el "probé y no
  // pasa nada" y le da al usuario algo concreto que cambiar.
  session_missing:
    "El link se validó pero no pudimos guardar tu sesión. Abrilo en el mismo navegador donde pediste el acceso, con las cookies habilitadas.",
};

export const MENSAJE_OAUTH_GENERICO = "Algo salió mal con el ingreso. Reintentá.";

/** Mensaje para el código, o el genérico. Nunca devuelve el código crudo. */
export function mensajeOauth(codigo: string | null | undefined): string {
  if (!codigo) return MENSAJE_OAUTH_GENERICO;
  return OAUTH_ERROR_MESSAGES[codigo] ?? MENSAJE_OAUTH_GENERICO;
}
