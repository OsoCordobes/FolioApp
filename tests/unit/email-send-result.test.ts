/**
 * Folio · contrato honesto de envío de email (sendEmail → resultado
 * discriminado + matriz del dispatcher de recordatorios).
 *
 * Cubre:
 *   - decideMarcaEmailRecordatorio: matriz completa resultado → efecto en
 *     recordatorio_job (pura, sin DB).
 *   - sendEmail: sin RESEND_API_KEY devuelve 'simulated' (nunca lanza, nunca
 *     reporta 'sent' sin proveedor). El env se manipula DENTRO del test
 *     (delete + restore) — no depende de configuración externa.
 *
 * Los paths 'sent'/'failed' reales requieren el SDK de Resend con red — se
 * cubren acá vía la decisión pura, no ejercitando el SDK.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { decideMarcaEmailRecordatorio } from "../../lib/db/recordatorios";
import { sendEmail, type SendEmailResult } from "../../lib/email/client";

// ─── decideMarcaEmailRecordatorio: matriz completa ──────────────────────────

test("decideMarcaEmailRecordatorio: 'sent' → enviado_ts sin error_msg", () => {
  const marca = decideMarcaEmailRecordatorio({ status: "sent" });
  assert.equal(marca.marcarEnviado, true);
  assert.equal(marca.errorMsg, null);
});

test("decideMarcaEmailRecordatorio: 'simulated' → enviado_ts CON error_msg descriptivo", () => {
  const marca = decideMarcaEmailRecordatorio({
    status: "simulated",
    detail: "RESEND_API_KEY ausente",
  });
  // Se marca procesado: sin API key, reintentar quemaría los 5 intentos en
  // ruido (toda corrida posterior simularía igual).
  assert.equal(marca.marcarEnviado, true);
  // …pero la DB no miente: el error_msg deja constancia de que no se envió.
  assert.ok(marca.errorMsg);
  assert.match(marca.errorMsg, /envío simulado/);
  assert.match(marca.errorMsg, /RESEND_API_KEY/);
});

test("decideMarcaEmailRecordatorio: 'failed' → SIN enviado_ts + error real (reintenta)", () => {
  const marca = decideMarcaEmailRecordatorio({
    status: "failed",
    detail: "validation_error: dominio sin verificar",
  });
  assert.equal(marca.marcarEnviado, false);
  assert.ok(marca.errorMsg);
  assert.match(marca.errorMsg, /envío email falló/);
  assert.match(marca.errorMsg, /dominio sin verificar/);
});

test("decideMarcaEmailRecordatorio: solo el éxito real queda sin error_msg", () => {
  const casos: SendEmailResult[] = [
    { status: "sent" },
    { status: "simulated", detail: "RESEND_API_KEY ausente" },
    { status: "failed", detail: "boom" },
  ];
  for (const caso of casos) {
    const marca = decideMarcaEmailRecordatorio(caso);
    if (caso.status === "sent") {
      assert.equal(marca.errorMsg, null);
    } else {
      assert.ok(marca.errorMsg, `status=${caso.status} debe explicar qué pasó`);
    }
  }
});

// ─── sendEmail: contrato 'simulated' sin RESEND_API_KEY ─────────────────────

test("sendEmail: sin RESEND_API_KEY devuelve 'simulated' y no lanza", async () => {
  const original = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const resultado = await sendEmail({
      to: "paciente@example.com",
      subject: "Test",
      html: "<p>hola</p>",
    });
    assert.equal(resultado.status, "simulated");
    assert.ok(
      resultado.status === "simulated" && resultado.detail.includes("RESEND_API_KEY"),
      "el detail debe explicar la causa de la simulación",
    );
  } finally {
    if (original !== undefined) process.env.RESEND_API_KEY = original;
  }
});
