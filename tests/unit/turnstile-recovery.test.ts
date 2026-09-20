import assert from "node:assert/strict";
import test from "node:test";

import { turnstileDiagnostic, turnstileFailureMessage } from "../../components/auth/turnstile-challenge";
import { testAppConfig } from "../../scripts/testing/app-config.mjs";
import { safeEnvironment } from "../../scripts/testing/isolation-policy.mjs";

test("Turnstile diagnostics reveal only a numeric provider code", () => {
  assert.equal(turnstileDiagnostic("200500"), "200500");
  assert.equal(turnstileDiagnostic("110200"), "110200");
  assert.equal(turnstileDiagnostic("token=private-value"), undefined);
  assert.equal(turnstileDiagnostic({ email: "private@example.test" }), undefined);
  assert.match(turnstileFailureMessage({ stage: "challenge", code: "200500" }), /conexión.*200500/i);
  assert.match(turnstileFailureMessage({ stage: "challenge", code: "110200" }), /autorizado.*110200/i);
  assert.match(turnstileFailureMessage({ stage: "script" }), /cargar/i);
  assert.match(turnstileFailureMessage({ stage: "expired" }), /venció/i);
});

test("browser test runner accepts only official public keys and strips inherited credentials", () => {
  assert.throws(() => testAppConfig({ FOLIO_TEST_TURNSTILE_SITEKEY: "production-looking-key" }), /official Turnstile/);
  assert.equal(testAppConfig({}).turnstileSitekey, undefined);
  const config = testAppConfig({ E2E_BASE_URL: "http://127.0.0.1:4430", FOLIO_TEST_TURNSTILE_SITEKEY: "2x00000000000000000000AB" });
  const env = safeEnvironment({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "production-looking-key", TURNSTILE_SECRET_KEY: "private-value" }, config);
  assert.equal(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, "2x00000000000000000000AB");
  assert.equal(env.TURNSTILE_SECRET_KEY, undefined);
  const invalidConfig = { ...config, turnstileSitekey: "production-looking-key" };
  assert.throws(() => safeEnvironment({}, invalidConfig), /official Turnstile/);
});
