import assert from "node:assert/strict";
import test from "node:test";
import { AvailabilityDraft } from "../../lib/agenda/availability-draft";
const context = { organizationId: "org", memberId: "member", revision: 1, protectedDates: false };
const dias = { lun: { on: true, franjas: [["09:00", "12:00"]] }, mar: { on: false, franjas: [] }, mie: { on: false, franjas: [] }, jue: { on: false, franjas: [] }, vie: { on: false, franjas: [] }, sab: { on: false, franjas: [] }, dom: { on: false, franjas: [] } };
const changed = () => ({ ...structuredClone(dias), lun: { on: true, franjas: [["10:00", "13:00"]] } });
const make = () => new AvailabilityDraft({ context, dias } as never);
test("same-frame saves and transport retries preserve one frozen command", () => {
 const draft = make(); draft.edit(changed() as never); const first = draft.begin("a"); assert.ok(first); assert.equal(draft.begin("b"), null);
 draft.finish({ ok: false, error: { code: "db_error", message: "retry" } }); draft.edit(dias as never); assert.deepEqual(draft.begin("c"), first);
 draft.finish({ ok: true, data: { revision: 3, count: 1 } }); assert.equal(draft.dirty, false); assert.equal(draft.locked, false);
 draft.edit(dias as never); assert.equal(draft.begin("d")?.revision, 3);
});
test("stale and newer snapshots cannot silently erase the local draft", () => {
 const draft = make(); draft.edit(changed() as never); draft.receive({ context: { ...context, revision: 2 }, dias } as never);
 assert.equal(draft.conflict, true); assert.equal(draft.dias.lun.franjas[0][0], "10:00"); assert.equal(draft.begin("a"), null);
 draft.reload({ context: { ...context, revision: 2 }, dias } as never); assert.equal(draft.dirty, false); assert.equal(draft.context.revision, 2);
 draft.receive({ context, dias: changed() } as never); assert.equal(draft.context.revision, 2); assert.equal(draft.dias.lun.franjas[0][0], "09:00");
});
test("ACK cannot hide a subsequent save by another tab or org switch", () => {
 const draft = make(); draft.edit(changed() as never); draft.begin("a"); draft.receive({ context: { ...context, revision: 5 }, dias } as never);
 draft.finish({ ok: true, data: { revision: 3, count: 1 } }); assert.equal(draft.conflict, true); assert.equal(draft.begin("b"), null);
 draft.receive({ context: { ...context, organizationId: "other" }, dias } as never); assert.equal(draft.contextChanged, true); assert.equal(draft.reload({ context, dias } as never), false);
});
test("own refresh before ACK resolves, definite validation failures remain editable", () => {
 const draft = make(); draft.edit(changed() as never); draft.begin("a"); draft.receive({ context: { ...context, revision: 3 }, dias: changed() } as never);
 draft.finish({ ok: true, data: { revision: 3, count: 1 } }); assert.equal(draft.conflict, false); assert.equal(draft.locked, false);
 draft.edit(dias as never); draft.begin("b"); draft.finish({ ok: false, error: { code: "validation", message: "fix" } }); assert.equal(draft.locked, false); assert.equal(draft.dirty, true);
});
