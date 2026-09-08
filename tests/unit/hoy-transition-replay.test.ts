import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { isTurnoStatePredecessor } from "../../lib/turno-states";

const requireActual = createRequire(import.meta.url);
type Element = { type: string; props: Record<string, unknown> };
function harness(transport: (input: { turnoId: string; to: string }) => Promise<{ ok: boolean; data?: { pagoRegistrado?: boolean }; error?: { message: string } }> = async () => ({ ok: true, data: {} })) {
  const slots: unknown[] = [];
  let cursor = 0;
  const pending: Promise<unknown>[] = [];
  const notices: unknown[] = [];
  let requests = 0;
  const fixture = { id: "synthetic-walk-in", pacienteId: "synthetic-patient", hora: "17:30", estado: "agendado", origen: "walk_in", precio: 30000, duracionMin: 30, postVisita: { guardada: false }, transiciones: [] };
  const exports: { Dashboard?: (props: unknown) => Element } = {};
  const effects: Array<() => void> = [];
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  runInNewContext(ts.transpileModule(readFileSync("components/hoy/dashboard.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, console, Date, require(name: string) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "react") return {
      useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (update: unknown) => {
        // React may replay updater functions. Calling server actions inside one
        // must never produce another request or notification.
        if (typeof update === "function") { update(slots[index]); slots[index] = update(slots[index]); }
        else slots[index] = update;
      }]; },
      useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
      useEffect(effect: () => void) { effects.push(effect); },
      useMemo(compute: () => unknown) { return compute(); },
      useTransition() { return [false, (work: () => Promise<unknown>) => { pending.push(work()); }]; },
    };
    if (name === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }) };
    if (name === "@/components/ui/toast") return { useToast: () => ({ show: (notice: unknown) => notices.push(notice) }) };
    if (name === "@/app/(app)/hoy/actions") return { transitionTurnoAction: async (input: { turnoId: string; to: string }) => { requests++; return transport(input); } };
    if (name === "@/lib/use-now") return { useNow: () => new Date("2026-09-08T12:00:00Z") };
    if (name === "@/lib/use-agenda-refresh") return { useAgendaAutoRefresh() {} };
    if (name === "@/lib/turno-states" || name === "@/lib/hoy/kpi-cobro") return requireActual(resolve(name.slice(2)));
    return new Proxy({}, { get: (_target, key) => String(key) });
  } });
  function find(node: unknown): Element | undefined {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    const element = node as Element;
    return element.type === "TurnoList" ? element : find(element.props?.children);
  }
  const render = (snapshot = [fixture]) => {
    cursor = 0;
    const tree = exports.Dashboard!({ initialTurnos: snapshot, pacientes: { "synthetic-patient": { nombre: "Paciente de prueba" } }, fechaIso: "2026-09-08", fechaLarga: "martes", nowIso: "2026-09-08T12:00:00Z", timezone: "America/Argentina/Cordoba" });
    effects.splice(0).forEach(effect => effect());
    return find(tree)!.props.onTransition as (id: string, to: string, extra?: Record<string, unknown>, cobro?: { montoCents: number; pagado: boolean }) => boolean;
  };
  const transition = render();
  return { transition, fixture, render, slots, notices, requests: () => requests, settle: () => Promise.allSettled(pending) };
}

test("one walk-in arrival sends one request and one notice even when state updaters replay", async () => {
  const view = harness();
  view.transition(view.fixture.id, "en_sala");
  await view.settle();
  assert.equal(view.requests(), 1);
  assert.equal(view.notices.length, 1);
});

test("a repeated click and a refresh while saving do not submit the same arrival again", async () => {
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const view = harness(async () => { await wait; return { ok: true, data: {} }; });
  view.transition(view.fixture.id, "en_sala");
  view.render()(view.fixture.id, "en_sala");
  view.transition(view.fixture.id, "en_sala");
  finish();
  await view.settle();
  assert.equal(view.requests(), 1);
  assert.equal(view.notices.length, 1);
});

test("a disconnected arrival shows a recoverable error and no saved notice", async () => {
  const view = harness(async () => { throw new Error("synthetic interrupted connection"); });
  view.transition(view.fixture.id, "en_sala");
  await view.settle();
  assert.equal((view.slots[0] as Array<{ estado: string }>)[0].estado, "agendado");
  assert.ok(view.slots.some(value => typeof value === "string" && value.includes("conexión")));
  assert.equal(view.notices.length, 0);
});

const current = (view: ReturnType<typeof harness>, id = view.fixture.id) =>
  (view.slots[0] as Array<{ id: string; estado: string; servicio?: string; cobro?: { montoCents?: number } }>).find(t => t.id === id)!;

for (const pagoRegistrado of [true, false]) {
  test(`a real payment in a refreshed closed appointment survives late payment result ${pagoRegistrado}`, async () => {
    let finish!: (value: { ok: boolean; data: { pagoRegistrado: boolean } }) => void;
    const view = harness(() => new Promise(resolve => { finish = resolve; }));
    view.render([{ ...view.fixture, estado: "atendiendo" }])(view.fixture.id, "cerrado");
    const authoritative = { ...view.fixture, estado: "cerrado", servicio: "Servicio actualizado", cobro: { estado: "pagado", montoCents: 1234567, ts: "2026-09-08T12:00:00Z" } };
    view.render([authoritative]);
    assert.equal(current(view).cobro?.montoCents, 1234567, "pending optimism must not hide a real payment");
    assert.equal(current(view).servicio, authoritative.servicio);
    finish({ ok: true, data: { pagoRegistrado } });
    await view.settle();
    assert.equal(current(view).cobro?.montoCents, 1234567);
  });
}

test("a paid SSR row does not produce a debt-created toast from a late close request", async () => {
  let finish!: (value: { ok: boolean; data: { pagoRegistrado: boolean } }) => void;
  const view = harness(() => new Promise(resolve => { finish = resolve; }));
  view.render([{ ...view.fixture, estado: "atendiendo" }])(view.fixture.id, "cerrado", {}, { montoCents: 3000000, pagado: false });
  view.render([{ ...view.fixture, estado: "cerrado", cobro: { estado: "pagado", montoCents: 1234567, ts: null } } as typeof view.fixture]);
  finish({ ok: true, data: { pagoRegistrado: true } });
  await view.settle();
  assert.equal(view.notices.length, 1);
  assert.ok(!(view.notices[0] as { titulo: string }).titulo.includes("deuda registrada"));
});

test("a pending transition explicitly rejects a successor so its caller cannot navigate as if started", async () => {
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const view = harness(async () => { await wait; return { ok: true, data: {} }; });
  assert.equal(view.transition(view.fixture.id, "en_sala"), true);
  assert.equal(view.transition(view.fixture.id, "atendiendo"), false);
  assert.equal(view.requests(), 1);
  finish();
  await view.settle();
  assert.equal(view.transition(view.fixture.id, "atendiendo"), true);
  await view.settle();
  assert.equal(view.requests(), 2);
});

test("a predecessor SSR snapshot keeps updated metadata and real payment while close is pending and after ACK", async () => {
  let finish!: (value: { ok: boolean; data: { pagoRegistrado: boolean } }) => void;
  const view = harness(() => new Promise(resolve => { finish = resolve; }));
  view.render([{ ...view.fixture, estado: "atendiendo" }])(view.fixture.id, "cerrado");
  const refreshed = { ...view.fixture, estado: "atendiendo", servicio: "Cambio del servidor", cobro: { estado: "pagado", montoCents: 765432, ts: null } };
  view.render([refreshed]);
  assert.equal(current(view).estado, "cerrado");
  assert.equal(current(view).servicio, refreshed.servicio);
  assert.equal(current(view).cobro?.montoCents, 765432);
  finish({ ok: true, data: { pagoRegistrado: true } });
  await view.settle();
  assert.equal(current(view).servicio, refreshed.servicio);
  assert.equal(current(view).cobro?.montoCents, 765432);
});

test("arrival ACK survives stale refresh even after a matching snapshot and still allows the next steps", async () => {
  const view = harness();
  view.transition(view.fixture.id, "en_sala");
  await view.settle();
  view.render();
  assert.equal(current(view).estado, "en_sala");
  view.render([{ ...view.fixture, estado: "en_sala" }]);
  view.render();
  assert.equal(current(view).estado, "en_sala");
  view.transition(view.fixture.id, "atendiendo");
  await view.settle();
  view.render([{ ...view.fixture, estado: "en_sala" }]);
  assert.equal(current(view).estado, "atendiendo");
  view.transition(view.fixture.id, "cerrado");
  await view.settle();
  view.render();
  assert.equal(current(view).estado, "cerrado");
  assert.equal(view.requests(), 3);
  assert.equal(view.notices.length, 2);
});

test("equal-state refresh updates data and a valid server cancellation remains visible", async () => {
  const view = harness();
  view.transition(view.fixture.id, "en_sala");
  await view.settle();
  const same = { ...view.fixture, estado: "en_sala", servicio: "Consulta actualizada" };
  view.render([same]);
  assert.equal(current(view).servicio, same.servicio);
  view.render([{ ...same, estado: "cancelado" }]);
  assert.equal(current(view).estado, "cancelado");
  view.render([same]);
  assert.equal(current(view).estado, "cancelado");
});

test("concurrent appointments settle independently and failures do not leave a false confirmation", async () => {
  const finish = new Map<string, (value: { ok: boolean; data?: Record<string, never>; error?: { message: string } }) => void>();
  const view = harness(input => new Promise(resolve => finish.set(input.turnoId, resolve)));
  const second = { ...view.fixture, id: "other-turno" };
  view.render([view.fixture, second])(view.fixture.id, "en_sala");
  view.transition(second.id, "en_sala");
  assert.equal(view.requests(), 2);
  finish.get(view.fixture.id)!({ ok: true, data: {} });
  finish.get(second.id)!({ ok: false, error: { message: "Conflicto sintético" } });
  await view.settle();
  view.render([view.fixture, second]);
  assert.equal(current(view).estado, "en_sala");
  assert.equal(current(view, second.id).estado, "agendado");
  assert.equal(view.notices.length, 1);
});

for (const success of [true, false]) {
  test(`server cancellation observed while arrival is pending survives ${success ? "late ACK" : "transport rejection"}`, async () => {
    let finish!: (value: { ok: boolean; data: Record<string, never> }) => void;
    let reject!: (error: Error) => void;
    const view = harness(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
    view.transition(view.fixture.id, "en_sala");
    view.render([{ ...view.fixture, estado: "cancelado" }]);
    assert.equal(current(view).estado, "cancelado");
    if (success) finish({ ok: true, data: {} }); else reject(new Error("synthetic disconnected response"));
    await view.settle();
    assert.equal(current(view).estado, "cancelado");
  });
}

test("state ordering follows reachability, not an arbitrary rank of terminal states", () => {
  assert.equal(isTurnoStatePredecessor("agendado", "cerrado"), true);
  assert.equal(isTurnoStatePredecessor("confirmado", "atendiendo"), true);
  assert.equal(isTurnoStatePredecessor("en_sala", "cancelado"), true);
  assert.equal(isTurnoStatePredecessor("no_asistio", "reagendado"), true);
  assert.equal(isTurnoStatePredecessor("cancelado", "cerrado"), false);
  assert.equal(isTurnoStatePredecessor("cerrado", "cancelado"), false);
  assert.equal(isTurnoStatePredecessor("en_sala", "en_sala"), false);
});
