/**
 * A-4 (audit 2026-07-13) · Guardrail live_mode del webhook de MP.
 *
 * Riesgo cubierto: un webhook de sandbox (live_mode:false) llegando a
 * producción — o un token de test configurado en prod — "funciona" en silencio
 * y puede activar suscripciones sin cobro real.
 *
 * La decisión vive en `checkMpLiveMode` (lib/mercadopago/webhook-security.ts),
 * función PURA que el route llama tras validar la firma. El mapeo a HTTP en
 * app/api/mercadopago/webhook/route.ts es:
 *
 *   - discard:true  → console.error + Sentry y **200** SIN procesar el evento
 *                     (200 a propósito: MP no debe reintentar un evento que
 *                     jamás vamos a querer procesar).
 *   - discard:false → el evento sigue el flujo normal (processEvent).
 *
 * Igual que los otros tests de webhook (mp-webhook-signature,
 * google-webhook-idempotencia): node:test bajo tsx no permite mock.module y el
 * route arrastra deps de módulo (Sentry, payments, DB), así que testeamos la
 * función de decisión extraída, no el handler HTTP.
 *
 * Matriz:
 *   - prod + live_mode:false      → discard (el route responde 200 y NO procesa)
 *   - prod + live_mode:true       → procesa
 *   - prod + live_mode:undefined  → procesa (no todos los eventos de MP lo traen)
 *   - dev  + live_mode:false      → procesa (sandbox es lo esperado en dev)
 *   - Vercel preview + false      → procesa (NODE_ENV=production en preview,
 *                                   pero VERCEL_ENV=preview manda)
 *   - self-host prod (sin VERCEL_ENV) + false → discard
 */

import assert from "node:assert/strict";
import test from "node:test";

import { checkMpLiveMode } from "../../lib/mercadopago/webhook-security";

// Helper: corre `fn` con env seteado y restaura al final.
function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("checkMpLiveMode: evento sandbox (live_mode=false) en producción Vercel → discard (route: 200 sin procesar)", () => {
  withEnv({ VERCEL_ENV: "production", NODE_ENV: "production" }, () => {
    const res = checkMpLiveMode(false);
    assert.equal(res.discard, true);
    if (res.discard) assert.equal(res.reason, "sandbox-event-in-production");
  });
});

test("checkMpLiveMode: live_mode=true en producción → NO descarta (evento real, se procesa)", () => {
  withEnv({ VERCEL_ENV: "production", NODE_ENV: "production" }, () => {
    assert.equal(checkMpLiveMode(true).discard, false);
  });
});

test("checkMpLiveMode: live_mode ausente (undefined) en producción → NO descarta (MP no lo manda en todos los eventos)", () => {
  withEnv({ VERCEL_ENV: "production", NODE_ENV: "production" }, () => {
    assert.equal(checkMpLiveMode(undefined).discard, false);
  });
});

test("checkMpLiveMode: dev local + live_mode=false → NO descarta (sandbox es lo esperado)", () => {
  withEnv({ VERCEL_ENV: undefined, NODE_ENV: "development" }, () => {
    assert.equal(checkMpLiveMode(false).discard, false);
  });
});

test("checkMpLiveMode: Vercel preview + live_mode=false → NO descarta (NODE_ENV=production en preview, VERCEL_ENV manda)", () => {
  // En un deploy preview de Vercel NODE_ENV también es "production" — el
  // guardrail NO debe matar las pruebas con sandbox ahí. Este caso es la razón
  // por la que checkMpLiveMode no reutiliza isProductionEnv() (fail-closed del
  // secret, que a propósito trata preview como prod).
  withEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" }, () => {
    assert.equal(checkMpLiveMode(false).discard, false);
  });
});

test("checkMpLiveMode: self-host prod (NODE_ENV=production sin VERCEL_ENV) + live_mode=false → discard", () => {
  withEnv({ VERCEL_ENV: undefined, NODE_ENV: "production" }, () => {
    const res = checkMpLiveMode(false);
    assert.equal(res.discard, true);
  });
});

test("checkMpLiveMode: dev + live_mode=true/undefined → NO descarta (sanity)", () => {
  withEnv({ VERCEL_ENV: undefined, NODE_ENV: "development" }, () => {
    assert.equal(checkMpLiveMode(true).discard, false);
    assert.equal(checkMpLiveMode(undefined).discard, false);
  });
});
