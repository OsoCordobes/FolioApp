import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync("lib/patient/export-package-delivery-http.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> = {};
runInNewContext(compiled, { exports, Buffer, require: (name: string) => {
  if (name === "server-only") return {};
  if (name === "next/server") return { NextResponse: { json: (value: unknown, options: unknown) =>
    ({ value, options }) } };
  if (name === "@/lib/db/session") return { getActiveSession: async () =>
    ({ ok: false, error: { code: "auth_required" } }) };
  if (name === "@/lib/supabase/server") return { createSupabaseServerClient: async () => ({}) };
  throw Error(`unexpected import ${name}`);
} });

const jsonRequest = (value: unknown) => new Request("https://folio.invalid/api/patient/export-package", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
});

test("request body accepts only bounded operation identifiers, not caller-provided fingerprint or count", async () => {
  const parse = exports.packageBody as (request: Request, keys: string[]) =>
    Promise<Record<string, unknown> | null>;
  const keys = ["patientId", "operationId"];
  const valid = await parse(jsonRequest({ patientId: "patient", operationId: "operation" }), keys);
  assert.equal(valid?.patientId, "patient");
  assert.equal(await parse(jsonRequest({ patientId: "patient", operationId: "operation",
    fingerprint: "sensitive" }), keys), null);
  assert.equal(await parse(jsonRequest({ patientId: "patient", operationId: "operation",
    padding: "x".repeat(2100) }), ["patientId", "operationId", "padding"]), null);
});

test("error response removes raw diagnostic detail and is never cacheable", () => {
  const failure = exports.packageFailure as (error: unknown) =>
    { value: unknown; options: { status: number; headers: Record<string, string> } };
  const response = failure({ code: "forbidden", message: "Acceso denegado.",
    detail: "SECRET path bucket SQL" });
  assert.equal(response.options.status, 403);
  assert.equal(response.options.headers["Cache-Control"], "private, no-store");
  assert.doesNotMatch(JSON.stringify(response.value), /SECRET|bucket|SQL/);
});
