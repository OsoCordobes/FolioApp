import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown> };
function fixture(operation: "export" | "request" | "cancel", fail: boolean) {
  const messages: unknown[] = [];
  let pending: Promise<void> | undefined;
  let downloads = 0;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const action = async () => { if (fail) throw Error("SECRET transport"); return { ok: true, data: { own: true }, filename: "synthetic.json" }; };
  const exports: { DatosClient?: (props: unknown) => Element } = {};
  const imports: Record<string, unknown> = {
    "react": { useState: (initial: unknown) => [initial, (value: unknown) => messages.push(value)], useTransition: () => [false, (callback: () => Promise<void>) => { pending = callback(); }] },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/lib/use-confirm": { useConfirm: () => ({ confirmar: async () => true, dialogo: null }) },
    "./actions": { exportMyDataAction: action, requestAccountDeletionAction: action, cancelAccountDeletionAction: action },
  };
  runInNewContext(ts.transpileModule(readFileSync("app/(app)/configuracion/datos/datos-client.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => { if (!(name in imports)) throw Error(name); return imports[name]; },
    Blob, URL: { createObjectURL: () => "blob:synthetic", revokeObjectURL: () => {} },
    document: { createElement: () => ({ click: () => downloads++ }), body: { appendChild: () => {}, removeChild: () => {} } },
  });
  // For the request scenario the existing form must already be open.
  if (operation === "request") {
    let state = 0;
    (imports.react as { useState: unknown }).useState = (initial: unknown) => [++state === 3 ? true : initial, (value: unknown) => messages.push(value)];
  }
  const tree = exports.DatosClient!({ email: "synthetic@example.invalid", deletionRequestedAt: operation === "cancel" ? "2026-09-01" : null, deletionReason: null, consentSignedAt: null, consentTextVersion: null });
  const elements: Element[] = [];
  function visit(value: unknown) { if (!value || typeof value !== "object") return; if (Array.isArray(value)) { value.forEach(visit); return; } const e = value as Element; if (e.props) { elements.push(e); visit(e.props.children); } }
  visit(tree);
  const text = operation === "export" ? "Descargar JSON" : operation === "request" ? "Registrar solicitud de baja" : "Cancelar solicitud (mantengo la cuenta)";
  const button = elements.find(e => e.type === "button" && e.props.children === text)!;
  assert.ok(button, text);
  return { messages, downloads: () => downloads, click: async () => { await (button.props.onClick as () => unknown)(); await pending; } };
}
for (const operation of ["export", "request", "cancel"] as const) {
  test(`own data ${operation} handles rejected transport with a safe retryable message`, async () => {
    const f = fixture(operation, true);
    await f.click();
    assert.equal(f.downloads(), 0);
    assert.ok(f.messages.some(value => typeof value === "string" && value.includes("Reintentá")));
    assert.ok(!JSON.stringify(f.messages).includes("SECRET"));
  });
}
test("own data successful export creates exactly one download", async () => { const f = fixture("export", false); await f.click(); assert.equal(f.downloads(), 1); });
