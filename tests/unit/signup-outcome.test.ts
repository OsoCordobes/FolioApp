/**
 * Tests de lib/auth/signup-outcome.ts — clasificación pura de la respuesta
 * de supabase.auth.signUp (ítem 1.5 · verificación de email adaptativa).
 *
 * Matriz según el toggle "Confirm email" del dashboard de Supabase:
 *   - OFF (prod hoy): session presente | error "already registered".
 *   - ON (F0.6): user sin session; identities:[] = email ya existente
 *     confirmado (user ofuscado por GoTrue, anti-enumeración).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { classifySignUpOutcome } from "../../lib/auth/signup-outcome";

test("session presente ⇒ kind session (confirm OFF, signup fresco)", () => {
  const outcome = classifySignUpOutcome({
    error: null,
    user: { identities: [{ provider: "email" }] },
    session: { access_token: "jwt" },
  });
  assert.deepEqual(outcome, { kind: "session" });
});

test("error 'User already registered' ⇒ existing_try_password", () => {
  const outcome = classifySignUpOutcome({
    error: { message: "User already registered" },
    user: null,
    session: null,
  });
  assert.deepEqual(outcome, { kind: "existing_try_password" });
});

test("error con 'already' en otra frase ⇒ existing_try_password", () => {
  const outcome = classifySignUpOutcome({
    error: { message: "A user with this email address has already been registered" },
    user: null,
    session: null,
  });
  assert.deepEqual(outcome, { kind: "existing_try_password" });
});

test("error distinto ⇒ kind error con el message original", () => {
  const outcome = classifySignUpOutcome({
    error: { message: "Password should be at least 6 characters" },
    user: null,
    session: null,
  });
  assert.deepEqual(outcome, {
    kind: "error",
    message: "Password should be at least 6 characters",
  });
});

test("error gana aunque venga user+session (defensivo)", () => {
  const outcome = classifySignUpOutcome({
    error: { message: "Signup disabled" },
    user: { identities: [{}] },
    session: {},
  });
  assert.equal(outcome.kind, "error");
});

test("user sin session con identities pobladas ⇒ needs_confirmation, maybeExisting=false", () => {
  const outcome = classifySignUpOutcome({
    error: null,
    user: { identities: [{ provider: "email" }] },
    session: null,
  });
  assert.deepEqual(outcome, { kind: "needs_confirmation", maybeExisting: false });
});

test("user sin session con identities:[] ⇒ needs_confirmation, maybeExisting=true (user ofuscado)", () => {
  const outcome = classifySignUpOutcome({
    error: null,
    user: { identities: [] },
    session: null,
  });
  assert.deepEqual(outcome, { kind: "needs_confirmation", maybeExisting: true });
});

test("user sin session con identities undefined ⇒ maybeExisting=false", () => {
  const outcome = classifySignUpOutcome({
    error: null,
    user: {},
    session: null,
  });
  assert.deepEqual(outcome, { kind: "needs_confirmation", maybeExisting: false });
});

test("user sin session con identities null ⇒ maybeExisting=false", () => {
  const outcome = classifySignUpOutcome({
    error: null,
    user: { identities: null },
    session: null,
  });
  assert.deepEqual(outcome, { kind: "needs_confirmation", maybeExisting: false });
});

test("todo null (sin error, sin user, sin session) ⇒ error genérico", () => {
  const outcome = classifySignUpOutcome({ error: null, user: null, session: null });
  assert.equal(outcome.kind, "error");
  if (outcome.kind === "error") {
    // Mensaje genérico user-facing, no leak técnico.
    assert.match(outcome.message, /registro/i);
  }
});
