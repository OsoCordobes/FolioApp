import assert from "node:assert/strict";
import test from "node:test";

import { decideProfesionalDestino } from "../../lib/db/profesional-destino";

// ─── decideProfesionalDestino (pura) ────────────────────────────────────────
//
// CLINICA-3 (hallazgos A/B): la regla server-side de asignación de
// profesional para createTurnoAction y aceptarPedido. La I/O (validación
// contra `member` vía RLS) vive en resolveProfesionalDestino; acá se testea
// la decisión: a quién asignar y si hace falta el round-trip de validación.

const SESSION = "cccccccc-0000-0000-0000-000000000003";
const OTRO = "aaaaaaaa-0000-0000-0000-000000000001";

test("param explícito ajeno → usar ese, CON validación DB", () => {
  const d = decideProfesionalDestino({
    profesionalIdParam: OTRO,
    sessionMemberId: SESSION,
    sessionEsColegiado: true,
  });
  assert.deepEqual(d, { kind: "usar", profesionalId: OTRO, validar: true });
});

test("param == sesión colegiada → usar sin round-trip (la sesión ya es member activo colegiado)", () => {
  const d = decideProfesionalDestino({
    profesionalIdParam: SESSION,
    sessionMemberId: SESSION,
    sessionEsColegiado: true,
  });
  assert.deepEqual(d, { kind: "usar", profesionalId: SESSION, validar: false });
});

test("param == sesión NO colegiada → igual se valida en DB (y va a fallar): sin atajo silencioso", () => {
  const d = decideProfesionalDestino({
    profesionalIdParam: SESSION,
    sessionMemberId: SESSION,
    sessionEsColegiado: false,
  });
  assert.deepEqual(d, { kind: "usar", profesionalId: SESSION, validar: true });
});

test("sin param + sesión colegiada → la sesión, sin validación", () => {
  const d = decideProfesionalDestino({
    profesionalIdParam: null,
    sessionMemberId: SESSION,
    sessionEsColegiado: true,
  });
  assert.deepEqual(d, { kind: "usar", profesionalId: SESSION, validar: false });
});

test("sin param + sesión NO colegiada (secretaria) → faltante: el viejo fallback a session.memberId queda prohibido", () => {
  const d = decideProfesionalDestino({
    profesionalIdParam: null,
    sessionMemberId: SESSION,
    sessionEsColegiado: false,
  });
  assert.deepEqual(d, { kind: "faltante" });
});
