import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDraftIdentity,
  packDraft,
  unpackDraft,
} from "../../lib/onboarding/draft";

test("roundtrip: el dueño del draft lo recupera", () => {
  const raw = packDraft("Vos@Consultorio.com", { nombre: "Lorenzo", tel: "351" });
  const restored = unpackDraft(raw, "vos@consultorio.com");
  assert.deepEqual(restored, { nombre: "Lorenzo", tel: "351" });
});

test("identidad distinta → draft descartado (máquina compartida)", () => {
  const raw = packDraft("dra.perez@clinica.com", {
    nombre: "Ana",
    matricula: "MP 1234",
  });
  // El siguiente profesional en la misma máquina NO hereda el PII anterior.
  assert.equal(unpackDraft(raw, "dr.gomez@clinica.com"), null);
  assert.equal(unpackDraft(raw, ""), null);
});

test("draft anónimo recupera sólo la modalidad, sin datos personales", () => {
  const raw = packDraft("", { tipo: "CLINICA", ownerTratante: false, consultorioNombre: "Clínica previa", nombre: "Ana" });
  assert.deepEqual(unpackDraft(raw, ""), { tipo: "CLINICA", ownerTratante: false });
  assert.equal(unpackDraft(raw, "otra@persona.com"), null);
});

test("password nunca viaja en el draft", () => {
  const raw = packDraft("vos@x.com", { email: "vos@x.com", password: "secreta123" });
  assert.equal(raw.includes("secreta123"), false);
  const restored = unpackDraft(raw, "vos@x.com");
  assert.equal(restored && "password" in restored, false);
});

test("un draft manipulado con password no lo inyecta al restaurar", () => {
  const raw = JSON.stringify({
    v: 1,
    identity: "vos@x.com",
    data: { password: "hackeada", nombre: "X" },
  });
  const restored = unpackDraft(raw, "vos@x.com");
  assert.deepEqual(restored, { nombre: "X" });
});

test("formato legado (objeto plano sin sobre) se descarta", () => {
  const legacy = JSON.stringify({ nombre: "Lorenzo", tel: "351", email: "a@b.com" });
  assert.equal(unpackDraft(legacy, "a@b.com"), null);
  assert.equal(unpackDraft(legacy, ""), null);
});

test("raw null / JSON roto / shapes inválidos → null sin tirar", () => {
  assert.equal(unpackDraft(null, "a@b.com"), null);
  assert.equal(unpackDraft("{not json", "a@b.com"), null);
  assert.equal(unpackDraft('"string"', "a@b.com"), null);
  assert.equal(unpackDraft("[1,2,3]", "a@b.com"), null);
  assert.equal(
    unpackDraft(JSON.stringify({ v: 1, identity: "a@b.com", data: [1] }), "a@b.com"),
    null,
  );
  assert.equal(
    unpackDraft(JSON.stringify({ v: 99, identity: "a@b.com", data: {} }), "a@b.com"),
    null,
  );
});

test("normalizeDraftIdentity: trim + lowercase, null-safe", () => {
  assert.equal(normalizeDraftIdentity("  Vos@X.Com "), "vos@x.com");
  assert.equal(normalizeDraftIdentity(null), "");
  assert.equal(normalizeDraftIdentity(undefined), "");
});

test("el borrador de una organización no se restaura en otra ni acepta el sobre anónimo", () => {
  const orgA = "12600000-0000-4000-8000-000000000001";
  const orgB = "12600000-0000-4000-8000-000000000002";
  const raw = packDraft("owner@example.test", { bio: "Texto sin confirmar", password: "never-store" }, orgA);
  assert.deepEqual(unpackDraft(raw, "owner@example.test", orgA), { bio: "Texto sin confirmar" });
  assert.equal(unpackDraft(raw, "owner@example.test", orgB), null);
  assert.equal(unpackDraft(raw, "other@example.test", orgA), null);
  assert.equal(unpackDraft(raw, "owner@example.test"), null);
  assert.equal(unpackDraft(packDraft("owner@example.test", { bio: "viejo" }), "owner@example.test", orgA), null);
  assert.equal(raw.includes("never-store"), false);
});
