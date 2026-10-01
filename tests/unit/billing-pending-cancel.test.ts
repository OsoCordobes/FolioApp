import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Same actual-component/hook harness pattern as finanzas-table.test.ts.
// Replace framework/actions only: no real imports of DB or payment providers.
type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> };
function harness(estado = "PENDIENTE_ACTIVACION", linked = true) {
  const frames = new Map<string, unknown[]>();
  let frame: unknown[] = [], hook = 0;
  const calls = { cancel: 0, activate: 0, sync: 0 };
  let resolveAction!: (value: unknown) => void, rejectAction!: (error: Error) => void;
  const result = new Promise((resolve, reject) => { resolveAction = resolve; rejectAction = reject; });
  const transitions: Promise<unknown>[] = [];
  const exports: { BillingPage?: (props: Record<string, unknown>) => Element } = {};
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props });
  const code = ts.transpileModule(readFileSync("components/billing/billing-page.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require(name: string) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react") return {
      useState(initial: unknown) { const values = frame, index = hook++; if (!(index in values)) values[index] = initial;
        return [values[index], (next: unknown) => { values[index] = next; }]; },
      useRef(initial: unknown) { const values = frame, index = hook++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
      useEffect() {},
      useTransition() { const values = frame, index = hook++; if (!(index in values)) values[index] = false;
        return [values[index], (work: () => Promise<unknown>) => { values[index] = true; transitions.push(Promise.resolve(work()).finally(() => { values[index] = false; })); }]; },
    };
    if (name === "@/app/(app)/configuracion/billing/actions") return {
      cancelSubscriptionAction() { calls.cancel++; return result; },
      activateSubscriptionAction() { calls.activate++; return result; },
      syncClinicAmountAction() { calls.sync++; return result; },
      refreshSubscriptionAction() { assert.fail("this fixture must not refresh or contact a provider"); },
    };
    if (name === "next/link") return { default: (props: Element["props"]) => jsx("a", props) };
    if (name === "@/components/icons") return { Check: () => null };
    if (name === "@/lib/billing/reactivate") return { canOfferReactivate: () => false };
    if (name === "@/lib/format/currency") return { formatArs: (amount: number) => `$${amount}` };
    if (name === "@/lib/support") return { SUPPORT_EMAIL: "support@example.test", supportMailto: () => "mailto:support@example.test" };
    throw Error(`Unexpected component dependency: ${name}`);
  } });
  const props = {
    subscription: { id: "synthetic", estado, mpPreapprovalId: linked ? "synthetic-preapproval" : null, montoCents: 3000000,
      payerEmail: "owner@example.test", fechaActivacion: null, proximaCobro: null, ultimoCobroTs: null, ultimoError: null },
    charges: [], accessGate: { allowed: true, reason: null, graceDaysLeft: null }, planPriceArs: 30000,
    payerEmail: "owner@example.test", gateBanner: null, activationOk: false, orgTipo: "INDEPENDIENTE", clinicPricing: null,
  };
  function expand(value: unknown): Element[] {
    if (Array.isArray(value)) return value.flatMap(expand);
    if (!value || typeof value !== "object" || !("type" in value)) return [];
    const element = value as Element;
    if (typeof element.type === "function") {
      const savedFrame = frame, savedHook = hook;
      frame = frames.get(element.type.name) ?? []; frames.set(element.type.name, frame); hook = 0;
      const rendered = element.type(element.props);
      frame = savedFrame; hook = savedHook;
      return expand(rendered);
    }
    return [element, ...expand(element.props.children)];
  }
  const render = () => expand(jsx(exports.BillingPage!, props));
  const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join("")
    : value && typeof value === "object" ? text((value as Element).props?.children) : value == null ? "" : String(value);
  const find = (label: string) => render().find(node => node.type === "button" && text(node.props.children) === label);
  const click = (label: string) => { const button = find(label); assert.ok(button, `missing button: ${label}`);
    assert.notEqual(button.props.disabled, true, `disabled button: ${label}`); (button.props.onClick as () => void)(); };
  return { render, text, find, click, calls, resolveAction, rejectAction, finish: () => Promise.all(transitions) };
}

test("confirmed pending subscription exposes cancellation; unlinked pending does not", () => {
  assert.ok(harness().find("Cancelar suscripción"));
  assert.equal(harness("PENDIENTE_ACTIVACION", false).find("Cancelar suscripción"), undefined);
});

test("pending cancellation requires confirmation; volver makes zero calls and never promises paid access", () => {
  const h = harness(); h.click("Cancelar suscripción");
  assert.equal(h.calls.cancel, 0);
  assert.equal(h.find("Volver a activar"), undefined);
  assert.ok(h.find("Sí, cancelar"));
  assert.ok(!h.render().map(node => h.text(node.props.children)).join(" ").includes("período pagado"));
  h.click("Volver"); assert.equal(h.calls.cancel, 0); assert.ok(h.find("Volver a activar"));
});

test("confirm calls existing cancellation once, blocks stale opposite/double clicks, and awaits authoritative state", async () => {
  const h = harness(), oldActivate = h.find("Volver a activar")!;
  h.click("Cancelar suscripción"); const oldConfirm = h.find("Sí, cancelar")!;
  h.click("Sí, cancelar"); (oldConfirm.props.onClick as () => void)(); (oldActivate.props.onClick as () => void)();
  assert.deepEqual(h.calls, { cancel: 1, activate: 0, sync: 0 });
  assert.equal(h.find("Cancelando…")?.props.disabled, true); assert.equal(h.find("Volver")?.props.disabled, true);
  h.resolveAction({ ok: true }); await h.finish();
  assert.ok(h.render().some(node => h.text(node.props.children) === "Suscripción pendiente"));
  assert.ok(!h.render().some(node => h.text(node.props.children) === "Suscripción cancelada"));
});

test("known rejection is visible and makes no automatic retry", async () => {
  const h = harness(); h.click("Cancelar suscripción"); h.click("Sí, cancelar");
  h.resolveAction({ ok: false, error: { code: "forbidden", message: "No tenés permiso." } }); await h.finish();
  assert.ok(h.render().some(node => node.props.role === "alert" && h.text(node.props.children).includes("No tenés permiso.")));
  assert.equal(h.calls.cancel, 1); assert.equal(h.find("Sí, cancelar")?.props.disabled, false);
});

for (const transport of [false, true]) {
  test(`${transport ? "lost action response" : "pending provider confirmation"} is uncertain, locks mutations and offers readback`, async () => {
    const h = harness(); h.click("Cancelar suscripción"); h.click("Sí, cancelar");
    if (transport) h.rejectAction(Error("synthetic private response detail"));
    else h.resolveAction({ ok: false, error: { code: "network", message: "La cancelación está pendiente de confirmación en Mercado Pago." } });
    await h.finish();
    assert.equal(h.calls.cancel, 1); assert.equal(h.find("Sí, cancelar")?.props.disabled, true);
    assert.ok(h.render().some(node => node.type === "a" && node.props.href === "/configuracion/billing" && h.text(node.props.children) === "Consultar estado actualizado"));
    const text = h.render().map(node => h.text(node.props.children)).join(" ");
    assert.ok(!text.includes("synthetic private response detail")); assert.ok(!text.includes("Suscripción cancelada"));
  });
}

test("active subscription keeps confirmation and existing cancellation callback", async () => {
  const h = harness("ACTIVA"); h.click("Cancelar suscripción");
  assert.ok(h.render().map(node => h.text(node.props.children)).join(" ").includes("período pagado"));
  h.click("Sí, cancelar"); assert.equal(h.calls.cancel, 1);
  h.resolveAction({ ok: true }); await h.finish();
});
