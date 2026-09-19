import assert from "node:assert/strict";
import test from "node:test";
import type * as Adapter from "../../lib/db/turno-close";
import type * as Actions from "../../app/(app)/hoy/actions";
import type * as Turnos from "../../lib/db/turnos";
import { closeHarness, ids, payment, receipt, status, type HarnessOptions } from "../fixtures/close-action-harness";

const request = { turnoId: ids.turno, operacionId: ids.operation };
function fixture(options: HarnessOptions = {}) {
  const h = closeHarness(options);
  return { ...h, adapter: h.load("lib/db/turno-close.ts") as typeof Adapter,
    actions: h.load("app/(app)/hoy/actions.ts") as typeof Actions,
    turnos: h.load("lib/db/turnos.ts") as typeof Turnos };
}
test("actual agenda close uses one POST RPC and full receipt, without REST/payment/job side effects", async () => {
  const f = fixture({ cacheThrows: true });
  const r = await f.actions.transitionTurnoAction({ ...request, to: "cerrado", duracionRealMin: 25 });
  assert.equal(r.ok, true); if (r.ok) { assert.equal(r.data.cierre?.operationId, ids.operation); assert.equal(r.data.pagoRegistrado, false); }
  assert.equal(f.rpcCalls.length, 1); assert.equal(f.rpcCalls[0].name, "close_turno_atomic");
  assert.equal(f.rpcCalls[0].args.p_org, ids.org); assert.equal(f.rpcCalls[0].args.p_duracion, 25);
  assert.equal(f.rpcCalls[0].args.p_decision, null); assert.equal(f.rpcCalls[0].options, undefined);
  assert.equal(f.updates.length, 0); assert.equal(f.after.length, 0); assert.ok(f.cached.includes("/finanzas"));
});
for (const input of [{ ...request, operacionId: undefined }, { ...request, duracionRealMin: 481 },
  { ...request, cobro: { montoCents: -1 } }, { ...request, cobro: { montoCents: 10, metodo: "EFECTIVO", pagado: "false" } },
  { ...request, cobro: { montoCents: 2147483648, metodo: "EFECTIVO", pagado: true } }, { ...request, organizationId: ids.other }]) {
  test(`invalid close input rejected before RPC: ${JSON.stringify(input)}`, async () => {
    const f = fixture(); const r = await f.adapter.closeTurnoAtomic(input as AdapterInput);
    assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.mutationOutcome, "rejected"); assert.equal(f.rpcCalls.length, 0);
  });
}
type AdapterInput = Parameters<typeof Adapter.closeTurnoAtomic>[0];
test("missing operation on transition also cannot reach legacy REST", async () => {
  const f = fixture(); const r = await f.turnos.transitionTurno({ turnoId: ids.turno, to: "CERRADO" });
  assert.equal(r.ok, false); assert.equal(f.rpcCalls.length + f.updates.length, 0);
});
test("zero normalizes to the exact no-charge decision", async () => {
  const f = fixture({ response: { data: { ...receipt, clasificacion: "SIN_CARGO", pagoOrigen: "SIN_CARGO" }, error: null } });
  const r = await f.adapter.closeTurnoAtomic({ ...request, cobro: { montoCents: 0, metodo: "EFECTIVO", pagado: true } });
  assert.equal(r.ok, true); assert.equal(JSON.stringify(f.rpcCalls[0].args.p_decision), '{"montoCents":0}');
});
for (const pagado of [true, false]) test(`positive decision preserves actual payment (${pagado})`, async () => {
  const pago = { ...payment, estado: pagado ? "PAGADO" : "PENDIENTE", pagadoTs: pagado ? payment.pagadoTs : null };
  const f = fixture({ response: { data: { ...receipt, clasificacion: "REGISTRADO", pago, pagoOrigen: "CREADO" }, error: null } });
  const r = await f.adapter.closeTurnoAtomic({ ...request, cobro: { montoCents: 12500, metodo: "EFECTIVO", pagado } });
  assert.equal(r.ok, true); if (r.ok) assert.equal(r.data.pago?.updatedAt, payment.updatedAt);
  assert.equal((f.rpcCalls[0].args.p_decision as {pagado:boolean}).pagado, pagado);
});
for (const changes of [{ turnoId: ids.other }, { operationId: ids.other }, { estado: "ATENDIENDO" }, { closedAt: null },
  { closedAt: "yesterday" }, { clasificacion: "SIN_CARGO", pago: payment }, { clasificacion: "REGISTRADO" }, { pagoOrigen: "CREADO" },
  { pago: { ...payment, updatedAt: null } }]) test(`contradictory receipt stays uncertain: ${JSON.stringify(changes)}`, async () => {
  const f = fixture({ response: { data: { ...receipt, ...changes }, error: null } });
  const r = await f.adapter.closeTurnoAtomic(request); assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.mutationOutcome, "uncertain"); assert.equal(f.rpcCalls.length, 1);
});
test("positive response cannot confirm a different amount, method or payment state", async () => {
  for (const pago of [payment, { ...payment, montoCents: 100 }, { ...payment, metodo: "OTRO" }]) {
    const f = fixture({ response: { data: { ...receipt, pago, clasificacion: "REGISTRADO", pagoOrigen: "CREADO" }, error: null } });
    const r = await f.adapter.closeTurnoAtomic({ ...request, cobro: { montoCents: 12500, metodo: "EFECTIVO", pagado: false } });
    assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.mutationOutcome, "uncertain");
  }
});
for (const [code, outcome] of [["42501", "rejected"], ["40001", "rejected"], ["22023", "rejected"], ["55000", "review_required"], ["PGRST202", "review_required"], ["UNKNOWN", "uncertain"], [undefined, "uncertain"]]) test(`SQL disposition ${code}`, async () => {
  const f = fixture({ response: { data: null, error: { code, message: "private SQL: violates row-level security" } } });
  const r = await f.adapter.closeTurnoAtomic(request); assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.error.mutationOutcome, outcome); assert.doesNotMatch(JSON.stringify(r), /private SQL/); }
  assert.equal(f.rpcCalls.length, 1);
});
test("transport failure never triggers another close", async () => {
  const f = fixture({ rpcThrows: true }); const r = await f.adapter.closeTurnoAtomic(request);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.mutationOutcome, "uncertain"); assert.equal(f.rpcCalls.length, 1);
});
test("null receipt is a POST probe, without write/cache or a claim of rollback", async () => {
  const f = fixture({ response: { data: null, error: null } });
  const r = await f.actions.getTurnoCloseReceiptAction({ ...request, action: "CLOSE", duracionRealMin: 0 });
  assert.equal(r.ok, true); if (r.ok) assert.equal(r.data, null);
  assert.equal(f.rpcCalls[0].name, "get_turno_close_receipt"); assert.equal(f.rpcCalls[0].args.p_action, "CLOSE");
  assert.equal(f.rpcCalls[0].args.p_duracion, 0); assert.equal(f.rpcCalls[0].options, undefined); assert.equal(f.cached.length + f.updates.length, 0);
});
test("resolve historical close preserves unknown time and never sends duration", async () => {
  const f = fixture({ response: { data: { ...receipt, origen: "HISTORICO", closedAt: null, clasificacion: "SIN_CARGO", pagoOrigen: "SIN_CARGO" }, error: null } });
  const r = await f.actions.resolveTurnoCloseAction({ ...request, cobro: { montoCents: 0 } });
  assert.equal(r.ok, true); assert.equal(f.rpcCalls[0].name, "resolve_turno_close"); assert.equal("p_duracion" in f.rpcCalls[0].args, false);
});
test("resolve and its probe reject missing decision or added duration", async () => {
  for (const input of [request, { ...request, cobro: { montoCents: 0 }, duracionRealMin: 2 }]) {
    const f = fixture(); const r = await f.adapter.resolveTurnoClose(input as Parameters<typeof Adapter.resolveTurnoClose>[0]);
    assert.equal(r.ok, false); assert.equal(f.rpcCalls.length, 0);
  }
});
test("coordinator recorded-but-redacted is valid status, never missing registration", async () => {
  const f = fixture({ role: "COORDINADOR", response: { data: { ...status, clasificacion: "REGISTRADO", puedeRegistrar: false }, error: null } });
  const r = await f.actions.getTurnoCloseStatusAction(ids.turno); assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.data.clasificacion, "REGISTRADO"); assert.equal(r.data.pago, null); }
  assert.equal(f.cached.length, 0); assert.equal(f.rpcCalls[0].options, undefined);
});
test("coordinator existing-payment close receipt stays redacted", async () => {
  const f = fixture({ role: "COORDINADOR", response: { data: { ...receipt, clasificacion: "REGISTRADO", puedeRegistrar: false, pagoOrigen: "EXISTENTE" }, error: null } });
  assert.equal((await f.adapter.closeTurnoAtomic(request)).ok, true);
});
test("receipt created before role promotion may legitimately retain original redaction", async () => {
  const f = fixture({ role: "OWNER", response: { data: { ...receipt, clasificacion: "REGISTRADO", puedeRegistrar: false, pagoOrigen: "EXISTENTE" }, error: null } });
  assert.equal((await f.adapter.getTurnoCloseReceipt({ ...request, action: "CLOSE" })).ok, true);
});
test("coordinator cannot receive an unredacted financial receipt", async () => {
  const f = fixture({ role: "COORDINADOR", response: { data: { ...receipt, pago: payment, clasificacion: "REGISTRADO", pagoOrigen: "EXISTENTE" }, error: null } });
  assert.equal((await f.adapter.closeTurnoAtomic(request)).ok, false);
});
test("ordinary transition preserves REST zero-row failure and cancellation hooks", async () => {
  const empty = fixture({ updateRows: [] }); assert.equal((await empty.turnos.transitionTurno({ turnoId: ids.turno, to: "CONFIRMADO" })).ok, false);
  const f = fixture(); assert.equal((await f.turnos.transitionTurno({ turnoId: ids.turno, to: "CANCELADO" })).ok, true);
  assert.equal(f.updates.length, 1); assert.equal(f.rpcCalls.length, 0); assert.equal(f.after.length, 2);
});
test("status validates identity and permits actual nonclosed and historical states", async () => {
  for (const data of [{ ...status, estado: "ATENDIENDO", origen: null, closedAt: null, clasificacion: null },
    { ...status, origen: "HISTORICO", closedAt: null },
    { ...status, estado: "ATENDIENDO", origen: null, closedAt: null, clasificacion: "REGISTRADO", pago: payment }]) {
    const f = fixture({ response: { data, error: null } }); assert.equal((await f.adapter.getTurnoCloseStatus(ids.turno)).ok, true);
  }
  const f = fixture({ response: { data: { ...status, turnoId: ids.other }, error: null } });
  assert.equal((await f.adapter.getTurnoCloseStatus(ids.turno)).ok, false);
});
test("UUID canonicalization does not misidentify a valid receipt", async () => {
  const turno = "aaaaaaaa-0000-4000-8000-000000000001", operation = "bbbbbbbb-0000-4000-8000-000000000002";
  const f = fixture({ response: { data: { ...receipt, turnoId: turno, operationId: operation }, error: null } });
  assert.equal((await f.adapter.closeTurnoAtomic({ turnoId: turno.toUpperCase(), operacionId: operation.toUpperCase() })).ok, true);
});
