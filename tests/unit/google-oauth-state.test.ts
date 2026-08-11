/**
 * Folio · tests del state anti-CSRF del OAuth de Google Calendar (S5).
 *
 * Cargamos .env.local ANTES de importar el módulo (mismo patrón que
 * confirm-token.test.ts). Si la key no está (CI sin secrets), seteamos una key
 * de test determinística — el módulo solo exige 32 bytes base64.
 */
import { readFileSync } from "node:fs";

if (!process.env.FOLIO_ENC_HMAC_KEY) {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z_]+)="?([^"\r\n]+)"?$/.exec(line.trim());
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // .env.local ausente — cae al fallback de abajo.
  }
}
if (!process.env.FOLIO_ENC_HMAC_KEY) {
  process.env.FOLIO_ENC_HMAC_KEY = Buffer.alloc(32, 11).toString("base64");
}

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  buildGoogleOAuthState,
  googleOAuthStateCookieOptions,
  verifyGoogleOAuthState,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_TTL_S,
} from "../../lib/google/oauth-state";

const MEMBER = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
/** El memberId del colega: lo que el atacante conoce y podía usar como state. */
const MEMBER_VICTIMA = "9c858901-8a57-4791-81fe-4c455b099bc9";

/** Réplica del formato v1 para poder firmar payloads adversariales. */
function signLocal(payload: string): string {
  const key = Buffer.from(process.env.FOLIO_ENC_HMAC_KEY!, "base64");
  return createHmac("sha256", key)
    .update(`folio:gcal-oauth-state:v1:${payload}`, "utf8")
    .digest("base64url");
}

function craftCookie(payload: string): string {
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signLocal(payload)}`;
}

function payloadOf(cookieValue: string): string {
  return Buffer.from(cookieValue.split(".")[0], "base64url").toString("utf8");
}

// ─── Roundtrip feliz ────────────────────────────────────────────────────────

test("roundtrip: el state del par valida contra su cookie y devuelve el memberId", () => {
  const { state, cookieValue } = buildGoogleOAuthState({
    memberId: MEMBER,
    fromOnboarding: false,
  });
  assert.deepEqual(verifyGoogleOAuthState(cookieValue, state), {
    ok: true,
    memberId: MEMBER,
    fromOnboarding: false,
  });
});

test("roundtrip: fromOnboarding viaja en la cookie, no en el query", () => {
  const { state, cookieValue } = buildGoogleOAuthState({
    memberId: MEMBER,
    fromOnboarding: true,
  });
  const v = verifyGoogleOAuthState(cookieValue, state);
  assert.ok(v.ok);
  assert.equal(v.fromOnboarding, true);
});

test("el memberId se normaliza a lowercase", () => {
  const { state, cookieValue } = buildGoogleOAuthState({
    memberId: MEMBER.toUpperCase(),
    fromOnboarding: false,
  });
  const v = verifyGoogleOAuthState(cookieValue, state);
  assert.ok(v.ok);
  assert.equal(v.memberId, MEMBER);
});

// ─── El nonce ───────────────────────────────────────────────────────────────

test("el state NO deriva del memberId: dos flows del mismo member dan nonces distintos", () => {
  const a = buildGoogleOAuthState({ memberId: MEMBER, fromOnboarding: false });
  const b = buildGoogleOAuthState({ memberId: MEMBER, fromOnboarding: false });
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.cookieValue, b.cookieValue);
  // Y no contiene el memberId (ni entero ni su primer bloque).
  assert.equal(a.state.includes(MEMBER), false);
  assert.equal(a.state.includes(MEMBER.split("-")[0]), false);
});

test("el state es opaco y URL-safe (base64url de 32 bytes, sin +/=)", () => {
  const { state } = buildGoogleOAuthState({ memberId: MEMBER, fromOnboarding: false });
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(encodeURIComponent(state), state);
});

test("la cookie es apta para header Set-Cookie (base64url + un punto)", () => {
  const { cookieValue } = buildGoogleOAuthState({ memberId: MEMBER, fromOnboarding: true });
  assert.match(cookieValue, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(encodeURIComponent(cookieValue), cookieValue);
});

// ─── El ataque que motivó el fix ────────────────────────────────────────────

test("ATAQUE: state = memberId de la víctima (el viejo formato) ⇒ mismatch", () => {
  const { cookieValue } = buildGoogleOAuthState({ memberId: MEMBER, fromOnboarding: false });
  assert.equal(verifyGoogleOAuthState(cookieValue, MEMBER_VICTIMA).ok, false);
  assert.equal(verifyGoogleOAuthState(cookieValue, `${MEMBER_VICTIMA}:onb`).ok, false);
  // Ni siquiera el memberId propio sirve como state.
  assert.equal(verifyGoogleOAuthState(cookieValue, MEMBER).ok, false);
});

test("ATAQUE: víctima sin cookie (nunca inició el flow) ⇒ sin_cookie, no exchange", () => {
  const { state } = buildGoogleOAuthState({ memberId: MEMBER, fromOnboarding: false });
  for (const cookie of [null, undefined, ""]) {
    assert.deepEqual(verifyGoogleOAuthState(cookie, state), {
      ok: false,
      reason: "sin_cookie",
      fromOnboarding: false,
    });
  }
});

test("ATAQUE: nonce de OTRO flow (cookie de un flow, state de otro) ⇒ mismatch", () => {
  const atacante = buildGoogleOAuthState({ memberId: MEMBER, fromOnboarding: false });
  const victima = buildGoogleOAuthState({ memberId: MEMBER_VICTIMA, fromOnboarding: false });
  const v = verifyGoogleOAuthState(victima.cookieValue, atacante.state);
  assert.deepEqual(v, { ok: false, reason: "mismatch", fromOnboarding: false });
});

test("ATAQUE: cookie forjada con el memberId de la víctima ⇒ invalido (firma)", () => {
  // Sin la HMAC key no se puede fabricar el par (nonce, memberId).
  const nonce = "a".repeat(43);
  const payload = `${nonce}.${MEMBER_VICTIMA}.0.${Date.now() + 60_000}`;
  const forjada = `${Buffer.from(payload, "utf8").toString("base64url")}.${"x".repeat(43)}`;
  assert.deepEqual(verifyGoogleOAuthState(forjada, nonce), {
    ok: false,
    reason: "invalido",
    fromOnboarding: false,
  });
});

test("el memberId NUNCA sale del query: cambiarlo en la cookie exige re-firmar", () => {
  const { state, cookieValue } = buildGoogleOAuthState({
    memberId: MEMBER,
    fromOnboarding: false,
  });
  const [, sig] = cookieValue.split(".");
  const swapped = payloadOf(cookieValue).replace(MEMBER, MEMBER_VICTIMA);
  const tampered = `${Buffer.from(swapped, "utf8").toString("base64url")}.${sig}`;
  assert.deepEqual(verifyGoogleOAuthState(tampered, state), {
    ok: false,
    reason: "invalido",
    fromOnboarding: false,
  });
});

// ─── Expiración ─────────────────────────────────────────────────────────────

test("cookie vencida ⇒ expirado (aunque el state coincida)", () => {
  const now = 1_700_000_000_000;
  const { state, cookieValue } = buildGoogleOAuthState(
    { memberId: MEMBER, fromOnboarding: false },
    now,
  );
  const v = verifyGoogleOAuthState(cookieValue, state, now + GOOGLE_OAUTH_STATE_TTL_S * 1000);
  assert.deepEqual(v, { ok: false, reason: "expirado", fromOnboarding: false });
});

test("borde: 1 ms antes del vencimiento todavía vale", () => {
  const now = 1_700_000_000_000;
  const { state, cookieValue } = buildGoogleOAuthState(
    { memberId: MEMBER, fromOnboarding: false },
    now,
  );
  const v = verifyGoogleOAuthState(
    cookieValue,
    state,
    now + GOOGLE_OAUTH_STATE_TTL_S * 1000 - 1,
  );
  assert.ok(v.ok);
});

test("exp extendida a mano con la firma vieja ⇒ invalido, no vale más tiempo", () => {
  const now = 1_700_000_000_000;
  const { state, cookieValue } = buildGoogleOAuthState(
    { memberId: MEMBER, fromOnboarding: false, expMs: now + 1000 },
    now,
  );
  const [, sig] = cookieValue.split(".");
  const extendido = payloadOf(cookieValue).replace(`${now + 1000}`, `${now + 9_000_000}`);
  const tampered = `${Buffer.from(extendido, "utf8").toString("base64url")}.${sig}`;
  assert.deepEqual(verifyGoogleOAuthState(tampered, state, now + 5000), {
    ok: false,
    reason: "invalido",
    fromOnboarding: false,
  });
});

test("cookie vencida conserva fromOnboarding para saber a dónde volver", () => {
  const now = 1_700_000_000_000;
  const { state, cookieValue } = buildGoogleOAuthState(
    { memberId: MEMBER, fromOnboarding: true, expMs: now + 1000 },
    now,
  );
  const v = verifyGoogleOAuthState(cookieValue, state, now + 2000);
  assert.deepEqual(v, { ok: false, reason: "expirado", fromOnboarding: true });
});

// ─── Payloads firmados con contenido inválido ───────────────────────────────

test("payload firmado con memberId no-UUID ⇒ invalido", () => {
  const nonce = "b".repeat(43);
  const cookie = craftCookie(`${nonce}.no-soy-un-uuid.0.${Date.now() + 60_000}`);
  assert.equal(verifyGoogleOAuthState(cookie, nonce).ok, false);
  assert.equal(
    (verifyGoogleOAuthState(cookie, nonce) as { reason: string }).reason,
    "invalido",
  );
});

test("payload firmado con flag onb fuera de {0,1} ⇒ invalido", () => {
  const nonce = "c".repeat(43);
  const cookie = craftCookie(`${nonce}.${MEMBER}.2.${Date.now() + 60_000}`);
  assert.equal(verifyGoogleOAuthState(cookie, nonce).ok, false);
});

test("payload firmado con nonce de largo raro ⇒ invalido", () => {
  const corto = "d".repeat(10);
  const cookie = craftCookie(`${corto}.${MEMBER}.0.${Date.now() + 60_000}`);
  assert.equal(verifyGoogleOAuthState(cookie, corto).ok, false);
});

test("payload firmado con partes de más ⇒ invalido", () => {
  const nonce = "e".repeat(43);
  const cookie = craftCookie(`${nonce}.${MEMBER}.0.${Date.now() + 60_000}.extra`);
  assert.equal(verifyGoogleOAuthState(cookie, nonce).ok, false);
});

// ─── Input hostil / malformado: nunca lanza ─────────────────────────────────

test("cookies malformadas ⇒ invalido sin throw", () => {
  const casos = [
    ".",
    "..",
    "abc",
    "a.b.c",
    ".soloSig",
    "soloData.",
    "$$$.$$$",
    "áéí.óúñ",
    `${"A".repeat(600)}.${"B".repeat(600)}`, // supera MAX_COOKIE_LEN
    Buffer.from("basura", "utf8").toString("base64url"), // sin punto
  ];
  for (const c of casos) {
    const v = verifyGoogleOAuthState(c, "cualquier-state");
    assert.deepEqual(v, { ok: false, reason: "invalido", fromOnboarding: false }, `caso: ${JSON.stringify(c)}`);
  }
});

test("state del query ausente/vacío con cookie válida ⇒ mismatch sin throw", () => {
  const { cookieValue } = buildGoogleOAuthState({ memberId: MEMBER, fromOnboarding: false });
  for (const q of [null, undefined, ""]) {
    assert.deepEqual(verifyGoogleOAuthState(cookieValue, q), {
      ok: false,
      reason: "mismatch",
      fromOnboarding: false,
    });
  }
});

// ─── Validación del builder (errores de programación) ───────────────────────

test("buildGoogleOAuthState lanza con memberId no-UUID", () => {
  assert.throws(
    () => buildGoogleOAuthState({ memberId: "nope", fromOnboarding: false }),
    /memberId/,
  );
});

test("buildGoogleOAuthState lanza con expMs inválido", () => {
  for (const expMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => buildGoogleOAuthState({ memberId: MEMBER, fromOnboarding: false, expMs }),
      /expMs/,
      `expMs: ${expMs}`,
    );
  }
});

// ─── Atributos de la cookie ─────────────────────────────────────────────────

test("la cookie es httpOnly + SameSite=Lax + path / (Lax: el retorno de Google es GET top-level)", () => {
  const opts = googleOAuthStateCookieOptions(GOOGLE_OAUTH_STATE_TTL_S);
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "lax");
  assert.equal(opts.path, "/");
  assert.equal(opts.maxAge, GOOGLE_OAUTH_STATE_TTL_S);
  assert.equal(GOOGLE_OAUTH_STATE_TTL_S <= 900, true, "TTL corto (<= 15 min)");
});

// Mismo helper que tests/unit/mp-webhook-live-mode.test.ts: asignación + delete.
// Object.defineProperty sobre process.env falla — el proxy exige un descriptor
// writable+enumerable y rechaza restaurar un valor previo `undefined`.
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

test("secure sigue a NODE_ENV: true en producción, false en local http", () => {
  withEnv({ NODE_ENV: "production" }, () => {
    assert.equal(googleOAuthStateCookieOptions(60).secure, true);
  });
  withEnv({ NODE_ENV: "development" }, () => {
    assert.equal(googleOAuthStateCookieOptions(60).secure, false);
  });
});

test("borrar la cookie usa los MISMOS atributos que el seteo (si no, no se borra)", () => {
  const set = googleOAuthStateCookieOptions(GOOGLE_OAUTH_STATE_TTL_S);
  const del = googleOAuthStateCookieOptions(0);
  assert.equal(del.maxAge, 0);
  assert.equal(del.path, set.path);
  assert.equal(del.httpOnly, set.httpOnly);
  assert.equal(del.sameSite, set.sameSite);
  assert.equal(del.secure, set.secure);
});

test("el nombre de la cookie está namespaceado bajo folio.", () => {
  assert.equal(GOOGLE_OAUTH_STATE_COOKIE.startsWith("folio."), true);
});
