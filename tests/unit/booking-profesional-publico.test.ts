import assert from "node:assert/strict";
import test from "node:test";

import {
  esMultiProfesional,
  nombreProfesionalSeleccionado,
  pasoPrevioASlot,
  pasoTrasServicio,
  profesionalIdParaActions,
} from "../../lib/booking/wizard-profesional";
import { decideProfesionalPublico } from "../../lib/db/profesional-destino";

// ─── CLINICA-4 · booking público multi-profesional ──────────────────────────
//
// Dos decisiones puras, una por punta:
//   - decideProfesionalPublico (server): a qué profesional va el booking
//     según param explícito + colegiados de la org (0/1/N). La I/O (validar
//     contra `member` con el service client) vive en
//     resolveProfesionalPublico.
//   - wizard-profesional (client): cuándo aparece el paso "Elegí
//     profesional" y qué viaja a las actions. Invariante crítico: con 0–1
//     colegiados el wizard es EXACTAMENTE el histórico (flujo Solo intacto).

const PROF_A = "aaaaaaaa-0000-0000-0000-000000000001";
const PROF_B = "bbbbbbbb-0000-0000-0000-000000000002";
const PROF_C = "cccccccc-0000-0000-0000-000000000003";

// ─── decideProfesionalPublico (server) ──────────────────────────────────────

test("param explícito → validar en DB que siga colegiado activo (aun con 1 colegiado)", () => {
  const d = decideProfesionalPublico({
    profesionalIdParam: PROF_B,
    colegiadosOrdenados: [PROF_A],
  });
  assert.deepEqual(d, { kind: "validar", profesionalId: PROF_B });
});

test("sin param + 0 colegiados → sin_colegiados (booking muerto explícito, no silencioso)", () => {
  const d = decideProfesionalPublico({
    profesionalIdParam: null,
    colegiadosOrdenados: [],
  });
  assert.deepEqual(d, { kind: "sin_colegiados" });
});

test("sin param + 1 colegiado → usar ese (caso Solo: cero cambios de flujo)", () => {
  const d = decideProfesionalPublico({
    profesionalIdParam: null,
    colegiadosOrdenados: [PROF_A],
  });
  assert.deepEqual(d, { kind: "usar", profesionalId: PROF_A });
});

test("sin param + >1 colegiado → faltante: el paciente elige (nunca más un 'primero' arbitrario)", () => {
  const d = decideProfesionalPublico({
    profesionalIdParam: null,
    colegiadosOrdenados: [PROF_A, PROF_B, PROF_C],
  });
  assert.deepEqual(d, { kind: "faltante" });
});

test("param explícito gana aun con >1 colegiado (no se re-resuelve: misma identidad fetch→submit)", () => {
  const d = decideProfesionalPublico({
    profesionalIdParam: PROF_C,
    colegiadosOrdenados: [PROF_A, PROF_B, PROF_C],
  });
  assert.deepEqual(d, { kind: "validar", profesionalId: PROF_C });
});

// ─── wizard-profesional (client) ────────────────────────────────────────────

const lite = (id: string) => ({ id, displayName: `Prof ${id.slice(0, 2)}` });

test("paso 'Elegí profesional': solo con >1 colegiado", () => {
  assert.equal(esMultiProfesional([]), false);
  assert.equal(esMultiProfesional([lite(PROF_A)]), false);
  assert.equal(esMultiProfesional([lite(PROF_A), lite(PROF_B)]), true);
});

test("flujo Solo: servicio → slot directo, volver desde slot → servicio (histórico intacto)", () => {
  assert.equal(pasoTrasServicio(false), "slot");
  assert.equal(pasoPrevioASlot(false), "servicio");
});

test("flujo multi-prof: servicio → profesional → slot, y el volver desde slot va al picker", () => {
  assert.equal(pasoTrasServicio(true), "profesional");
  assert.equal(pasoPrevioASlot(true), "profesional");
});

test("a las actions: el flujo Solo NO manda profesionalId (firma aditiva, back-compat total)", () => {
  assert.equal(profesionalIdParaActions(false, null), undefined);
  // Defensivo: aunque hubiera una selección colgada, Solo no la manda.
  assert.equal(profesionalIdParaActions(false, PROF_A), undefined);
});

test("a las actions: multi-prof manda el elegido; sin elección no manda nada (el server valida)", () => {
  assert.equal(profesionalIdParaActions(true, PROF_B), PROF_B);
  assert.equal(profesionalIdParaActions(true, null), undefined);
});

test("'con {nombre}': display del elegido, null si no hay selección o el id no está en la lista", () => {
  const profs = [lite(PROF_A), lite(PROF_B)];
  assert.equal(nombreProfesionalSeleccionado(profs, PROF_B), "Prof bb");
  assert.equal(nombreProfesionalSeleccionado(profs, null), null);
  assert.equal(nombreProfesionalSeleccionado(profs, PROF_C), null);
});
