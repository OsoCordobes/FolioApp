/** Central synthetic keys and network isolation; no environment files. */
import "../../scripts/testing/unit-bootstrap.mjs";

import assert from "node:assert/strict";
import test from "node:test";

import { blindIndex, blindIndexPhone, decryptColumn } from "../../lib/crypto";
import { buildContactoUpdatePayload } from "../../lib/db/pacientes";

const ORG = "a1000000-0000-4000-8000-000000000001";

const base = {
  nombre: "Ana",
  apellido: "Pérez",
  telefono: "+54 351 555 1234",
  email: "ana@ejemplo.com",
  ocupacion: "Docente",
};

test("recalcula los DOS blind indexes, con la sal de la organización", () => {
  const p = buildContactoUpdatePayload(base, ORG);
  assert.equal(p.nombre_hash, blindIndex("Ana Pérez", ORG));
  assert.equal(p.telefono_hash, blindIndexPhone("+54 351 555 1234", ORG));
  // Sin sal daría otro hash: el paciente quedaría fuera del índice de su org.
  assert.notEqual(p.nombre_hash, blindIndex("Ana Pérez"));
});

test("el hash del nombre se arma como 'nombre apellido', igual que el alta", () => {
  // Si el alta y la edición armaran el hash distinto, editar el contacto sacaría
  // al paciente del buscador aunque el nombre no hubiera cambiado.
  const p = buildContactoUpdatePayload({ ...base, nombre: "  Ana  ", apellido: "  Pérez " }, ORG);
  assert.equal(p.nombre_hash, blindIndex("Ana Pérez", ORG));
});

test("cambiar el nombre CAMBIA el hash", () => {
  const antes = buildContactoUpdatePayload(base, ORG);
  const despues = buildContactoUpdatePayload({ ...base, apellido: "Gómez" }, ORG);
  assert.notEqual(antes.nombre_hash, despues.nombre_hash);
});

test("cambiar el teléfono CAMBIA su hash", () => {
  const antes = buildContactoUpdatePayload(base, ORG);
  const despues = buildContactoUpdatePayload({ ...base, telefono: "+54 351 555 9999" }, ORG);
  assert.notEqual(antes.telefono_hash, despues.telefono_hash);
});

test("el dni_hash NO se toca: el documento no se edita desde este modal", () => {
  const p = buildContactoUpdatePayload(base, ORG);
  assert.equal("dni_hash" in p, false);
});

test("email y ocupación vacíos se guardan como NULL, no como cadena vacía", () => {
  // Una cadena vacía en una columna nullable hace que "sin email" y "email
  // borrado" se vean distinto en la base sin serlo.
  const p = buildContactoUpdatePayload({ ...base, email: "", ocupacion: "   " }, ORG);
  assert.equal(p.ocupacion_cifrado, null);
  // encryptColumn(null) devuelve null: no se cifra una cadena vacía.
  assert.equal(p.email_cifrado, null);
});

test("los campos de texto se guardan trimmeados", () => {
  const p = buildContactoUpdatePayload({ ...base, ocupacion: "  Kinesióloga  " }, ORG);
  assert.equal(decryptColumn(p.ocupacion_cifrado as string), "Kinesióloga");
});

test("todas las columnas de PII salen cifradas, nunca en claro", () => {
  const p = buildContactoUpdatePayload(base, ORG);
  const serializado = JSON.stringify(p);
  for (const claro of ["Ana", "Pérez", "555 1234", "ana@ejemplo.com", "Docente"]) {
    assert.equal(
      serializado.includes(claro),
      false,
      `"${claro}" no puede aparecer en claro en el payload`,
    );
  }
  assert.equal(decryptColumn(p.ocupacion_cifrado as string), "Docente");
});


test("staff email updates recompute its blind index with the same org salt; clearing removes both", () => {
  const value = buildContactoUpdatePayload({ ...base, email: "  Ana@Ejemplo.Com  " }, ORG);
  assert.equal(value.email_hash, blindIndex("ana@ejemplo.com", ORG));
  assert.equal(decryptColumn(value.email_cifrado as string), "Ana@Ejemplo.Com");
  const cleared = buildContactoUpdatePayload({ ...base, email: "" }, ORG);
  assert.equal(cleared.email_cifrado, null); assert.equal(cleared.email_hash, null);
});
