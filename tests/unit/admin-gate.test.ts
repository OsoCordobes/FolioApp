import assert from "node:assert/strict";
import test from "node:test";

import { checkAdminGate } from "../../lib/security/admin-gate";

// Helper: corre `fn` con `VERCEL_ENV` y env extra seteados, restaura al final.
function withEnv(
  env: Record<string, string | undefined>,
  fn: () => void,
) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test("checkAdminGate: no-gate always returns null", () => {
  withEnv({ VERCEL_ENV: "production" }, () => {
    assert.equal(checkAdminGate({ mode: "no-gate" }), null);
  });
  withEnv({ VERCEL_ENV: "development" }, () => {
    assert.equal(checkAdminGate({ mode: "no-gate" }), null);
  });
});

test("checkAdminGate: prod-disabled returns 404 in production", async () => {
  await new Promise<void>((resolve) => {
    withEnv({ VERCEL_ENV: "production" }, () => {
      const result = checkAdminGate({ mode: "prod-disabled" });
      assert.notEqual(result, null);
      assert.equal(result?.status, 404);
      resolve();
    });
  });
});

test("checkAdminGate: prod-disabled returns null in preview", () => {
  withEnv({ VERCEL_ENV: "preview" }, () => {
    assert.equal(checkAdminGate({ mode: "prod-disabled" }), null);
  });
});

test("checkAdminGate: prod-disabled returns null in development", () => {
  withEnv({ VERCEL_ENV: "development" }, () => {
    assert.equal(checkAdminGate({ mode: "prod-disabled" }), null);
  });
});

test("checkAdminGate: prod-escape-hatch without escape returns 403 in production", () => {
  withEnv(
    {
      VERCEL_ENV: "production",
      ALLOW_TEST_RESET: undefined,
    },
    () => {
      const result = checkAdminGate({
        mode: "prod-escape-hatch",
        escapeHatch: { envVar: "ALLOW_TEST_RESET", expected: "yes" },
      });
      assert.notEqual(result, null);
      assert.equal(result?.status, 403);
    },
  );
});

test("checkAdminGate: prod-escape-hatch with wrong value returns 403", () => {
  withEnv(
    {
      VERCEL_ENV: "production",
      ALLOW_TEST_RESET: "no",
    },
    () => {
      const result = checkAdminGate({
        mode: "prod-escape-hatch",
        escapeHatch: { envVar: "ALLOW_TEST_RESET", expected: "yes" },
      });
      assert.equal(result?.status, 403);
    },
  );
});

test("checkAdminGate: prod-escape-hatch with correct escape returns null", () => {
  withEnv(
    {
      VERCEL_ENV: "production",
      ALLOW_TEST_RESET: "yes",
    },
    () => {
      const result = checkAdminGate({
        mode: "prod-escape-hatch",
        escapeHatch: { envVar: "ALLOW_TEST_RESET", expected: "yes" },
      });
      assert.equal(result, null);
    },
  );
});

test("checkAdminGate: prod-escape-hatch in non-production returns null regardless", () => {
  withEnv({ VERCEL_ENV: "preview", ALLOW_TEST_RESET: undefined }, () => {
    const result = checkAdminGate({
      mode: "prod-escape-hatch",
      escapeHatch: { envVar: "ALLOW_TEST_RESET", expected: "yes" },
    });
    assert.equal(result, null);
  });
  withEnv({ VERCEL_ENV: "development", ALLOW_TEST_RESET: undefined }, () => {
    const result = checkAdminGate({
      mode: "prod-escape-hatch",
      escapeHatch: { envVar: "ALLOW_TEST_RESET", expected: "yes" },
    });
    assert.equal(result, null);
  });
});

test("checkAdminGate: prod-escape-hatch misconfigured (missing escapeHatch) returns 500 fail-closed", () => {
  withEnv({ VERCEL_ENV: "production" }, () => {
    const result = checkAdminGate({ mode: "prod-escape-hatch" });
    assert.notEqual(result, null);
    assert.equal(result?.status, 500);
  });
});
