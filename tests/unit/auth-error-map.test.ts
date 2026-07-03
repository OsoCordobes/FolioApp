/**
 * Tests de lib/auth/auth-error-map.ts — mapeo de errores del callback de
 * auth a códigos amigables (ítem 1.5). mapAuthError se extrajo del route
 * handler /api/auth/callback; parseAuthCallbackError cubre los params de
 * error con los que GoTrue redirige cuando el link de email venció.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { mapAuthError, parseAuthCallbackError } from "../../lib/auth/auth-error-map";

// ─── mapAuthError ────────────────────────────────────────────────────────────

test("mapAuthError: 'Token has expired or is invalid' ⇒ code_expired", () => {
  assert.equal(mapAuthError("Token has expired or is invalid"), "code_expired");
});

test("mapAuthError: 'otp_expired' ⇒ code_expired", () => {
  assert.equal(mapAuthError("otp_expired"), "code_expired");
});

test("mapAuthError: 'Email link is invalid or has expired' ⇒ code_expired", () => {
  assert.equal(mapAuthError("Email link is invalid or has expired"), "code_expired");
});

test("mapAuthError: rate limit ⇒ rate_limited", () => {
  assert.equal(mapAuthError("Rate limit exceeded"), "rate_limited");
  assert.equal(mapAuthError("Too many requests"), "rate_limited");
});

test("mapAuthError: invalid_grant ⇒ code_expired (comportamiento previo intacto)", () => {
  assert.equal(mapAuthError("invalid_grant: something"), "code_expired");
});

test("mapAuthError: 'invalid code' ⇒ code_invalid (comportamiento previo intacto)", () => {
  assert.equal(mapAuthError("Invalid authorization code"), "code_invalid");
});

test("mapAuthError: network/timeout ⇒ network (comportamiento previo intacto)", () => {
  assert.equal(mapAuthError("network failure"), "network");
  assert.equal(mapAuthError("request timeout"), "network");
});

test("mapAuthError: mensaje desconocido ⇒ oauth_failed", () => {
  assert.equal(mapAuthError("something completely unexpected"), "oauth_failed");
});

// ─── parseAuthCallbackError ──────────────────────────────────────────────────

test("parseAuthCallbackError: error_code=otp_expired ⇒ code_expired", () => {
  const params = new URLSearchParams(
    "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  );
  assert.equal(parseAuthCallbackError(params), "code_expired");
});

test("parseAuthCallbackError: solo error_description con 'expired' ⇒ code_expired", () => {
  const params = new URLSearchParams("error_description=Email+link+is+invalid+or+has+expired");
  assert.equal(parseAuthCallbackError(params), "code_expired");
});

test("parseAuthCallbackError: error desconocido ⇒ oauth_failed (catálogo cerrado)", () => {
  const params = new URLSearchParams("error=server_error&error_code=unexpected_failure");
  assert.equal(parseAuthCallbackError(params), "oauth_failed");
});

test("parseAuthCallbackError: sin params de error ⇒ null", () => {
  assert.equal(parseAuthCallbackError(new URLSearchParams("")), null);
  assert.equal(parseAuthCallbackError(new URLSearchParams("code=abc123")), null);
  assert.equal(
    parseAuthCallbackError(new URLSearchParams("token_hash=xyz&type=signup")),
    null,
  );
});
