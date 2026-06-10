/**
 * Compliance (Ley 26.529 art. 18 — rastro de auditoría completo): toda fila de
 * audit_log debe poder llevar ip + user_agent (DESDE DÓNDE se hizo la acción).
 * Las columnas existen desde M12 (`ip inet`, `user_agent text`) pero antes el
 * writer no las poblaba. Estos tests fijan el contrato del builder PURO: si
 * alguien vuelve a dropear ip/user_agent del INSERT, acá se nota — sin tener
 * que mockear Supabase ni los headers de Next.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildAuditInsertRow, normalizeAuditIp } from "../../lib/db/audit";

const base = {
  organizationId: "org-1",
  actorId: "actor-1",
  action: "member_invitation.create",
  resourceType: "member_invitation",
  resourceId: "inv-1",
} as const;

test("ip/user_agent del input mandan sobre el contexto de la request", () => {
  const row = buildAuditInsertRow(
    { ...base, ip: "203.0.113.5", userAgent: "Mozilla/5.0 (caller)" },
    { ip: "10.0.0.1", userAgent: "header-ua" },
  );
  assert.equal(row.ip, "203.0.113.5");
  assert.equal(row.user_agent, "Mozilla/5.0 (caller)");
  // y el resto de las columnas se preservan
  assert.equal(row.organization_id, "org-1");
  assert.equal(row.actor_id, "actor-1");
  assert.equal(row.actor_role, null);
  assert.equal(row.action, "member_invitation.create");
  assert.equal(row.resource_type, "member_invitation");
  assert.equal(row.resource_id, "inv-1");
  assert.equal(row.payload, null);
});

test("sin ip/user_agent explícito, cae al contexto de la request (headers)", () => {
  const row = buildAuditInsertRow(base, { ip: "198.51.100.7", userAgent: "header-ua" });
  assert.equal(row.ip, "198.51.100.7");
  assert.equal(row.user_agent, "header-ua");
});

test("x-forwarded-for: toma el primer hop (el cliente real), no la cadena de proxies", () => {
  const row = buildAuditInsertRow(base, {
    ip: "203.0.113.9, 70.41.3.18, 150.172.238.178",
    userAgent: null,
  });
  assert.equal(row.ip, "203.0.113.9");
});

test("ip vacío o ausente → null (un INSERT de '' en inet falla con 22P02)", () => {
  assert.equal(buildAuditInsertRow(base, { ip: "", userAgent: null }).ip, null);
  assert.equal(buildAuditInsertRow(base, { ip: "   ", userAgent: null }).ip, null);
  assert.equal(buildAuditInsertRow(base, { ip: null, userAgent: null }).ip, null);
  assert.equal(buildAuditInsertRow({ ...base, ip: undefined }).ip, null);
});

test("user_agent vacío o solo espacios → null", () => {
  assert.equal(buildAuditInsertRow(base, { ip: null, userAgent: "" }).user_agent, null);
  assert.equal(buildAuditInsertRow(base, { ip: null, userAgent: "   " }).user_agent, null);
  assert.equal(buildAuditInsertRow(base).user_agent, null);
});

test("normalizeAuditIp: contrato de normalización", () => {
  assert.equal(normalizeAuditIp("203.0.113.5"), "203.0.113.5");
  assert.equal(normalizeAuditIp("203.0.113.5, 10.0.0.1"), "203.0.113.5");
  assert.equal(normalizeAuditIp(" 203.0.113.5 "), "203.0.113.5");
  assert.equal(normalizeAuditIp(""), null);
  assert.equal(normalizeAuditIp(null), null);
  assert.equal(normalizeAuditIp(undefined), null);
});

test("actorRole snapshot se preserva cuando viene", () => {
  const row = buildAuditInsertRow(
    { ...base, actorRole: "OWNER", ip: "203.0.113.5", userAgent: "ua" },
  );
  assert.equal(row.actor_role, "OWNER");
});
