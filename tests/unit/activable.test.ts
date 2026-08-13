/**
 * Folio · activación por teclado de filas clickeables (E2).
 *
 * El bug que se protege acá es "se enfoca y no se activa": las cabeceras de
 * /hoy tenían role="button" + tabIndex={0} sin handler de teclado. El usuario
 * ve el anillo de foco, aprieta Enter y no pasa nada.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { activable } from "../../lib/a11y/activable";

/** KeyboardEvent mínimo: lo que el handler realmente toca. */
function tecla(key: string, { mismoElemento = true } = {}) {
  const el = {};
  let prevenido = false;
  return {
    ev: {
      key,
      target: mismoElemento ? el : {},
      currentTarget: el,
      preventDefault: () => {
        prevenido = true;
      },
    },
    prevenido: () => prevenido,
  };
}

test("expone role, tabIndex y ambos handlers", () => {
  const props = activable(() => {});
  assert.equal(props.role, "button");
  assert.equal(props.tabIndex, 0);
  assert.equal(typeof props.onClick, "function");
  assert.equal(typeof props.onKeyDown, "function");
});

test("Enter y Space activan, igual que el click", () => {
  for (const key of ["Enter", " "]) {
    let veces = 0;
    const props = activable(() => veces++);
    const t = tecla(key);
    props.onKeyDown(t.ev as never);
    assert.equal(veces, 1, `${key} no activó`);
    assert.equal(t.prevenido(), true, `${key} no llamó preventDefault`);
  }
});

test("cualquier otra tecla no hace nada ni bloquea el default", () => {
  // Tab tiene que seguir moviendo el foco, y las flechas scrolleando.
  for (const key of ["Tab", "ArrowDown", "a", "Escape", "Shift"]) {
    let veces = 0;
    const props = activable(() => veces++);
    const t = tecla(key);
    props.onKeyDown(t.ev as never);
    assert.equal(veces, 0, `${key} activó y no debía`);
    assert.equal(t.prevenido(), false, `${key} bloqueó su comportamiento normal`);
  }
});

test("un Enter en un control de ADENTRO no activa la fila", () => {
  // La fila del turno contiene los botones Cobrar y Cancelar. Sin el check de
  // target, apretar Enter en "Cancelar" cancelaba el turno Y abría la ficha.
  let veces = 0;
  const props = activable(() => veces++);
  const t = tecla("Enter", { mismoElemento: false });
  props.onKeyDown(t.ev as never);
  assert.equal(veces, 0);
  assert.equal(t.prevenido(), false, "no puede comerse el Enter del control de adentro");
});

test("onClick activa sin condiciones", () => {
  let veces = 0;
  activable(() => veces++).onClick();
  assert.equal(veces, 1);
});
