/**
 * Tests de lib/security/verify-bearer.ts — comparación timing-safe del
 * header Authorization de los endpoints cron/admin.
 *
 * Cubre: match exacto, mismatch, header vacío/ausente, secret vacío/ausente,
 * longitudes distintas (timingSafeEqual crudo throwea con buffers de distinto
 * tamaño — el helper debe manejarlas devolviendo false, no throweando).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { timingSafeEqualStrings, verifyBearer } from "../../lib/security/verify-bearer";

// ─── timingSafeEqualStrings ─────────────────────────────────────────────

test("timingSafeEqualStrings: strings iguales → true", () => {
  assert.equal(timingSafeEqualStrings("secreto-123", "secreto-123"), true);
});

test("timingSafeEqualStrings: strings distintos → false", () => {
  assert.equal(timingSafeEqualStrings("secreto-123", "secreto-124"), false);
});

test("timingSafeEqualStrings: longitudes distintas → false (sin throw)", () => {
  assert.equal(timingSafeEqualStrings("corto", "muchísimo-más-largo-que-el-otro"), false);
  assert.equal(timingSafeEqualStrings("", "no-vacío"), false);
});

test("timingSafeEqualStrings: vacío vs vacío → true", () => {
  assert.equal(timingSafeEqualStrings("", ""), true);
});

test("timingSafeEqualStrings: unicode multibyte", () => {
  assert.equal(timingSafeEqualStrings("ñandú-🔐", "ñandú-🔐"), true);
  assert.equal(timingSafeEqualStrings("ñandú-🔐", "ñandú-🔓"), false);
});

// ─── verifyBearer ───────────────────────────────────────────────────────

test("verifyBearer: header correcto → true", () => {
  assert.equal(verifyBearer("Bearer mi-cron-secret", "mi-cron-secret"), true);
});

test("verifyBearer: secret incorrecto → false", () => {
  assert.equal(verifyBearer("Bearer otro-secret", "mi-cron-secret"), false);
});

test("verifyBearer: prefijo Bearer ausente → false", () => {
  assert.equal(verifyBearer("mi-cron-secret", "mi-cron-secret"), false);
});

test("verifyBearer: case-sensitive en el prefijo y el secret", () => {
  assert.equal(verifyBearer("bearer mi-cron-secret", "mi-cron-secret"), false);
  assert.equal(verifyBearer("Bearer MI-CRON-SECRET", "mi-cron-secret"), false);
});

test("verifyBearer: header null/undefined/vacío → false", () => {
  assert.equal(verifyBearer(null, "mi-cron-secret"), false);
  assert.equal(verifyBearer(undefined, "mi-cron-secret"), false);
  assert.equal(verifyBearer("", "mi-cron-secret"), false);
});

test("verifyBearer: secret no configurado → false aunque el header coincida formalmente (fail-closed)", () => {
  assert.equal(verifyBearer("Bearer ", null), false);
  assert.equal(verifyBearer("Bearer ", undefined), false);
  assert.equal(verifyBearer("Bearer ", ""), false);
  // Caso real del bug: con CRON_SECRET vacío, `auth !== "Bearer undefined"` o
  // `"Bearer "` podía habilitar acceso con un header trivial.
  assert.equal(verifyBearer("Bearer undefined", undefined), false);
});

test("verifyBearer: longitudes distintas → false (sin throw)", () => {
  assert.equal(verifyBearer("Bearer x", "un-secret-bastante-largo"), false);
  assert.equal(verifyBearer("Bearer un-secret-bastante-largo-extendido", "un-secret-bastante-largo"), false);
});
