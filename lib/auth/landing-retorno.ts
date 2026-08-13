/**
 * Folio · detectar un retorno de OAuth que aterrizó en la landing.
 *
 * ─── Por qué existe ────────────────────────────────────────────────────────
 * GoTrue valida el `redirect_to` que le pide la app contra la allow-list del
 * proyecto. Si la URL no está en la lista **la descarta en silencio** y manda
 * al Site URL — que en un proyecto normal es la raíz del dominio, o sea la
 * landing. El usuario toca "Continuar con Google", elige su cuenta, y vuelve a
 * la página de marketing sin sesión y sin un solo mensaje.
 *
 * Eso fue exactamente lo que pasó en producción cuando el dominio cambió de
 * `folio-app-ten.vercel.app` a `foliosalud.com` y la allow-list quedó con el
 * viejo: el login con Google quedó roto y NADIE se enteró, porque la landing
 * ignora los search params y renderiza el marketing como si nada.
 *
 * Este módulo mira la URL de la landing y decide si lo que hay ahí es un
 * retorno de autenticación mal entregado. Es puro —recibe strings, devuelve un
 * objeto— para poder testear el caso sin un browser.
 *
 * ─── Dos formas, porque GoTrue usa las dos ─────────────────────────────────
 * Los errores del implicit flow vuelven en el **hash** (`#error=...`), que
 * nunca llega al server; los del PKCE y los `?code=` vuelven en la **query**.
 * Hay que mirar las dos o se pierde la mitad de los casos.
 *
 * Testeado en tests/unit/landing-retorno.test.ts.
 */

import { parseAuthCallbackError } from "./auth-error-map";

export type RetornoAuth =
  | {
      /** GoTrue informó un error explícito. `codigo` ya está mapeado al catálogo. */
      kind: "error";
      codigo: string;
    }
  | {
      /**
       * Llegó un `code` de OAuth a la landing. La landing no lo puede canjear
       * —el exchange vive en /api/auth/callback— así que este code se pierde:
       * el login se completó del lado de Google y se cayó en el último salto.
       * Casi siempre significa allow-list desactualizada.
       */
      kind: "code_perdido";
    };

/**
 * `search` y `hash` tal como vienen de `window.location` (con `?` y `#` o sin
 * ellos, da igual). Devuelve `null` cuando la URL no tiene nada que ver con
 * autenticación — que es el caso del 99.9% de las visitas a la landing.
 */
export function detectarRetornoAuth(search: string, hash: string): RetornoAuth | null {
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const h = new URLSearchParams(hash.replace(/^#/, ""));

  // El error manda sobre el code: si GoTrue dijo qué pasó, eso es lo que hay
  // que mostrar, aunque venga un code al lado.
  const codigo = parseAuthCallbackError(q) ?? parseAuthCallbackError(h);
  if (codigo) return { kind: "error", codigo };

  if (q.get("code") || h.get("access_token")) return { kind: "code_perdido" };

  return null;
}

/**
 * La misma URL sin los parámetros de auth, para limpiar la barra de
 * direcciones con `history.replaceState`.
 *
 * Un `code` de OAuth es de un solo uso pero sigue siendo material sensible:
 * no tiene por qué quedar en el historial del navegador, ni viajar en el
 * `Referer` de la próxima navegación, ni terminar en un screenshot. Y un
 * refresh no debería volver a disparar el aviso.
 */
export function urlSinParamsDeAuth(href: string): string {
  const url = new URL(href);
  for (const k of ["code", "error", "error_code", "error_description", "state"]) {
    url.searchParams.delete(k);
  }
  url.hash = "";
  // `?` colgando cuando no queda ningún parámetro.
  return url.toString().replace(/\?$/, "");
}
