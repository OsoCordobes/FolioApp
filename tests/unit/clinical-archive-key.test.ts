import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { readSavedPackageOperation, savePackageOperation } from
  "../../lib/patient/export-package-browser";

const id = (n: number) => `14500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const patientId = id(10);
const Archive = () => null;
type Node = { type: unknown; props: Record<string, unknown>; key: string | null };

test("server elements key each scope and session operation IDs remain isolated", async () => {
  const oldScope = { userId: id(1), organizationId: id(2) };
  const newScope = { userId: id(3), organizationId: id(4) };
  let scope = oldScope;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  savePackageOperation(oldScope, patientId, id(5));
  const source = readFileSync("app/archivo-clinico/page.tsx", "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports: Record<string, () => Promise<Node>> = {};
  const jsx = (type: unknown, props: Record<string, unknown>, key?: string): Node =>
    ({ type, props, key: key ?? null });
  runInNewContext(js, { exports, require: (name: string) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "next/navigation") return { redirect: () => { throw Error("unexpected_redirect"); } };
    if (name === "@/components/clinical-archive/archive") return { ClinicalArchive: Archive };
    if (name === "@/lib/patient/clinical-archive") return { readClinicalArchive: async () => ({
      ok: true, data: { patients: [{ id: patientId, name: "Paciente ficticio" }],
        total: 1, nextCursor: null, scope },
    }) };
    if (name === "@/lib/support") return { supportMailto: () => "mailto:synthetic@example.test" };
    throw Error(`unexpected_import_${name}`);
  } });
  const findArchive = (node: Node): Node | null => {
    if (node.type === Archive) return node;
    for (const child of [node.props.children].flat(Infinity)) {
      if (child && typeof child === "object" && "type" in child) {
        const found = findArchive(child as Node);
        if (found) return found;
      }
    }
    return null;
  };
  const before = findArchive(await exports.default());
  scope = newScope;
  const after = findArchive(await exports.default());
  assert.ok(before && after);
  assert.equal(before.key, `${oldScope.userId}:${oldScope.organizationId}`);
  assert.equal(after.key, `${newScope.userId}:${newScope.organizationId}`);
  assert.notEqual(before.key, after.key);
  assert.equal((after.props.initialPage as { scope: typeof newScope }).scope.userId, newScope.userId);
  assert.equal(readSavedPackageOperation(newScope, patientId), null);
  assert.equal(readSavedPackageOperation(oldScope, patientId), id(5));
});
