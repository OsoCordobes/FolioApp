/**
 * Folio · mensajes de error del OAuth de Google Calendar (E1).
 *
 * El callback (app/api/google/callback/route.ts) redirige a
 * `/configuracion?error=<code>#integraciones` cuando la conexión falla —
 * `access_denied` de Google, `invalid_state` del anti-CSRF, `encrypt_failed`
 * si no se pudo cifrar el refresh token. Pero `/configuracion` nunca leía ese
 * `searchParam`: el profesional volvía a la pantalla de Integraciones, veía
 * "Conectar Google Calendar" exactamente igual que antes, y no tenía forma de
 * saber que el intento había fallado ni por qué. Probaba de nuevo, y de nuevo.
 *
 * Los códigos son cerrados (los cinco que emite el callback + los que define
 * Google), así que se mapean a mensajes en español que dicen qué hacer. Un
 * código desconocido cae en un genérico honesto: nunca se muestra el código
 * crudo, que no le dice nada a nadie.
 *
 * Puro y sin dependencias, para poder testearlo.
 * Testeado en tests/unit/google-oauth-error.test.ts.
 */

const MENSAJES: Record<string, string> = {
  // Devueltos por Google.
  access_denied:
    "Cancelaste el permiso en la pantalla de Google, así que tu agenda no se conectó. Probá de nuevo cuando quieras.",
  admin_policy_enforced:
    "El administrador de tu cuenta de Google bloquea esta conexión. Pedile que habilite Folio, o usá una cuenta personal.",
  // Emitidos por el callback de Folio.
  missing_params: "Google no devolvió los datos de la conexión. Probá de nuevo.",
  invalid_state:
    "El link de conexión venció o se abrió en otra ventana. Empezá de nuevo desde este botón.",
  no_tokens: "Google no nos dio el permiso permanente. Probá de nuevo y aceptá el acceso a tu calendario.",
  encrypt_failed: "No pudimos guardar la conexión de forma segura. Escribinos si vuelve a pasar.",
  oauth_failed: "No pudimos completar la conexión con Google. Probá de nuevo en un momento.",
};

/**
 * Mensaje en español para el código de error, o `null` si no hay código.
 * Nunca devuelve el código crudo.
 */
export function mensajeErrorOauthGoogle(code: string | null | undefined): string | null {
  if (!code) return null;
  return (
    MENSAJES[code] ??
    "No pudimos conectar tu Google Calendar. Probá de nuevo; si sigue fallando, escribinos."
  );
}
