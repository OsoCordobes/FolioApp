import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { formatCents } from "../../lib/format/financial-money";

// Small hook harness exercises the actual event handlers without network or a browser.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { type: string; props: Record<string, any> };
function nodes(node: Node): Node[] {
  const children = [node.props?.children].flat(Infinity).filter((v) => v && typeof v === "object") as Node[];
  return [node, ...children.flatMap(nodes)];
}
function harness(fails = false) {
  const values: unknown[] = [];
  let hook = 0;
  const calls: Array<Record<string, unknown>> = [];
  const exports: Record<string, (input: unknown) => Node> = {};
  const jsx = (type: string, props: Node["props"]) => ({ type, props });
  const js = ts.transpileModule(readFileSync("components/finanzas/finanzas.tsx", "utf8") + "\nexport { TablaTransacciones as TestTable };", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(js, { exports, require(name: string) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react") return {
      useState(initial: unknown) { const i = hook++; if (!(i in values)) values[i] = initial;
        return [values[i], (next: unknown) => { values[i] = next; }]; },
      useRef(initial: unknown) { const i = hook++; if (!(i in values)) values[i] = { current: initial }; return values[i]; },
      useTransition: () => [false, (callback: () => void) => callback()],
    };
    if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
    if (name === "@/components/ui/toast") return { useToast: () => ({ show() {} }) };
    if (name === "@/lib/format/financial-money") return { formatCents };
    if (name === "@/app/(app)/finanzas/actions") return { listFinanceMovementsAction: async (input: Record<string, unknown>) => {
      calls.push(input);
      return fails ? { ok: false, error: { message: "Synthetic read failure" } }
        : { ok: true, data: { rows: [], totalCount: 0, nextCursor: null } };
    } };
    return {};
  } });
  const props = {
    initialPage: { rows: [{ id: "one", fecha: "2026-09-02T02:59:00Z", paciente: "Synthetic patient", servicio: "Synthetic service", monto: 1.01,
      montoCents: "101", metodo: "efectivo", estado: "pendiente" }], totalCount: 1501, nextCursor: { id: "cursor-id", createdAt: "2026-09-01T03:00:00Z" } },
    window: { startUtc: "2026-09-01T03:00:00Z", endUtc: "2026-10-01T03:00:00Z" }, mesLabel: "septiembre 2026", periodo: "mes", canMarcarCobrado: false,
  };
  return { calls, render: () => { hook = 0; return nodes(exports.TestTable(props)); } };
}
test("table next page uses server cursor and global count instead of filtering the loaded rows", async () => {
  const h = harness();
  const initial = h.render();
  const next = initial.find((n) => n.type === "button" && n.props.children === "Siguiente")!;
  assert.equal(next.props.disabled, false);
  next.props.onClick();
  await new Promise(setImmediate);
  assert.equal((h.calls[0].cursor as { id: string }).id, "cursor-id");
  assert.equal(h.calls[0].startUtc, "2026-09-01T03:00:00Z");
  assert.equal(h.render().find((n) => n.type === "button" && n.props.children === "Siguiente")?.props.disabled, true);
});
test("failed server filter retains previous rows and applied export filter with an honest error", async () => {
  const h = harness(true);
  h.render().find((n) => n.type === "input" && n.props.onChange)!.props.onChange({ target: { value: "Full Name" } });
  h.render().find((n) => n.type === "form" && n.props.onSubmit)!.props.onSubmit({ preventDefault() {} });
  await new Promise(setImmediate);
  const after = h.render();
  assert.equal(h.calls[0].query, "Full Name");
  assert.equal(after.find((n) => n.type === "b")?.props.children, "Synthetic patient");
  assert.match(after.find((n) => n.props.role === "status")!.props.children, /Se conservan los resultados anteriores/);
  assert.equal(after.find((n) => n.type === "input" && n.props.name === "query")?.props.value, "");
});
