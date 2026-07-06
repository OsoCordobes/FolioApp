/**
 * Folio · tests de isUpstashConfigured (lib/security/rate-limit.ts) — PR S4.
 *
 * Es la fuente de verdad única de "¿Upstash está provisionado?" que consume
 * tanto upstashCommand (tira `upstash_not_configured` si falta alguna key) como
 * el health check /api/health (que assert-ea esto en producción y reporta a
 * Sentry si falta). Se pinea que exige AMBAS keys y que sólo devuelve booleano.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { isUpstashConfigured } from "../../lib/security/rate-limit";

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key]!;
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key]!;
    }
  }
}

test("ambas keys presentes ⇒ true", () => {
  withEnv(
    {
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    },
    () => {
      assert.equal(isUpstashConfigured(), true);
    },
  );
});

test("falta el token ⇒ false", () => {
  withEnv(
    {
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    () => {
      assert.equal(isUpstashConfigured(), false);
    },
  );
});

test("falta la URL ⇒ false", () => {
  withEnv(
    {
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: "tok",
    },
    () => {
      assert.equal(isUpstashConfigured(), false);
    },
  );
});

test("faltan ambas ⇒ false", () => {
  withEnv(
    {
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    },
    () => {
      assert.equal(isUpstashConfigured(), false);
    },
  );
});

test("string vacío en una key ⇒ false (no cuenta como configurada)", () => {
  withEnv(
    {
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    },
    () => {
      assert.equal(isUpstashConfigured(), false);
    },
  );
});

test("siempre devuelve boolean estricto", () => {
  withEnv(
    {
      UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    },
    () => {
      assert.equal(typeof isUpstashConfigured(), "boolean");
    },
  );
});
