import assert from "node:assert/strict";
import test from "node:test";

import { __resetRateLimitLogState, rateLimit } from "../../lib/security/rate-limit";

/**
 * Folio · rate-limit fail-open vs fail-closed.
 *
 * Asserts the behavior matrix (outside production: always fail-open):
 *
 *                                 | NODE_ENV  | UPSTASH_FAIL_CLOSED | Outcome
 *   missing-keys, dev             | other     | (any)               | fail-open
 *   missing-keys, prod, default   | production| unset / "false"     | fail-open (error log 1×/proceso)
 *   missing-keys, prod, opt-in    | production| "true"              | fail-CLOSED
 *   keys present + error, prod    | production| unset / "true"      | fail-CLOSED
 *   keys present + error, prod    | production| "false"             | fail-open (escape hatch)
 *   keys present + error, dev     | other     | (any)               | fail-open
 *
 * "error" = fetch a Upstash rechaza (red), HTTP !ok, o AbortError del
 * timeout de 2s. El happy path (INCR/EXPIRE/TTL mockeados) también se pinea.
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

// ─── Branch (b): keys PRESENTES pero Upstash falla ──────────────────────────
// Patrón save/restore de globalThis.fetch (cf. payment-provider-mp.test.ts).

const KEYS_PRESENT = {
  UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "fake",
};

/** Respuesta 200 de Upstash con `{ result }`. */
function upstashOkResponse(result: unknown): Response {
  return new Response(JSON.stringify({ result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("keys present, prod, fetch network error, flag unset: FAIL-CLOSED", async (t) => {
  t.mock.method(console, "error", () => {});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    await withEnv(
      { NODE_ENV: "production", ...KEYS_PRESENT, UPSTASH_FAIL_CLOSED: undefined },
      async () => {
        const result = await rateLimit("test-scope", "key1", {
          maxRequests: 10,
          windowSec: 60,
        });
        assert.equal(result.ok, false);
        assert.equal(result.remaining, 0);
        assert.equal(result.resetIn, 60);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keys present, prod, upstash HTTP 500, flag unset: FAIL-CLOSED", async (t) => {
  t.mock.method(console, "error", () => {});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("internal error", { status: 500 })) as typeof fetch;
  try {
    await withEnv(
      { NODE_ENV: "production", ...KEYS_PRESENT, UPSTASH_FAIL_CLOSED: undefined },
      async () => {
        const result = await rateLimit("test-scope", "key1", {
          maxRequests: 10,
          windowSec: 60,
        });
        assert.equal(result.ok, false);
        assert.equal(result.remaining, 0);
        assert.equal(result.resetIn, 60);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keys present, prod, AbortError (timeout de 2s), flag unset: FAIL-CLOSED", async (t) => {
  // Simula el rechazo de AbortSignal.timeout(2000) sin esperar los 2s.
  t.mock.method(console, "error", () => {});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new DOMException("This operation was aborted", "AbortError");
  }) as typeof fetch;
  try {
    await withEnv(
      { NODE_ENV: "production", ...KEYS_PRESENT, UPSTASH_FAIL_CLOSED: undefined },
      async () => {
        const result = await rateLimit("test-scope", "key1", {
          maxRequests: 10,
          windowSec: 60,
        });
        assert.equal(result.ok, false);
        assert.equal(result.remaining, 0);
        assert.equal(result.resetIn, 60);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keys present, prod, fetch error, UPSTASH_FAIL_CLOSED='false': fail-open (escape hatch)", async (t) => {
  t.mock.method(console, "error", () => {});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    await withEnv(
      { NODE_ENV: "production", ...KEYS_PRESENT, UPSTASH_FAIL_CLOSED: "false" },
      async () => {
        const result = await rateLimit("test-scope", "key1", {
          maxRequests: 10,
          windowSec: 60,
        });
        assert.equal(result.ok, true);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keys present, dev, fetch error: fail-open (fuera de prod no cambia)", async (t) => {
  t.mock.method(console, "error", () => {});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    await withEnv(
      { NODE_ENV: "development", ...KEYS_PRESENT, UPSTASH_FAIL_CLOSED: undefined },
      async () => {
        const result = await rateLimit("test-scope", "key1", {
          maxRequests: 10,
          windowSec: 60,
        });
        assert.equal(result.ok, true);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keys present, prod, happy path (INCR=1 → EXPIRE → TTL): limita normal", async () => {
  const originalFetch = globalThis.fetch;
  // Secuencia: INCR devuelve 1 (primera request de la ventana) → EXPIRE → TTL.
  const queue = [upstashOkResponse(1), upstashOkResponse(1), upstashOkResponse(60)];
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const next = queue.shift();
    if (!next) throw new Error("fetch mock queue vacía — llamada de más");
    return next;
  }) as typeof fetch;
  try {
    await withEnv(
      { NODE_ENV: "production", ...KEYS_PRESENT, UPSTASH_FAIL_CLOSED: undefined },
      async () => {
        const result = await rateLimit("test-scope", "key1", {
          maxRequests: 10,
          windowSec: 60,
        });
        assert.equal(result.ok, true);
        assert.equal(result.remaining, 9);
        assert.equal(result.resetIn, 60);
        assert.equal(calls, 3);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keys present, prod, over limit (INCR=11 sobre max 10): ok:false real", async () => {
  const originalFetch = globalThis.fetch;
  // OJO: cuando count !== 1 el código NO llama EXPIRE — solo 2 fetch (INCR, TTL).
  const queue = [upstashOkResponse(11), upstashOkResponse(60)];
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    const next = queue.shift();
    if (!next) throw new Error("fetch mock queue vacía — llamada de más");
    return next;
  }) as typeof fetch;
  try {
    await withEnv(
      { NODE_ENV: "production", ...KEYS_PRESENT, UPSTASH_FAIL_CLOSED: undefined },
      async () => {
        const result = await rateLimit("test-scope", "key1", {
          maxRequests: 10,
          windowSec: 60,
        });
        assert.equal(result.ok, false);
        assert.equal(result.remaining, 0);
        assert.equal(result.resetIn, 60);
        assert.equal(calls, 2);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Log-once del branch missing-keys en prod ────────────────────────────────

test("missing keys, prod: el error de envs ausentes se loguea UNA vez por proceso", async (t) => {
  __resetRateLimitLogState();
  const errorMock = t.mock.method(console, "error", () => {});
  try {
    await withEnv(
      {
        NODE_ENV: "production",
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
        UPSTASH_FAIL_CLOSED: undefined,
      },
      async () => {
        await rateLimit("test-scope", "key1", { maxRequests: 10, windowSec: 60 });
        await rateLimit("test-scope", "key2", { maxRequests: 10, windowSec: 60 });
      },
    );
    const missingEnvLogs = errorMock.mock.calls.filter((call) =>
      String(call.arguments[0]).includes("UPSTASH_REDIS_REST_URL/TOKEN ausentes"),
    );
    assert.equal(missingEnvLogs.length, 1);
  } finally {
    __resetRateLimitLogState();
  }
});
