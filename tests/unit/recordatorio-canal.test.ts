import assert from "node:assert/strict";
import test from "node:test";

import { decideCanalRecordatorio, type CanalRecordatorio } from "../../lib/db/recordatorios";
import {
  buildConfirmacion24hEmail,
  buildPostVisitaEmail,
  buildRecordatorio2hEmail,
} from "../../lib/email/templates/recordatorio-turno";

// ─── decideCanalRecordatorio: matriz completa ───────────────────────────────
// telefonoValido {true,false} × emailPresente {true,false} ×
// resultadoWhatsApp {undefined,'ok','fallo'} = 12 combinaciones.

const MATRIZ: Array<{
  telefonoValido: boolean;
  emailPresente: boolean;
  resultadoWhatsApp?: "ok" | "fallo";
  esperado: CanalRecordatorio;
}> = [
  // Teléfono válido, aún sin intentar WhatsApp → canal primario.
  { telefonoValido: true, emailPresente: true, esperado: "whatsapp" },
  { telefonoValido: true, emailPresente: false, esperado: "whatsapp" },
  // Teléfono válido, WhatsApp OK → whatsapp (el fallback nunca pisa un éxito).
  { telefonoValido: true, emailPresente: true, resultadoWhatsApp: "ok", esperado: "whatsapp" },
  { telefonoValido: true, emailPresente: false, resultadoWhatsApp: "ok", esperado: "whatsapp" },
  // Teléfono válido, WhatsApp falló → fallback a email si hay; si no, ninguno.
  { telefonoValido: true, emailPresente: true, resultadoWhatsApp: "fallo", esperado: "email" },
  { telefonoValido: true, emailPresente: false, resultadoWhatsApp: "fallo", esperado: "ninguno" },
  // Sin teléfono válido → directo a email/ninguno (nunca whatsapp).
  { telefonoValido: false, emailPresente: true, esperado: "email" },
  { telefonoValido: false, emailPresente: false, esperado: "ninguno" },
  // Sin teléfono válido, resultadoWhatsApp presente (no debería pasar: no se
  // pudo intentar WhatsApp sin destino) → se ignora, gana el estado del canal.
  { telefonoValido: false, emailPresente: true, resultadoWhatsApp: "ok", esperado: "email" },
  { telefonoValido: false, emailPresente: false, resultadoWhatsApp: "ok", esperado: "ninguno" },
  { telefonoValido: false, emailPresente: true, resultadoWhatsApp: "fallo", esperado: "email" },
  { telefonoValido: false, emailPresente: false, resultadoWhatsApp: "fallo", esperado: "ninguno" },
];

for (const caso of MATRIZ) {
  const label =
    `tel=${caso.telefonoValido} email=${caso.emailPresente} ` +
    `wa=${caso.resultadoWhatsApp ?? "—"} → ${caso.esperado}`;
  test(`decideCanalRecordatorio: ${label}`, () => {
    assert.equal(
      decideCanalRecordatorio({
        telefonoValido: caso.telefonoValido,
        emailPresente: caso.emailPresente,
        resultadoWhatsApp: caso.resultadoWhatsApp,
      }),
      caso.esperado,
    );
  });
}

test("decideCanalRecordatorio: nunca devuelve whatsapp sin teléfono válido", () => {
  for (const emailPresente of [true, false]) {
    for (const resultadoWhatsApp of [undefined, "ok", "fallo"] as const) {
      assert.notEqual(
        decideCanalRecordatorio({ telefonoValido: false, emailPresente, resultadoWhatsApp }),
        "whatsapp",
      );
    }
  }
});

test("decideCanalRecordatorio: nunca devuelve email sin email presente", () => {
  for (const telefonoValido of [true, false]) {
    for (const resultadoWhatsApp of [undefined, "ok", "fallo"] as const) {
      assert.notEqual(
        decideCanalRecordatorio({ telefonoValido, emailPresente: false, resultadoWhatsApp }),
        "email",
      );
    }
  }
});

// ─── Templates de email de recordatorio (puros) ─────────────────────────────

const confirmacionBase = {
  pacienteNombre: "Carlos Vega",
  consultorioNombre: "Consultorio Lorenzo",
  servicioNombre: "Consulta inicial",
  fecha: "mié 14 may",
  hora: "10:00",
  direccion: "Av. Siempreviva 742, Córdoba",
};

test("buildConfirmacion24hEmail: subject y html contienen los datos del turno", () => {
  const { subject, html } = buildConfirmacion24hEmail(confirmacionBase);
  assert.ok(subject.includes(confirmacionBase.consultorioNombre));
  assert.ok(html.includes(confirmacionBase.pacienteNombre));
  assert.ok(html.includes(confirmacionBase.servicioNombre));
  assert.ok(html.includes(confirmacionBase.fecha));
  assert.ok(html.includes(confirmacionBase.hora));
  assert.ok(html.includes(confirmacionBase.direccion));
});

test("buildConfirmacion24hEmail: no lanza con direccion null/undefined", () => {
  assert.doesNotThrow(() => {
    const { html } = buildConfirmacion24hEmail({ ...confirmacionBase, direccion: null });
    assert.ok(html.includes(confirmacionBase.pacienteNombre));
    buildConfirmacion24hEmail({ ...confirmacionBase, direccion: undefined });
  });
});

test("buildConfirmacion24hEmail: escapa HTML en los datos", () => {
  const { html } = buildConfirmacion24hEmail({
    ...confirmacionBase,
    pacienteNombre: '<script>alert("x")</script>',
  });
  assert.ok(!html.includes('<script>alert("x")</script>'));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("buildRecordatorio2hEmail: subject y html contienen hora y consultorio", () => {
  const { subject, html } = buildRecordatorio2hEmail({
    pacienteNombre: "Carlos Vega",
    consultorioNombre: "Consultorio Lorenzo",
    hora: "10:00",
  });
  assert.ok(subject.includes("10:00"));
  assert.ok(subject.includes("Consultorio Lorenzo"));
  assert.ok(html.includes("Carlos Vega"));
  assert.ok(html.includes("10:00"));
});

test("buildPostVisitaEmail: incluye el memo cuando está presente", () => {
  const { subject, html } = buildPostVisitaEmail({
    pacienteNombre: "Carlos Vega",
    profesionalNombre: "Consultorio Lorenzo",
    memoCorto: "Tomar 2L de agua por día y aplicar frío 10 min.",
  });
  assert.ok(subject.includes("Consultorio Lorenzo"));
  assert.ok(html.includes("Carlos Vega"));
  assert.ok(html.includes("Tomar 2L de agua"));
});

test("buildPostVisitaEmail: memo vacío no rompe ni deja bloque huérfano", () => {
  const { html } = buildPostVisitaEmail({
    pacienteNombre: "Carlos Vega",
    profesionalNombre: "Consultorio Lorenzo",
    memoCorto: "",
  });
  assert.ok(html.includes("Carlos Vega"));
  assert.ok(!html.includes("indicaciones de hoy"));
});

test("buildPostVisitaEmail: escapa HTML en el memo", () => {
  const { html } = buildPostVisitaEmail({
    pacienteNombre: "Carlos Vega",
    profesionalNombre: "Consultorio Lorenzo",
    memoCorto: 'Ver <b>esto</b> & "aquello"',
  });
  assert.ok(!html.includes("<b>esto</b>"));
  assert.ok(html.includes("&lt;b&gt;esto&lt;/b&gt; &amp; &quot;aquello&quot;"));
});
