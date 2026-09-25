import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const id = (n: number) => `14000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("real fragment handler withholds bytes if authority is revoked during awaited audit", async () => {
  let revoked = false;
  let auditCalls = 0;
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const js = ts.transpileModule(readFileSync(
    "app/api/patient/export-package/[jobId]/entries/[entryId]/fragments/[ordinal]/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  class ResponseStub {
    body: unknown; status: number;
    constructor(body: unknown, options: { status: number }) {
      this.body = body; this.status = options.status;
    }
  }
  runInNewContext(js, { exports, Buffer, URL, ResponseStub, require: (name: string) => {
    if (name === "next/server") return { NextResponse: ResponseStub };
    if (name === "@/lib/db/audit") return { writeAuditEntry: async () => {
      auditCalls++; revoked = true; return { ok: true };
    } };
    if (name === "@/lib/patient/export-package-delivery") return {
      readPackageFragment: async (_client: unknown, _session: unknown, _bound: unknown,
        _entry: string, _ordinal: number, beforeFinalValidation?: () => Promise<void>) => {
        if (beforeFinalValidation) await beforeFinalValidation();
        return revoked ? { ok: false, error: { code: "forbidden", message: "Access changed" } } :
          { ok: true, data: { bytes: new Uint8Array([7]), sha256: "a".repeat(64),
            fileSha256: "b".repeat(64), totalFragments: 1 } };
      },
    };
    if (name === "@/lib/patient/export-package-delivery-http") return {
      exactPackageQuery: () => true, UUID: /^[0-9a-f-]{36}$/i,
      packageContext: async () => ({ ok: true, data: { client: {},
        session: { organizationId: id(10), userId: id(1), role: "OWNER" } } }),
      packageFailure: (error: unknown) => ({ status: 403, error }),
      invalidPackageRequest: () => ({ status: 400 }),
      unavailablePackage: () => ({ status: 503 }), packageHeaders: {},
    };
    throw Error(`unexpected import ${name}`);
  } });
  const request = new Request(`https://folio.invalid/api/patient/export-package/${id(200)}/entries/${id(301)}/fragments/0?patientId=${id(101)}&operationId=${id(201)}`);
  const response = await exports.GET(request, { params: Promise.resolve({
    jobId: id(200), entryId: id(301), ordinal: "0",
  }) }) as { status: number; body?: unknown };
  assert.equal(auditCalls, 1);
  assert.equal(response.status, 403);
  assert.equal(response.body, undefined);
});
