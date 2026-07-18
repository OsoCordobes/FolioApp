/**
 * Folio · tests de mapSupabaseError (lib/db/errors.ts) — PR S4.
 *
 * Regla que se pinea: **SQLSTATE (error.code) primero, substring del mensaje
 * sólo como fallback**. En particular:
 *   - 42501 (insufficient_privilege) ⇒ `forbidden` (antes se disfrazaba de
 *     `auth_required` cuando el mensaje no decía "violates row-level security").
 *   - JWT ⇒ `auth_required` por code (PGRST301/PGRST302) o por substring "JWT",
 *     pero NUNCA por 42501.
 *   - P0001 (RAISE EXCEPTION sin ERRCODE) ⇒ discrimina locked vs transition por
 *     substring, porque el SQLSTATE es compartido.
 *   - Fallback: cuando el driver dropea `code`, el substring igual matchea.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { isUniqueViolation, mapSupabaseError } from "../../lib/db/errors";

// ─── 42501 insufficient_privilege ⇒ forbidden (SQLSTATE-first) ───────────────

test("42501 con mensaje RLS ⇒ forbidden", () => {
  const r = mapSupabaseError({
    message: 'new row violates row-level security policy for table "paciente"',
    code: "42501",
  });
  assert.equal(r.code, "forbidden");
  assert.equal(r.message, "No tenés permiso para esa acción.");
});

test("42501 SIN mención de RLS (ej. policy M51 no-CLINICA) ⇒ forbidden, NO auth_required", () => {
  // Regresión: antes esta rama caía en `code === '42501' ⇒ auth_required` y
  // mostraba "Volvé a iniciar sesión" para un problema de permisos.
  const r = mapSupabaseError({
    message: "permission denied for table member",
    code: "42501",
  });
  assert.equal(r.code, "forbidden");
  assert.notEqual(r.code, "auth_required");
});

test("substring 'violates row-level security' SIN code (driver dropeó code) ⇒ forbidden", () => {
  const r = mapSupabaseError({
    message: 'new row violates row-level security policy for table "turno"',
  });
  assert.equal(r.code, "forbidden");
});

// ─── JWT / auth ⇒ auth_required (por code o substring, jamás por 42501) ──────

test("PGRST301 (JWT expirado) ⇒ auth_required", () => {
  const r = mapSupabaseError({ message: "JWT expired", code: "PGRST301" });
  assert.equal(r.code, "auth_required");
  assert.equal(r.message, "Volvé a iniciar sesión.");
});

test("PGRST302 (no autenticado) ⇒ auth_required", () => {
  const r = mapSupabaseError({ message: "anonymous", code: "PGRST302" });
  assert.equal(r.code, "auth_required");
});

test("substring 'JWT' sin code ⇒ auth_required (fallback)", () => {
  const r = mapSupabaseError({ message: "invalid JWT signature" });
  assert.equal(r.code, "auth_required");
});

// ─── P0001 (RAISE EXCEPTION sin ERRCODE): discrimina por substring ───────────

test("P0001 'Sesión bloqueada' ⇒ locked", () => {
  const r = mapSupabaseError({
    message:
      "Sesión bloqueada (locked_at=2026-01-01). Usá sesion_enmienda para correcciones (Ley 26.529 art. 15).",
    code: "P0001",
  });
  assert.equal(r.code, "locked");
  assert.equal(
    r.message,
    "La sesión está bloqueada. Usá una enmienda para corregir.",
  );
});

test("P0001 'Invalid turno transition' ⇒ transition_invalid", () => {
  const r = mapSupabaseError({
    message: "Invalid turno transition: AGENDADO → CERRADO",
    code: "P0001",
  });
  assert.equal(r.code, "transition_invalid");
  assert.equal(r.message, "Esa transición no está permitida.");
});

test("'Sesión bloqueada' sin code ⇒ locked (fallback substring)", () => {
  const r = mapSupabaseError({
    message: "Sesión bloqueada (locked_at=2026-01-01).",
  });
  assert.equal(r.code, "locked");
});

test("'Invalid turno transition' sin code ⇒ transition_invalid (fallback substring)", () => {
  const r = mapSupabaseError({ message: "Invalid turno transition: EN_SALA → CERRADO" });
  assert.equal(r.code, "transition_invalid");
});

test("P0001 con mensaje desconocido ⇒ db_error (no se malinterpreta)", () => {
  const r = mapSupabaseError({ message: "algo raro custom", code: "P0001" });
  assert.equal(r.code, "db_error");
});

test("mensaje ajeno que contiene 'Invalid turno transition' pero con code NO-P0001 ⇒ no matchea la rama de dominio", () => {
  // El guard `code === 'P0001' || code === ''` evita que un 23505 con un texto
  // que casualmente incluya la frase se mapee a transition_invalid.
  const r = mapSupabaseError({
    message: "duplicate key ... Invalid turno transition mention",
    code: "23505",
  });
  assert.equal(r.code, "conflict");
});

// ─── 23505 unique_violation (por code) + detalles específicos ────────────────

test("23505 DNI parcial-unique ⇒ conflict con mensaje de DNI", () => {
  const r = mapSupabaseError({
    message: 'duplicate key value violates unique constraint "paciente_identidad_dni_unique_active"',
    code: "23505",
    details: "Key (org, dni_hash)=(...) already exists.",
  });
  assert.equal(r.code, "conflict");
  assert.equal(r.message, "Ya existe un paciente con ese DNI en tu organización.");
});

test("23505 teléfono parcial-unique ⇒ conflict con mensaje de teléfono", () => {
  const r = mapSupabaseError({
    message: "duplicate key",
    code: "23505",
    details: "paciente_identidad_telefono_unique_active",
  });
  assert.equal(r.code, "conflict");
  assert.equal(r.message, "Ya existe un paciente con ese teléfono en tu organización.");
});

test("23505 genérico ⇒ conflict genérico", () => {
  const r = mapSupabaseError({ message: "duplicate key", code: "23505" });
  assert.equal(r.code, "conflict");
  assert.equal(r.message, "Ya existe un registro con esos datos.");
});

// ─── Otros SQLSTATE (por code) ───────────────────────────────────────────────

test("23503 foreign_key_violation ⇒ conflict (datos relacionados)", () => {
  const r = mapSupabaseError({ message: "violates foreign key constraint", code: "23503" });
  assert.equal(r.code, "conflict");
  assert.equal(r.message, "No se puede borrar: hay datos relacionados.");
});

test("23P01 exclusion_violation (doble reserva M40) ⇒ conflict", () => {
  const r = mapSupabaseError({ message: "conflicting key value violates exclusion constraint", code: "23P01" });
  assert.equal(r.code, "conflict");
  assert.equal(r.message, "Ese profesional ya tiene un turno en ese horario.");
});

test("PGRST116 ⇒ not_found (por code)", () => {
  const r = mapSupabaseError({ message: "Results contain 0 rows", code: "PGRST116" });
  assert.equal(r.code, "not_found");
});

test("substring 'no rows' sin code ⇒ not_found (fallback)", () => {
  const r = mapSupabaseError({ message: "JSON object requested, multiple (or no rows) returned" });
  assert.equal(r.code, "not_found");
});

test("code totalmente desconocido ⇒ db_error", () => {
  const r = mapSupabaseError({ message: "connection reset", code: "08006" });
  assert.equal(r.code, "db_error");
  assert.equal(r.message, "Error en la base de datos.");
});

test("error sin code ni substring conocido ⇒ db_error", () => {
  const r = mapSupabaseError({ message: "something unexpected" });
  assert.equal(r.code, "db_error");
});

// ─── detail siempre preserva el mensaje técnico ──────────────────────────────

test("detail preserva el mensaje original para logs", () => {
  const r = mapSupabaseError({ message: "permission denied for table x", code: "42501" });
  assert.equal(r.detail, "permission denied for table x");
});

// ─── isUniqueViolation (sin cambios, pero se pinea por code y por substring) ─

test("isUniqueViolation: true por code 23505", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
});

test("isUniqueViolation: true por substring 'duplicate key' sin code", () => {
  assert.equal(isUniqueViolation({ message: "duplicate key value" }), true);
});

test("isUniqueViolation: false para otro error / null", () => {
  assert.equal(isUniqueViolation({ code: "23503", message: "fk" }), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
});
