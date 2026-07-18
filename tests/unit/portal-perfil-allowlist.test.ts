import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPOS_CONTACTO_EDITABLES,
  CAMPOS_IDENTIDAD_PROHIBIDOS,
  detectaCampoIdentidad,
  pickContactoEditable,
} from "../../lib/db/portal-perfil";

// ═══════════════════════════════════════════════════════════════════════════════
// Folio · P8 · auto-gestión de contacto del portal — ALLOW-LIST server-side
//
// Verifican la línea de defensa central del PR: el paciente puede editar SÓLO
// contacto/domicilio (email/teléfono/domicilio), NUNCA su identidad (nombre,
// apellido, tipo/número de documento) ni sus hashes de identidad. La verdad dura la
// fijan el schema `.strict()` del data layer + el trigger-guard M86; estos tests
// cubren los helpers puros de la allow-list (pickContactoEditable / detecta).
// ═══════════════════════════════════════════════════════════════════════════════

// ─── pickContactoEditable · sólo deja pasar campos de contacto ───────────────

test("allow-list: pickContactoEditable conserva SÓLO los campos de contacto/domicilio", () => {
  const input = {
    email: "nuevo@mail.com",
    telefono: "3515551234",
    domicilioCalle: "San Martín",
    domicilioNumero: "123",
    domicilioCiudad: "Córdoba",
    domicilioProvincia: "Córdoba",
    domicilioCp: "5000",
  };
  const out = pickContactoEditable(input);
  assert.deepEqual(out, input, "todos los campos de contacto deben pasar sin cambios");
});

test("allow-list: pickContactoEditable DESCARTA nombre/apellido/documento (identidad)", () => {
  const malicioso = {
    email: "ok@mail.com",
    // Intento de tamperear la identidad — DEBE descartarse silenciosamente.
    nombre: "Otro",
    apellido: "Nombre",
    tipoDoc: "PASAPORTE",
    numeroDoc: "99999999",
    dni_hash: "deadbeef",
    nombre_hash: "cafe",
    organization_id: "otra-org",
    identidad_id: "otra-identidad",
  };
  const out = pickContactoEditable(malicioso);
  // Sólo el email sobrevive; ninguna clave de identidad queda.
  assert.deepEqual(out, { email: "ok@mail.com" });
  for (const prohibida of Object.keys(malicioso)) {
    if (prohibida === "email") continue;
    assert.ok(
      !(prohibida in out),
      `la clave de identidad "${prohibida}" no debe sobrevivir al pick`,
    );
  }
});

test("allow-list: pickContactoEditable sobre un objeto sólo-identidad devuelve {}", () => {
  const out = pickContactoEditable({
    nombre: "X",
    apellido: "Y",
    numeroDoc: "123",
    dni_hash: "z",
  });
  assert.deepEqual(out, {}, "ningún campo de identidad debe pasar el filtro");
});

test("allow-list: pickContactoEditable ignora claves desconocidas arbitrarias", () => {
  const out = pickContactoEditable({
    telefono: "3510000000",
    __proto__: "x",
    role: "OWNER",
    cuenta_id: "hijack",
  } as Record<string, unknown>);
  assert.deepEqual(out, { telefono: "3510000000" });
});

// ─── detectaCampoIdentidad · delata intentos de tamperear identidad ──────────

test("detecta: un input sólo-contacto NO dispara detectaCampoIdentidad", () => {
  const hit = detectaCampoIdentidad({
    email: "a@b.com",
    telefono: "3515551234",
    domicilioCiudad: "Córdoba",
  });
  assert.equal(hit, null);
});

test("detecta: un input con nombre dispara detectaCampoIdentidad", () => {
  const hit = detectaCampoIdentidad({ email: "a@b.com", nombre: "Otro" });
  assert.equal(hit, "nombre");
});

test("detecta: es case-insensitive contra las claves de identidad", () => {
  assert.equal(detectaCampoIdentidad({ Numero_Doc: "1" }), "Numero_Doc");
  assert.equal(detectaCampoIdentidad({ DNI: "1" }), "DNI");
  assert.equal(detectaCampoIdentidad({ Organization_Id: "x" }), "Organization_Id");
});

// ─── Invariante estructural: las dos listas son disjuntas ────────────────────

test("allow-list: contacto-editables e identidad-prohibidos son conjuntos disjuntos", () => {
  const editables = new Set<string>(
    CAMPOS_CONTACTO_EDITABLES.map((k) => k.toLowerCase()),
  );
  for (const prohibida of CAMPOS_IDENTIDAD_PROHIBIDOS) {
    assert.ok(
      !editables.has(prohibida.toLowerCase()),
      `"${prohibida}" no puede estar a la vez en editables y prohibidos`,
    );
  }
});

test("allow-list: la whitelist de contacto es exactamente la esperada", () => {
  assert.deepEqual(
    [...CAMPOS_CONTACTO_EDITABLES],
    [
      "email",
      "telefono",
      "domicilioCalle",
      "domicilioNumero",
      "domicilioCiudad",
      "domicilioProvincia",
      "domicilioCp",
    ],
  );
});
