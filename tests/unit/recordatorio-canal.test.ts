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

// ─── Nivel de comunicación (auditoría portal-comms): preheader + header + CTA ──

test("buildConfirmacion24hEmail: preheader oculto 'Tu turno del {fecha} a las {hora} en {consultorio}'", () => {
  const { html } = buildConfirmacion24hEmail(confirmacionBase);
  const preheader = `Tu turno del ${confirmacionBase.fecha} a las ${confirmacionBase.hora} en ${confirmacionBase.consultorioNombre}`;
  assert.ok(html.includes(preheader));
  assert.ok(html.includes("display:none;max-height:0"));
  // El preview del inbox lee lo primero del body: el preheader va ANTES de "Hola".
  assert.ok(html.indexOf(preheader) < html.indexOf("Hola Carlos Vega"));
});

test("buildConfirmacion24hEmail: header con nombre del consultorio y CTA al portal", () => {
  const { html } = buildConfirmacion24hEmail({
    ...confirmacionBase,
    portalUrl: "https://folio.example/portal",
  });
  assert.ok(html.includes(`Recordatorio de turno · ${confirmacionBase.consultorioNombre}`));
  assert.ok(html.includes("Gestionar mi turno"));
  assert.ok(html.includes('href="https://folio.example/portal"'));
});

test("buildConfirmacion24hEmail: sin portalUrl inyectado el CTA cae a {APP_URL}/portal", () => {
  // El dispatcher no pasa portalUrl: el default sale de getAppUrl() (que
  // nunca lanza) + /portal. En el runtime de tests no hay envs de Vercel,
  // así que basta con assertear el sufijo /portal en el href del CTA.
  const { html } = buildConfirmacion24hEmail(confirmacionBase);
  assert.ok(html.includes("Gestionar mi turno"));
  assert.ok(/href="[^"]+\/portal"/.test(html));
});

test("buildConfirmacion24hEmail: telefonoPublico entra al copy de contacto", () => {
  const { html } = buildConfirmacion24hEmail({
    ...confirmacionBase,
    telefonoPublico: "351 555-0000",
  });
  assert.ok(html.includes("contactá al consultorio al 351 555-0000"));
  // Sin teléfono, copy genérico (input base no lo trae).
  const sinTel = buildConfirmacion24hEmail(confirmacionBase).html;
  assert.ok(sinTel.includes("contactá al consultorio."));
});

test("buildRecordatorio2hEmail: preheader, header con consultorio y CTA al portal", () => {
  const { html } = buildRecordatorio2hEmail({
    pacienteNombre: "Carlos Vega",
    consultorioNombre: "Consultorio Lorenzo",
    hora: "10:00",
    portalUrl: "https://folio.example/portal",
  });
  assert.ok(html.includes("Tu turno de hoy a las 10:00 hs en Consultorio Lorenzo"));
  assert.ok(html.includes("Tu turno es hoy · Consultorio Lorenzo"));
  assert.ok(html.includes("Gestionar mi turno"));
  assert.ok(html.includes('href="https://folio.example/portal"'));
});

test("buildPostVisitaEmail: preheader oculto con el resumen de la visita", () => {
  const conMemo = buildPostVisitaEmail({
    pacienteNombre: "Carlos Vega",
    profesionalNombre: "Consultorio Lorenzo",
    memoCorto: "Frío 10 min.",
  }).html;
  assert.ok(conMemo.includes("Indicaciones de tu visita a Consultorio Lorenzo"));
  const sinMemo = buildPostVisitaEmail({
    pacienteNombre: "Carlos Vega",
    profesionalNombre: "Consultorio Lorenzo",
    memoCorto: "",
  }).html;
  assert.ok(sinMemo.includes("Gracias por tu visita a Consultorio Lorenzo"));
});

// ─── F7b · CTAs 1-click del email de 24h (con y sin tokens) ─────────────────

const CONFIRMAR_URL = "https://folio.example/t/token-confirmar";
const CANCELAR_URL = "https://folio.example/t/token-cancelar";

test("F7b · con confirmarUrl+cancelarUrl: CTA primario 'Confirmo mi turno' + link 'No puedo ir'", () => {
  const { html } = buildConfirmacion24hEmail({
    ...confirmacionBase,
    confirmarUrl: CONFIRMAR_URL,
    cancelarUrl: CANCELAR_URL,
  });
  assert.ok(html.includes("Confirmo mi turno"));
  assert.ok(html.includes(`href="${CONFIRMAR_URL}"`));
  assert.ok(html.includes("No puedo ir"));
  assert.ok(html.includes(`href="${CANCELAR_URL}"`));
  // El CTA al portal se reemplaza (no conviven dos botones primarios).
  assert.ok(!html.includes("Gestionar mi turno"));
  // El botón primario va ANTES del link secundario de cancelación.
  assert.ok(html.indexOf(CONFIRMAR_URL) < html.indexOf(CANCELAR_URL));
});

test("F7b · con confirmarUrl sin cancelarUrl: botón sí, link 'No puedo ir' no", () => {
  const { html } = buildConfirmacion24hEmail({
    ...confirmacionBase,
    confirmarUrl: CONFIRMAR_URL,
    cancelarUrl: null,
  });
  assert.ok(html.includes("Confirmo mi turno"));
  assert.ok(!html.includes("No puedo ir"));
});

test("F7b · SIN tokens el email sale como hoy (compat: CTA al portal)", () => {
  const sinTokens = buildConfirmacion24hEmail(confirmacionBase).html;
  const nulos = buildConfirmacion24hEmail({
    ...confirmacionBase,
    confirmarUrl: null,
    cancelarUrl: null,
  }).html;
  // undefined y null se comportan idéntico (el dispatcher pasa null si la
  // firma falla) y el output es el histórico.
  assert.equal(sinTokens, nulos);
  assert.ok(sinTokens.includes("Gestionar mi turno"));
  assert.ok(!sinTokens.includes("Confirmo mi turno"));
  assert.ok(!sinTokens.includes("No puedo ir"));
});

test("F7b · las URLs de los CTAs se escapan como atributo HTML", () => {
  const { html } = buildConfirmacion24hEmail({
    ...confirmacionBase,
    confirmarUrl: "https://folio.example/t/abc?a=1&b=2",
    cancelarUrl: 'https://folio.example/t/x"onmouseover="alert(1)',
  });
  assert.ok(html.includes("https://folio.example/t/abc?a=1&amp;b=2"));
  assert.ok(!html.includes('x"onmouseover='));
  assert.ok(html.includes("x&quot;onmouseover="));
});
