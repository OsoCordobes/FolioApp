import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function action(delivery: { status: string; detail?: string; providerId?: string }) {
  const observed: unknown[] = [];
  const exports: Record<string, (input: unknown) => Promise<{ data: Record<string, unknown> }>> = {};
  const js = ts.transpileModule(readFileSync("app/(app)/configuracion/actions.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports, process: { env: { RESEND_API_KEY: "synthetic-configured" } }, require(name: string) {
    if (name === "@/lib/db/members") return { createInvitation: async () => ({ ok: true, data: {
      organizationId: "org-fixture", invitation: { id: "invitation-fixture", email: "staff@example.test", role: "PROFESIONAL" },
      acceptUrl: "https://example.test/invitation/test", expiresAtIso: "2027-01-01", organizationNombre: "Test",
    } }) };
    if (name === "@/lib/email/notify") return { notifyMemberInvitation: async (input: unknown) => { observed.push(input); return delivery; } };
    if (name === "next/cache") return { revalidatePath() {} };
    if (name === "@/lib/auth/capabilities") return { roleLabel: () => "Profesional" };
    return {};
  } });
  return { execute: () => exports.inviteMemberAction({}), observed };
}

test("configured provider does not make a failed invitation email successful", async () => {
  const scenario = action({ status: "failed", detail: "provider_http_422" });
  const result = await scenario.execute();
  assert.equal(result.data.emailEstado, "fallido");
  assert.equal(result.data.acceptUrl, "https://example.test/invitation/test");
});

test("queued invitation remains pending and carries its organization context", async () => {
  const scenario = action({ status: "queued", detail: "persisted" });
  const result = await scenario.execute();
  assert.equal(result.data.emailEstado, "pendiente");
  assert.equal((scenario.observed[0] as { organizationId: string }).organizationId, "org-fixture");
});

test("provider receipt establishes acceptance, not delivery", async () => {
  const scenario = action({ status: "sent", providerId: "receipt-fixture" });
  assert.equal((await scenario.execute()).data.emailEstado, "aceptado");
});
