import assert from "node:assert/strict";
import test from "node:test";

import { rateLimit } from "../../lib/security/rate-limit";

/**
 * Folio · rate-limit fail-open vs fail-closed (W8 opt-in).
 *
 * Asserts the behavior matrix:
 *
 *                              | NODE_ENV  | UPSTASH_FAIL_CLOSED | Outcome
 *   missing-keys, dev          | other     | (any)               | fail-open
 *   missing-keys, prod, default| production| unset / "false"     | fail-open (warn)
 *   missing-keys, prod, opt-in | production| "true"              | fail-CLOSED
 *
 * The "keys present + upstash returns error" branch (network failure /
 * Upstash down) always fail-opens, intentionally — Upstash being down
 * should not take signup down. That branch is covered by the existing
 * integration smoke; this file pins the env-driven dispatch.
 */

function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key]!;
  }
  return fn().finally(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key]!;
    }
  });
}

test("missing upstash keys, dev: fail-open silently", async () => {
  await withEnv(
    {
      NODE_ENV: "development",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      UPSTASH_FAIL_CLOSED: undefined,
    },
    async () => {
      const result = await rateLimit("test-scope", "key1", {
        maxRequests: 10,
        windowSec: 60,
      });
      assert.equal(result.ok, true);
      assert.equal(result.remaining, 10);
    },
  );
});

test("missing upstash keys, prod, default (UPSTASH_FAIL_CLOSED unset): fail-open with warning", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      UPSTASH_FAIL_CLOSED: undefined,
    },
    async () => {
      const result = await rateLimit("test-scope", "key1", {
        maxRequests: 10,
        windowSec: 60,
      });
      assert.equal(result.ok, true);
      assert.equal(result.remaining, 10);
    },
  );
});

test("missing upstash keys, prod, UPSTASH_FAIL_CLOSED='false' explicit: still fail-open", async () => {
  // 'false' is treated as "not opted in" — only the literal "true" enables
  // fail-closed. Defensive: we don't want a typo'd boolean to break prod.
  await withEnv(
    {
      NODE_ENV: "production",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      UPSTASH_FAIL_CLOSED: "false",
    },
    async () => {
      const result = await rateLimit("test-scope", "key1", {
        maxRequests: 10,
        windowSec: 60,
      });
      assert.equal(result.ok, true);
      assert.equal(result.remaining, 10);
    },
  );
});

test("missing upstash keys, prod, UPSTASH_FAIL_CLOSED='true': FAIL-CLOSED", async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      UPSTASH_FAIL_CLOSED: "true",
    },
    async () => {
      const result = await rateLimit("test-scope", "key1", {
        maxRequests: 10,
        windowSec: 60,
      });
      assert.equal(result.ok, false);
      assert.equal(result.remaining, 0);
      // resetIn should advise a wait roughly equal to the window.
      assert.equal(result.resetIn, 60);
    },
  );
});

test("missing upstash keys, dev, UPSTASH_FAIL_CLOSED='true': still fail-open (only prod hardens)", async () => {
  await withEnv(
    {
      NODE_ENV: "development",
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
      UPSTASH_FAIL_CLOSED: "true",
    },
    async () => {
      const result = await rateLimit("test-scope", "key1", {
        maxRequests: 10,
        windowSec: 60,
      });
      assert.equal(result.ok, true);
    },
  );
});
