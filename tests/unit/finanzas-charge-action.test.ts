import assert from "node:assert/strict";
import test from "node:test";
import type * as Finance from "../../app/(app)/finanzas/actions";
import type * as Agenda from "../../app/(app)/hoy/actions";
import { binding, closeHarness, ids, payment, type HarnessOptions } from "../fixtures/close-action-harness";

const settled = { turnoId: ids.turno, alreadyPaid: false, pago: payment };
function scenario(options: HarnessOptions = {}) {
  const h = closeHarness({ response: { data: settled, error: null }, ...options });
  return { ...h, finance: h.load("app/(app)/finanzas/actions.ts") as typeof Finance,
    agenda: h.load("app/(app)/hoy/actions.ts") as typeof Agenda };
}
test("empty settlement response cannot announce collection (former zero-row regression)", async () => {
  for (const data of [null, [], {}, { ...settled, pago: { ...payment, estado: "PENDIENTE", pagadoTs: null } }]) {
    const f = scenario({ response: { data, error: null } }); const r = await f.finance.marcarPagoCobradoAction(ids.pago);
    assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.mutationOutcome, "uncertain");
    assert.equal(f.cached.length, 0); assert.equal(f.rpcCalls.length, 1); assert.equal(f.updates.length, 0);
  }
});
test("finance wrapper preserves both capability gates and requires a valid identity/session", async () => {
  for (const options of [{ role: "COORDINADOR" as const }, { role: "ASISTENTE" as const }, { sessionError: true }]) {
    const f = scenario(options); assert.equal((await f.finance.marcarPagoCobradoAction(ids.pago)).ok, false);
    assert.equal(f.reads.length + f.rpcCalls.length, 0);
  }
  const f = scenario(); assert.equal((await f.finance.marcarPagoCobradoAction("invalid")).ok, false); assert.equal(f.reads.length + f.rpcCalls.length, 0);
});
test("absent, unjoined, wrong organization or professional payment never reaches settlement", async () => {
  for (const row of [null, { ...binding, turno: null }, { ...binding, turno: { ...binding.turno, organization_id: ids.other } },
    { ...binding, turno: { ...binding.turno, profesional_id: ids.other } }, { ...binding, id: ids.other }]) {
    const f = scenario({ binding: row }); assert.equal((await f.finance.marcarPagoCobradoAction(ids.pago)).ok, false);
    assert.equal(f.rpcCalls.length, 0); assert.equal(f.cached.length, 0);
  }
});
for (const role of ["OWNER", "DIRECTOR", "PROFESIONAL"] as const) test(`${role} finance settlement returns the actual M121 payment`, async () => {
  const f = scenario({ role, cacheThrows: true, binding: { ...binding, turno: { ...binding.turno, profesional_id: role === "PROFESIONAL" ? ids.member : ids.other } } });
  const r = await f.finance.marcarPagoCobradoAction(ids.pago); assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.data.pago.id, ids.pago); assert.equal(r.data.pago.updatedAt, payment.updatedAt); assert.equal(r.data.pago.pagadoTs, payment.pagadoTs); }
  assert.equal(f.rpcCalls.length, 1); assert.equal(f.rpcCalls[0].name, "settle_pago_atomic");
  assert.equal(JSON.stringify(f.rpcCalls[0].args), JSON.stringify({ p_org: ids.org, p_turno: ids.turno, p_pago: ids.pago }));
  assert.equal(f.updates.length, 0); assert.ok(f.cached.includes("/hoy"));
});
test("already paid or concurrently settled uses RPC and preserves stored timestamp", async () => {
  const f = scenario({ response: { data: { ...settled, alreadyPaid: true }, error: null } });
  const r = await f.finance.marcarPagoCobradoAction(ids.pago); assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.data.alreadyPaid, true); assert.equal(r.data.pago.pagadoTs, payment.pagadoTs); assert.equal(r.data.pago.updatedAt, payment.updatedAt); }
  assert.equal(f.rpcCalls.length, 1); assert.equal(f.updates.length, 0);
});
test("authorization revoked after preflight read is rejected by M121 without fallback", async () => {
  const f = scenario({ response: { data: null, error: { code: "42501", message: "synthetic revoked authority" } } });
  const r = await f.finance.marcarPagoCobradoAction(ids.pago); assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.error.code, "forbidden"); assert.equal(r.error.mutationOutcome, "rejected"); }
  assert.equal(f.reads.length, 1); assert.equal(f.rpcCalls.length, 1); assert.equal(f.updates.length + f.cached.length, 0);
});
test("payment read error cannot initiate collection", async () => {
  const f = scenario({ readError: { code: "42501" } }); assert.equal((await f.finance.marcarPagoCobradoAction(ids.pago)).ok, false); assert.equal(f.rpcCalls.length, 0);
});
test("lost settlement response preserves uncertainty and never retries automatically", async () => {
  const f = scenario({ rpcThrows: true }); const r = await f.finance.marcarPagoCobradoAction(ids.pago);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.mutationOutcome, "uncertain");
  assert.equal(f.rpcCalls.length, 1); assert.equal(f.cached.length + f.updates.length, 0);
});
test("assistant settles from its closed agenda without gaining finance access", async () => {
  const f = scenario({ role: "ASISTENTE" }); assert.equal((await f.agenda.marcarPagoCobradoAgendaAction({ turnoId: ids.turno, pagoId: ids.pago })).ok, true);
  assert.equal(f.rpcCalls[0].name, "settle_pago_atomic");
  assert.equal((await f.finance.marcarPagoCobradoAction(ids.pago)).ok, false); assert.equal(f.rpcCalls.length, 1);
});
test("agenda settlement rejects coordinator, wrong turno/payment, other professional and open visit", async () => {
  for (const options of [{ role: "COORDINADOR" as const }, { binding: { ...binding, turno_id: ids.other } }, { binding: { ...binding, id: ids.other } },
    { binding: { ...binding, turno: { ...binding.turno, profesional_id: ids.other } } },
    { role: "OWNER" as const, binding: { ...binding, turno: { ...binding.turno, estado: "ATENDIENDO" } } }]) {
    const f = scenario(options); assert.equal((await f.agenda.marcarPagoCobradoAgendaAction({ turnoId: ids.turno, pagoId: ids.pago })).ok, false); assert.equal(f.rpcCalls.length, 0);
  }
});
test("agenda cannot omit requested turno or recover revoked reception scope through fallback", async () => {
  const f = scenario({ role: "ASISTENTE", response: { data: null, error: { code: "42501" } } });
  assert.equal((await f.agenda.marcarPagoCobradoAgendaAction({ pagoId: ids.pago } as {turnoId:string;pagoId:string})).ok, false); assert.equal(f.rpcCalls.length, 0);
  const r = await f.agenda.marcarPagoCobradoAgendaAction({ pagoId: ids.pago, turnoId: ids.turno });
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.mutationOutcome, "rejected"); assert.equal(f.rpcCalls.length, 1); assert.equal(f.updates.length, 0);
});
test("settlement receipt must bind both identities and real timestamp", async () => {
  for (const data of [{ ...settled, turnoId: ids.other }, { ...settled, pago: { ...payment, id: ids.other } },
    { ...settled, pago: { ...payment, updatedAt: null } }, { ...settled, pago: { ...payment, pagadoTs: null } }]) {
    const f = scenario({ response: { data, error: null } }); const r = await f.finance.marcarPagoCobradoAction(ids.pago);
    assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.mutationOutcome, "uncertain");
  }
});
