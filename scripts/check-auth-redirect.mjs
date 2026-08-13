#!/usr/bin/env node
/**
 * Folio · ¿Supabase acepta las URLs de retorno que la app le pide?
 *
 * ─── Qué problema detecta ──────────────────────────────────────────────────
 * GoTrue valida el `redirect_to` contra la allow-list del proyecto (Auth → URL
 * Configuration). Si la URL no está, **la descarta sin avisar** y redirige al
 * Site URL. Como el Site URL suele ser la raíz del dominio, el síntoma es
 * "toqué Continuar con Google, elegí mi cuenta, y volví a la página de inicio"
 * — sin error, sin log, sin nada.
 *
 * Eso pasó en producción cuando el dominio cambió de `folio-app-ten.vercel.app`
 * a `foliosalud.com`: la allow-list quedó con el viejo y el login con Google
 * estuvo roto días sin que ningún tablero se pusiera en rojo, porque no había
 * nada midiéndolo. Este script es lo que faltaba.
 *
 * ─── Cómo lo detecta ───────────────────────────────────────────────────────
 * Le pide a GoTrue un `verify` con un token deliberadamente inválido y el
 * `redirect_to` que la app usa de verdad. GoTrue resuelve el redirect ANTES de
 * validar el token, así que el header `Location` de la respuesta dice si la
 * URL fue aceptada (vuelve a ella) o descartada (cae al Site URL). El token
 * inválido garantiza que esto no crea ni consume ninguna sesión.
 *
 * No usa secretos: la anon key ya viaja en el bundle del browser.
 *
 * Uso:
 *   node --env-file=.env.local scripts/check-auth-redirect.mjs
 *   APP_URL=https://foliosalud.com node scripts/check-auth-redirect.mjs
 *
 * Sale con código 1 si alguna URL de retorno no está permitida.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const APP_URL = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

if (!SUPABASE_URL || !ANON) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  console.error("Probá: node --env-file=.env.local scripts/check-auth-redirect.mjs");
  process.exit(2);
}
if (!APP_URL) {
  console.error("Falta APP_URL (o NEXT_PUBLIC_APP_URL): no sé qué dominio verificar.");
  process.exit(2);
}

/** Las URLs de retorno que la app le pide a Supabase, y quién las usa. */
const RETORNOS = [
  { url: `${APP_URL}/api/auth/callback`, quien: "login de staff (Google) y confirmación de email" },
  { url: `${APP_URL}/api/auth/callback?redirect=/portal`, quien: "magic-link del portal del paciente" },
  { url: `${APP_URL}/reset-password`, quien: "recuperación de contraseña" },
];

/** Devuelve el `Location` que GoTrue elige para ese `redirect_to`. */
async function destinoReal(redirectTo) {
  const u = new URL(`${SUPABASE_URL}/auth/v1/verify`);
  u.searchParams.set("token", "token-invalido-a-proposito");
  u.searchParams.set("type", "signup");
  u.searchParams.set("redirect_to", redirectTo);
  const r = await fetch(u, { method: "GET", redirect: "manual", headers: { apikey: ANON } });
  const loc = r.headers.get("location");
  if (!loc) throw new Error(`GoTrue no devolvió Location (status ${r.status})`);
  // El error viaja en el hash y no importa para esta verificación.
  return loc.split("#")[0].replace(/\?$/, "");
}

const esperado = (u) => u.replace(/\?$/, "");

let fallas = 0;
console.log(`Verificando las URLs de retorno de ${APP_URL} contra ${SUPABASE_URL}\n`);

for (const { url, quien } of RETORNOS) {
  let real;
  try {
    real = await destinoReal(url);
  } catch (e) {
    console.error(`  ERROR  ${url}\n         ${e.message}`);
    fallas++;
    continue;
  }
  if (real === esperado(url)) {
    console.log(`  ok     ${url}`);
  } else {
    fallas++;
    console.error(`  RECHAZADA  ${url}`);
    console.error(`             GoTrue redirige a: ${real}`);
    console.error(`             Rompe: ${quien}`);
  }
}

if (fallas > 0) {
  console.error(
    `\n${fallas} URL(s) de retorno NO están en la allow-list de Supabase.\n` +
      `Agregalas en Auth → URL Configuration → Redirect URLs, y verificá que\n` +
      `el Site URL sea ${APP_URL}. Mientras tanto, quien intente entrar va a\n` +
      `volver a la landing sin sesión y sin mensaje.`,
  );
  process.exit(1);
}

console.log("\nTodas las URLs de retorno están permitidas.");
