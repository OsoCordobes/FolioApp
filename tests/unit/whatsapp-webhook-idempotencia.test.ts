/**
 * PR 4.1 · Idempotencia del webhook de WhatsApp — DOCUMENTA UN GAP CONOCIDO.
 *
 * ⚠️ HALLAZGO (backlog): el webhook de WhatsApp NO deduplica por wa message id.
 *
 * `app/api/whatsapp/webhook/route.ts` (POST) itera `value.messages` y por cada
 * mensaje de texto hace un `pedido`.insert INCONDICIONAL — no consulta si ese
 * `msg.id` (wamid, el identificador único que Meta asigna a cada mensaje) ya
 * fue procesado, y la tabla `pedido` (M09) NO tiene columna de wa message id ni
 * UNIQUE que lo frene (verificado en supabase/migrations/…_M09_…sql y
 * …_M18_whatsapp_…sql — M18 solo agrega `meta_message_id` a `recordatorio_job`
 * para el tracking OUTBOUND de status, no para dedupe inbound).
 *
 * Meta reenvía el webhook ante timeout / falta de ACK 200 (reintenta con
 * backoff). Una re-entrega del mismo mensaje entrante crea, HOY, un `pedido`
 * DUPLICADO — el profesional ve dos veces la misma solicitud en su bandeja.
 *
 * Este test NO afirma un ideal que el código no cumple: fija el comportamiento
 * REAL de hoy (dos inserts para el mismo wamid) para que sea visible y para que,
 * cuando se cierre el gap (agregar `pedido.wa_message_id` + UNIQUE, o un claim
 * tipo recordEmailOnce), este test tenga que actualizarse a propósito.
 *
 * NO se modifica código de producción — esto es un PR de tests.
 *
 * ── Sobre el modelado ──────────────────────────────────────────────────────
 * La lógica de inserción es inline en el route handler, con dependencias a
 * nivel de módulo que no se inyectan (createSupabaseServiceClient, encryptColumn,
 * resolveOrgByPhoneNumberId, notifyPedidoNuevo) y que `node:test` bajo tsx no
 * puede `mock.module`. Reproducimos fielmente el LOOP del route
 * (route.ts: `for (const msg of value.messages ?? [])` → filtro type/text →
 * insert de pedido) contra un mock stateful de `pedido`, para exponer que ese
 * loop no tiene ningún paso de dedupe. El modelo espeja el código real: si el
 * route cambiara para deduplicar, este modelo (y su aserción) deberían cambiar
 * con él.
 */

import assert from "node:assert/strict";
import test from "node:test";

// ── Tipos mínimos del payload de WhatsApp (subset de route.ts) ───────────────
interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "image" | "audio" | "video" | "document" | "interactive";
  text?: { body: string };
}

interface PedidoRow {
  id: string;
  organization_id: string;
  canal: string;
  estado: string;
  // Campos cifrados los representamos como texto plano en el mock (el cifrado
  // real es ortogonal a la idempotencia).
  nombre: string;
  telefono: string;
  motivo: string;
  // NOTA: no hay campo de wa message id — igual que la tabla real (M09).
}

/**
 * Mock stateful de la tabla `pedido`: cada `.insert()` agrega una fila. NO hay
 * UNIQUE ni pre-check por wa message id — refleja el esquema real de M09.
 */
function makePedidoTable() {
  const rows: PedidoRow[] = [];
  let seq = 0;
  return {
    rows,
    insert(row: Omit<PedidoRow, "id">) {
      const created = { id: `pedido-${++seq}`, ...row };
      rows.push(created);
      return created;
    },
  };
}

/**
 * Reducción fiel del loop de mensajes inbound del route (route.ts líneas ~110-168):
 * filtra a texto no vacío, resuelve nombre/teléfono/motivo e INSERTA un pedido —
 * sin ningún paso de deduplicación por `msg.id`. Devuelve la cantidad insertada.
 */
function processInboundMessages(
  table: ReturnType<typeof makePedidoTable>,
  org: { id: string },
  contacts: Array<{ profile: { name: string }; wa_id: string }>,
  messages: WhatsAppMessage[],
): number {
  let inserted = 0;
  for (const msg of messages) {
    // Mismo guard que el route: solo texto con body.
    if (msg.type !== "text" || !msg.text?.body) continue;

    const contact = contacts.find((c) => c.wa_id === msg.from);
    const nombre = contact?.profile?.name?.trim() || msg.from;
    const telefono = msg.from.startsWith("+") ? msg.from : `+${msg.from}`;
    const motivo = msg.text.body.slice(0, 2000);

    // ⚠️ Insert INCONDICIONAL — el route NO chequea msg.id contra nada.
    table.insert({
      organization_id: org.id,
      canal: "WHATSAPP",
      estado: "PENDIENTE",
      nombre,
      telefono,
      motivo,
    });
    inserted++;
  }
  return inserted;
}

const ORG = { id: "org-1" };
const CONTACTS = [{ profile: { name: "Lucía Paciente" }, wa_id: "5493515551234" }];

function textMessage(id: string, body = "Hola, quería un turno para el lunes"): WhatsAppMessage {
  return { from: "5493515551234", id, timestamp: "1750000000", type: "text", text: { body } };
}

// ── GAP: la misma re-entrega crea un pedido duplicado ────────────────────────

test("GAP CONOCIDO: el mismo wa message id procesado dos veces crea DOS pedidos (no hay dedupe inbound)", () => {
  const table = makePedidoTable();
  const msg = textMessage("wamid.SAME_ID_XYZ");

  // 1ra entrega del webhook.
  const first = processInboundMessages(table, ORG, CONTACTS, [msg]);
  // 2da entrega (Meta reenvía la MISMA notificación con el mismo wamid).
  const second = processInboundMessages(table, ORG, CONTACTS, [msg]);

  assert.equal(first, 1, "la 1ra entrega inserta el pedido");
  assert.equal(second, 1, "la 2da entrega vuelve a insertar (NO deduplica) — este es el gap");
  assert.equal(
    table.rows.length,
    2,
    "HOY quedan 2 pedidos para el MISMO wamid. Cuando se cierre el gap (pedido.wa_message_id UNIQUE / claim), esto debe ser 1.",
  );
  // Ambas filas describen exactamente la misma solicitud entrante.
  assert.equal(table.rows[0].motivo, table.rows[1].motivo);
  assert.equal(table.rows[0].telefono, table.rows[1].telefono);
});

test("no-texto (imagen/audio/interactive) se ignora en ambas entregas (no crea pedido)", () => {
  const table = makePedidoTable();
  const media: WhatsAppMessage = { from: "5493515551234", id: "wamid.IMG", timestamp: "1750000000", type: "image" };

  processInboundMessages(table, ORG, CONTACTS, [media]);
  processInboundMessages(table, ORG, CONTACTS, [media]);

  assert.equal(table.rows.length, 0, "solo los mensajes de texto generan pedido; el filtro sí es idempotente");
});

test("un batch con dos wamid DISTINTOS crea dos pedidos (comportamiento correcto — no es el gap)", () => {
  const table = makePedidoTable();
  processInboundMessages(table, ORG, CONTACTS, [
    textMessage("wamid.A", "turno lunes"),
    textMessage("wamid.B", "turno martes"),
  ]);
  assert.equal(table.rows.length, 2, "dos mensajes entrantes reales = dos pedidos (esperado)");
});
