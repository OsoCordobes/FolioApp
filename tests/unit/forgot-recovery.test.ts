import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown> };
type ResetResult = { ok: boolean; error?: string; code?: string };

function mountForgot(request: (email: string) => Promise<ResetResult>) {
  const slots: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const pending: Promise<unknown>[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
  const source = readFileSync("components/auth/login-form.tsx", "utf8")
    .replace("function Forgot(", "export function Forgot(");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, (props: { setVista: () => void }) => Element> = {};
  runInNewContext(compiled, {
    exports,
    process: { env: {} },
    Date,
    require(name: string) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return {
        useState(initial: unknown) {
          const index = stateIndex++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next; }];
        },
        useRef(initial: unknown) {
          const index = refIndex++;
          if (!refs[index]) refs[index] = { current: initial };
          return refs[index];
        },
        useEffect() {},
        useTransition() {
          return [false, (callback: () => Promise<unknown>) => { pending.push(Promise.resolve().then(callback)); }];
        },
      };
      if (name === "@/app/(public)/login/actions") return { requestPasswordReset: request };
      if (name === "@/lib/support") return { supportMailto: () => "mailto:synthetic@example.test" };
      return {};
    },
  });

  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return exports.Forgot({ setVista: () => {} });
  };
  const find = (root: unknown, predicate: (element: Element) => boolean): Element | undefined => {
    if (Array.isArray(root)) return root.map((item) => find(item, predicate)).find(Boolean);
    if (!root || typeof root !== "object" || !("props" in root)) return undefined;
    const element = root as Element;
    return predicate(element) ? element : find(Object.values(element.props), predicate);
  };
  const flush = async () => { await Promise.all(pending.splice(0)); };
  return { render, find, flush };
}

test("recovery shows rate limit and retains the email instead of claiming delivery", async () => {
  let calls = 0;
  const view = mountForgot(async () => {
    calls++;
    return { ok: false, code: "rate_limited", error: "Demasiados pedidos de recuperación. Esperá una hora." };
  });
  const input = view.find(view.render(), (element) => element.type === "input" && element.props.type === "email");
  assert.ok(input);
  (input.props.onChange as (event: unknown) => void)({ target: { value: "persona@example.test" } });
  const form = view.find(view.render(), (element) => element.type === "form");
  assert.ok(form);
  const submit = form.props.onSubmit as (event: unknown) => void;
  submit({ preventDefault() {} });
  submit({ preventDefault() {} });
  await view.flush();
  const result = view.render();
  assert.equal(calls, 1);
  assert.equal(view.find(result, (element) => element.props.role === "alert")?.props.children, "Demasiados pedidos de recuperación. Esperá una hora.");
  assert.equal(view.find(result, (element) => element.type === "input" && element.props.type === "email")?.props.value, "persona@example.test");
  assert.equal(view.find(result, (element) => element.type === "h1")?.props.children, "Recuperá tu acceso.");
});

test("lost recovery response stays on the form; confirmed response keeps generic success", async () => {
  for (const response of ["lost", "ok"] as const) {
    const view = mountForgot(async () => {
      if (response === "lost") throw new Error("synthetic lost response");
      return { ok: true };
    });
    const input = view.find(view.render(), (element) => element.type === "input" && element.props.type === "email");
    assert.ok(input);
    (input.props.onChange as (event: unknown) => void)({ target: { value: "unknown@example.test" } });
    const form = view.find(view.render(), (element) => element.type === "form");
    assert.ok(form);
    (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await view.flush();
    const result = view.render();
    if (response === "lost") {
      assert.match(String(view.find(result, (element) => element.props.role === "alert")?.props.children), /No pudimos confirmar el envío/);
      assert.equal(view.find(result, (element) => element.type === "input" && element.props.type === "email")?.props.value, "unknown@example.test");
    } else {
      assert.equal(view.find(result, (element) => element.type === "h1")?.props.children, "Revisá tu email.");
    }
  }
});
