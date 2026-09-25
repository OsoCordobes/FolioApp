import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync("lib/patient/export-package-delivery-http.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> = {};
runInNewContext(compiled, { exports, Buffer, URL, require: (name: string) => {
  if (name === "server-only") return {};
  if (name === "next/server") return { NextResponse: { json: (value: unknown, options: unknown) =>
    ({ value, options }) } };
  if (name === "@/lib/db/session") return { getActiveSession: async () =>
    ({ ok: false, error: { code: "auth_required" } }) };
  if (name === "@/lib/supabase/server") return { createSupabaseServerClient: async () => ({}) };
  if (name === "@/lib/security/rate-limit") return { limitByKey: async () =>
    ({ ok: true, resetIn: 0 }) };
  throw Error(`unexpected import ${name}`);
} });

const jsonRequest = (value: unknown) => new Request("https://folio.invalid/api/patient/export-package", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://folio.invalid" },
  body: JSON.stringify(value),
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
  assert.equal(await parse(new Request("https://folio.invalid/api/patient/export-package", {
    method: "POST", headers: { "Content-Type": "application/json",
      Origin: "https://attacker.invalid" }, body: '{"patientId":"patient","operationId":"operation"}',
  }), keys), null);
  assert.equal(await parse(new Request("https://folio.invalid/api/patient/export-package", {
    method: "POST", headers: { "Content-Type": "text/plain",
      Origin: "https://folio.invalid" }, body: '{"patientId":"patient","operationId":"operation"}',
  }), keys), null);
  assert.equal(await parse(new Request("https://folio.invalid/api/patient/export-package", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8",
      Origin: "https://folio.invalid" }, body: '{"patientId":"patient","operationId":"operation"}',
  }), keys), null);
});

test("error response removes raw diagnostic detail and is never cacheable", () => {
  const failure = exports.packageFailure as (error: unknown) =>
    { value: unknown; options: { status: number; headers: Record<string, string> } };
  const response = failure({ code: "forbidden", message: "Acceso denegado.",
    detail: "SECRET path bucket SQL" });
  assert.equal(response.options.status, 403);
  assert.equal(response.options.headers["Cache-Control"], "private, no-store");
  assert.doesNotMatch(JSON.stringify(response.value), /SECRET|bucket|SQL/);
  const uncertain = failure({ code: "db_error", message: "Estado no confirmado." });
  assert.equal(uncertain.options.status, 503);
});

test("GET query rejects a lease token, duplicates and extra fields", () => {
  const exact = exports.exactPackageQuery as (query: URLSearchParams, keys: string[]) => boolean;
  assert.equal(exact(new URLSearchParams("patientId=p&operationId=o"),
    ["patientId", "operationId"]), true);
  assert.equal(exact(new URLSearchParams("patientId=p&operationId=o&leaseToken=secret"),
    ["patientId", "operationId"]), false);
  assert.equal(exact(new URLSearchParams("patientId=p&patientId=q&operationId=o"),
    ["patientId", "operationId"]), false);
});

test("actor/org rate limit returns 429 with bounded Retry-After before client work", async () => {
  const limited: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> = {};
  const calls: { scope: string; key: string; max: number }[] = [];
  runInNewContext(compiled, { exports: limited, Buffer, URL, require: (name: string) => {
    if (name === "server-only") return {};
    if (name === "next/server") return { NextResponse: { json: (value: unknown, options: unknown) =>
      ({ value, options }) } };
    if (name === "@/lib/db/session") return { getActiveSession: async () =>
      ({ ok: true, data: { organizationId: "org", userId: "actor" } }) };
    if (name === "@/lib/supabase/server") return { createSupabaseServerClient: async () => {
      throw Error("must not create DB client after 429");
    } };
    if (name === "@/lib/security/rate-limit") return { limitByKey: async (
      scope: string, key: string, max: number) => {
      calls.push({ scope, key, max }); return { ok: false, resetIn: 43 };
    } };
    throw Error(`unexpected import ${name}`);
  } });
  const context = await limited.packageContext("fragment") as
    { ok: boolean; error: { code: string; retryAfter: number } };
  assert.equal(context.ok, false);
  assert.equal(context.error.code, "rate_limited");
  assert.deepEqual(calls, [{ scope: "patient.export-package.fragment", key: "org:actor", max: 1200 }]);
  const response = limited.packageFailure(context.error) as
    { options: { status: number; headers: Record<string, string> } };
  assert.equal(response.options.status, 429);
  assert.equal(response.options.headers["Retry-After"], "43");
});
