import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as crypto from "../../lib/crypto";
import * as errors from "../../lib/db/errors";
import * as incorporation from "../../lib/patient-intake/incorporation";
import * as admin from "../../lib/patient-intake/admin-v1";
import { runAssuredIntakeRpc } from "../../lib/patient-intake/staff-assurance";
import type * as Staff from "../../lib/patient-intake/staff";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1), user = id(2), member = id(3), sessionId = id(4);
const scope = createHash("sha256").update(`${user}:${org}:${member}:${sessionId}`).digest("hex");
const request = { turnoId: id(5), scope, receiptId: id(6), selectedKeys: ["email"],
  operationId: id(7), identityId: id(8), adminRevision: "9", contextHash: "a".repeat(64) };
const keyNames = ["FOLIO_ENC_KEY", "FOLIO_ENC_KEY_NEXT", "FOLIO_ENC_HMAC_KEY", "FOLIO_ENC_HMAC_KEY_NEXT"] as const;
const prior = Object.fromEntries(keyNames.map(key => [key, process.env[key]]));
before(() => {
  process.env.FOLIO_ENC_KEY = randomBytes(32).toString("base64");
  process.env.FOLIO_ENC_HMAC_KEY = randomBytes(32).toString("base64");
  delete process.env.FOLIO_ENC_KEY_NEXT; delete process.env.FOLIO_ENC_HMAC_KEY_NEXT;
  crypto.__cryptoTelemetryTestHooks.resetKeyCache();
});
after(() => {
  for (const key of keyNames) {
    if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
  }
  crypto.__cryptoTelemetryTestHooks.resetKeyCache();
});

function encrypted(value: string): string {
  return incorporation.encryptedByteaToBase64(crypto.encryptColumn(value)!);
}
function current() {
  return { nombre_cifrado: encrypted("Ana"), apellido_cifrado: encrypted("Pérez"),
    tipo_doc: "DNI", numero_doc_cifrado: encrypted("12345678"), fecha_nacimiento: "1980-01-02",
    email_cifrado: encrypted("anterior@example.test"), telefono_cifrado: encrypted("3515551234"),
    cobertura_nombre: "OSDE", cobertura_plan: "210", cobertura_nro_afiliado_cifrado: encrypted("123") };
}
function source(value: unknown): string { return encrypted(admin.canonicalAdminV1(value)); }
function receipt(status = "pending", overrides: Record<string, unknown> = {}) {
  const finished = ["applied", "unchanged", "cancelled", "conflict"].includes(status);
  return { status, operationId: request.operationId, preparationId: id(9), receiptId: request.receiptId,
    identityId: request.identityId, selectedKeys: ["email"], changedKeys: status === "pending" ? null : status === "unchanged" ? [] : ["email"],
    revisionBefore: status === "applied" || status === "unchanged" ? 9 : null,
    revisionAfter: status === "applied" ? 10 : status === "unchanged" ? 9 : null,
    reason: status === "cancelled" ? "expired" : status === "conflict" ? "snapshot_changed" : null,
    expiresAt: finished ? null : "2099-09-30T01:00:00+00:00", ...overrides };
}
function pending(value: unknown = { email: "nuevo@example.test" }, overrides: Record<string, unknown> = {}) {
  return receipt("pending", { sourceCipherBase64: source(value), sourceFingerprint: "b".repeat(64), current: current(), ...overrides });
}
function snapshot(value: unknown = { email: "nuevo@example.test" }) {
  return { receiptId: request.receiptId, questionnaireVersion: "admin.v1", contextHash: request.contextHash,
    identityId: request.identityId, adminRevision: "9", sourceCipherBase64: source(value), current: current() };
}
function tombstone() {
  return receipt("cancelled", { preparationId: null, receiptId: null, identityId: null,
    selectedKeys: null, changedKeys: null, revisionBefore: null, revisionAfter: null, reason: "cancel_before_prepare" });
}
function publicOnly(value: unknown) {
  const text = JSON.stringify(value);
  for (const forbidden of ["sourceCipherBase64", "sourceFingerprint", "_cifrado", "p_patch", "preparationId", "organizationId"]) {
    assert.ok(!text.includes(forbidden), `${forbidden} must stay server-side`);
  }
}

test("bytea becomes the same binary base64, not the encoded literal, and decrypts", () => {
  const bytea = crypto.encryptColumn("Ana Pérez")!;
  const encoded = incorporation.encryptedByteaToBase64(bytea);
  assert.deepEqual(Buffer.from(encoded, "base64"), Buffer.from(bytea.slice(2), "hex"));
  assert.equal(crypto.decryptColumn(Buffer.from(encoded, "base64")), "Ana Pérez");
  assert.notEqual(encoded, Buffer.from(bytea, "utf8").toString("base64"));
  for (const invalid of ["1234", "\\x0", "\\xgg", "\\x00", `${bytea}z`]) {
    assert.throws(() => incorporation.encryptedByteaToBase64(invalid));
  }
});

test("selection canonicalizes order, rejects duplicates, partial documents and browser patch", () => {
  const first = incorporation.incorporationRequest.parse({ ...request, selectedKeys: ["telefono", "email"] });
  const second = incorporation.incorporationRequest.parse({ ...request, selectedKeys: ["email", "telefono"] });
  assert.deepEqual(first.selectedKeys, second.selectedKeys);
  for (const input of [{ ...request, selectedKeys: ["email", "email"] }, { ...request, selectedKeys: ["numeroDocumento"] },
    { ...request, selectedKeys: ["motivo"] }, { ...request, p_patch: { email_hash: "evil" } }]) {
    assert.equal(incorporation.incorporationRequest.safeParse(input).success, false);
  }
});

test("PGbigint input keeps exact decimal while receipts reject unsafe JSON numbers", () => {
  assert.equal(incorporation.incorporationRequest.parse({ ...request, adminRevision: "9223372036854775807" }).adminRevision, "9223372036854775807");
  for (const adminRevision of ["9223372036854775808", "01", "-1", "1e3", 9]) {
    assert.equal(incorporation.incorporationRequest.safeParse({ ...request, adminRevision }).success, false);
  }
  const unsafe = incorporation.incorporationPublicResult(receipt("applied", {
    revisionBefore: Number.MAX_SAFE_INTEGER, revisionAfter: Number.MAX_SAFE_INTEGER + 1,
  }), request.operationId);
  assert.equal(unsafe.ok, false);
  if (!unsafe.ok) assert.equal(unsafe.error.mutationOutcome, "review_required");
  assert.equal(incorporation.incorporationPublicResult(receipt("applied"), request.operationId).ok, true);
});

test("snapshot exposes only selected comparison fields; line-wrapped base64 decodes", () => {
  const input = snapshot({ email: "nuevo@example.test" });
  input.sourceCipherBase64 = input.sourceCipherBase64.replace(/(.{76})/g, "$1\n");
  const result = incorporation.incorporationComparison(input);
  assert.deepEqual(result.fields, [{ key: "email", current: "anterior@example.test", proposed: "nuevo@example.test" }]);
  publicOnly(result);
  assert.throws(() => incorporation.incorporationComparison({ ...input, questionnaireVersion: "clinical.v1" }));
});

test("mapper changes only selected fields and tenant hashes; equal values produce empty patch", () => {
  const now = current();
  const patch = incorporation.buildIncorporationPatch(source({ email: "Nuevo@Example.test", telefono: "3510009999" }), now, ["email"], org);
  assert.deepEqual(Object.keys(patch).sort(), ["email_cifrado", "email_hash"]);
  assert.equal(crypto.decryptColumn(Buffer.from(patch.email_cifrado!, "base64")), "Nuevo@Example.test");
  assert.equal(patch.email_hash, crypto.blindIndex("nuevo@example.test", org));
  assert.notEqual(patch.email_hash, crypto.blindIndex("nuevo@example.test", id(20)));
  assert.deepEqual(incorporation.buildIncorporationPatch(source({ email: "anterior@example.test" }), now, ["email"], org), {});
  assert.throws(() => incorporation.buildIncorporationPatch(source({ email: "nuevo@example.test" }), now, ["telefono"], org));
});

test("partial name hashes the final omitted surname and aborts on its corruption", () => {
  const now = current();
  const patch = incorporation.buildIncorporationPatch(source({ nombre: "Bea" }), now, ["nombre"], org);
  assert.deepEqual(Object.keys(patch).sort(), ["nombre_cifrado", "nombre_hash"]);
  assert.equal(patch.nombre_hash, crypto.blindIndex("Bea Pérez", org));
  assert.throws(() => incorporation.buildIncorporationPatch(source({ nombre: "Bea" }), { ...now, apellido_cifrado: "bad" }, ["nombre"], org));
  assert.deepEqual(incorporation.buildIncorporationPatch(source({ nombre: "Ana" }), now, ["nombre"], org), {});
});

test("document pair is required but changing only type does not recipher the number", () => {
  const now = current();
  const keys = ["tipoDocumento", "numeroDocumento"];
  assert.deepEqual(incorporation.buildIncorporationPatch(source({ tipoDocumento: "CI", numeroDocumento: "12345678" }), now, keys, org), { tipo_doc: "CI" });
  const patch = incorporation.buildIncorporationPatch(source({ tipoDocumento: "DNI", numeroDocumento: "87654321" }), now, keys, org);
  assert.deepEqual(Object.keys(patch).sort(), ["dni_hash", "numero_doc_cifrado"]);
  assert.equal(patch.dni_hash, crypto.blindIndex("87654321", org));
  assert.throws(() => incorporation.buildIncorporationPatch(source({ tipoDocumento: "CI" }), now, keys, org));
});

test("phone uses tenant and eight digits even when admin.v1 accepts a shorter phone", () => {
  const patch = incorporation.buildIncorporationPatch(source({ telefono: "+54 9 351 000 9999" }), current(), ["telefono"], org);
  assert.equal(patch.telefono_hash, crypto.blindIndexPhone("+54 9 351 000 9999", org));
  assert.notEqual(patch.telefono_hash, crypto.blindIndexPhone("+54 9 351 000 9999", id(20)));
  const shorter = source({ telefono: "123456" });
  assert.throws(() => incorporation.buildIncorporationPatch(shorter, current(), ["telefono"], org));
});

test("coverage merges snapshot before normalizing and emits only selected changed columns", () => {
  const now = current();
  assert.deepEqual(incorporation.buildIncorporationPatch(source({ cobertura: { plan: "310" } }), now, ["cobertura.plan"], org), { cobertura_plan: "310" });
  assert.throws(() => incorporation.buildIncorporationPatch(source({ cobertura: { nombre: "PAMI" } }), now, ["cobertura.nombre"], org));
  assert.throws(() => incorporation.buildIncorporationPatch(source({ cobertura: { plan: "310" } }), { ...now, cobertura_nombre: null }, ["cobertura.plan"], org));
  assert.throws(() => incorporation.buildIncorporationPatch(source({ cobertura: { nombre: "Particular", plan: "310", numeroAfiliado: "456" } }), now,
    ["cobertura.nombre", "cobertura.plan", "cobertura.numeroAfiliado"], org));
  assert.deepEqual(incorporation.buildIncorporationPatch(source({ cobertura: { nombre: "Particular" } }), {
    ...now, cobertura_plan: null, cobertura_nro_afiliado_cifrado: null,
  }, ["cobertura.nombre"], org), { cobertura_nombre: null });
});

test("DTO parser accepts tombstone and minimal absence and strips private receipt payload", () => {
  for (const raw of [tombstone(), { status: "not_recorded", operationId: request.operationId },
    receipt("applied", { sourceCipherBase64: "private", sourceFingerprint: "private", patch: { private: "private" } })]) {
    const result = incorporation.incorporationPublicResult(raw, request.operationId);
    assert.equal(result.ok, true); publicOnly(result);
  }
  assert.equal(incorporation.incorporationPublicResult(receipt("pending", { receiptId: null }), request.operationId).ok, false);
  assert.equal(incorporation.incorporationPublicResult({ status: "not_recorded", operationId: id(40) }, request.operationId).ok, false);
});

type Transport = incorporation.IncorporationTransport;
function transport(options: { prepare?: unknown; materialize?: unknown; status?: unknown; apply?: unknown;
  lost?: "prepare" | "materialize" | "apply"; materializeError?: errors.Result<unknown>;
  statusError?: errors.Result<{ value: unknown; organizationId: string }>; applyError?: errors.Result<{ value: unknown; organizationId: string }> } = {}) {
  const calls: string[] = [];
  const args: Record<string, unknown>[] = [];
  const f: Transport = {
    staff: async (name, extra) => {
      const phase = name.replace("patient_intake_incorporation_", ""); calls.push(phase); args.push(extra);
      if (options.lost === phase) throw new Error("synthetic_response_lost");
      if (phase === "apply" && options.applyError) return options.applyError;
      if (phase === "status" && options.statusError) return options.statusError;
      const value = phase === "prepare" ? options.prepare ?? pending() : phase === "status" ? options.status ?? receipt("materialized") : options.apply ?? receipt("applied");
      return errors.ok({ value, organizationId: org });
    },
    materialize: async extra => {
      calls.push("materialize"); args.push(extra);
      if (options.lost === "materialize") throw new Error("synthetic_response_lost");
      return options.materializeError ?? errors.ok(options.materialize ?? receipt("materialized"));
    },
  };
  return { calls, args, f };
}

test("pending prepares exact decimal/canonical selection and applies with separate authenticated transport", async () => {
  const t = transport();
  const result = await incorporation.runIncorporation(request, t.f);
  assert.equal(result.ok, true); publicOnly(result);
  assert.deepEqual(t.calls, ["prepare", "materialize", "apply"]);
  assert.equal(t.args[0].p_expected_revision, "9");
  assert.equal(t.args[1].p_source_fingerprint, "b".repeat(64));
  assert.deepEqual(t.args[2], { p_preparation: id(9), p_operation: request.operationId });
  assert.ok(!("p_patch" in t.args[2]));
});

test("materialized resumes apply without source/current or materializing again", async () => {
  const t = transport({ prepare: receipt("materialized") });
  assert.equal((await incorporation.runIncorporation(request, t.f)).ok, true);
  assert.deepEqual(t.calls, ["prepare", "apply"]);
});

test("prepare terminals including cancellation tombstone return immediately", async () => {
  for (const raw of [receipt("applied"), receipt("unchanged"), receipt("conflict"), receipt("cancelled"), tombstone()]) {
    const t = transport({ prepare: raw });
    const result = await incorporation.runIncorporation(request, t.f);
    assert.equal(result.ok, true); publicOnly(result); assert.deepEqual(t.calls, ["prepare"]);
  }
});

test("missing/corrupt source and mismatched receipt stop before service materialization", async () => {
  for (const raw of [receipt("pending"), pending({ email: "nuevo@example.test" }, { sourceCipherBase64: "bad" }),
    pending({ email: "nuevo@example.test" }, { identityId: id(40) })]) {
    const t = transport({ prepare: raw });
    const result = await incorporation.runIncorporation(request, t.f);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.mutationOutcome, "review_required");
    assert.deepEqual(t.calls, ["prepare"]);
  }
});

test("materialize response loss reconciles once and continues only from materialized", async () => {
  const t = transport({ lost: "materialize" });
  assert.equal((await incorporation.runIncorporation(request, t.f)).ok, true);
  assert.deepEqual(t.calls, ["prepare", "materialize", "status", "apply"]);
  const cancelled = transport({ lost: "materialize", status: receipt("cancelled") });
  const result = await incorporation.runIncorporation(request, cancelled.f);
  assert.ok(result.ok && result.data.status === "cancelled");
  assert.deepEqual(cancelled.calls, ["prepare", "materialize", "status"]);
});

test("apply response loss accepts durable terminal without another apply", async () => {
  const t = transport({ lost: "apply", status: receipt("applied") });
  const result = await incorporation.runIncorporation(request, t.f);
  assert.ok(result.ok && result.data.status === "applied");
  assert.deepEqual(t.calls, ["prepare", "materialize", "apply", "status"]);
});

test("unresolved response losses retain operation with mutationOutcome uncertain and no blind retry", async () => {
  for (const state of [receipt("pending"), receipt("materialized"), { status: "not_recorded", operationId: request.operationId }]) {
    const t = transport({ lost: "apply", status: state });
    const result = await incorporation.runIncorporation(request, t.f);
    assert.ok(!result.ok && result.error.code === "network" && result.error.mutationOutcome === "uncertain");
    assert.deepEqual(t.calls, ["prepare", "materialize", "apply", "status"]);
    assert.equal(t.args[3].p_operation, request.operationId);
  }
  const t = transport({ lost: "prepare", status: receipt("materialized") });
  assert.equal((await incorporation.runIncorporation(request, t.f)).ok, false);
  assert.deepEqual(t.calls, ["prepare", "status"]);
});

test("known SQL rejection keeps Result codes, and unsafe result requires review", async () => {
  for (const [sql, code] of [["42501", "forbidden"], ["40001", "conflict"], ["22023", "validation"]]) {
    const t = transport({ materializeError: incorporation.incorporationRpcError(sql, true) });
    const result = await incorporation.runIncorporation(request, t.f);
    assert.ok(!result.ok && result.error.code === code);
    assert.deepEqual(t.calls, ["prepare", "materialize"]);
  }
  const t = transport({ apply: receipt("applied", { revisionAfter: Number.MAX_SAFE_INTEGER + 1 }) });
  const result = await incorporation.runIncorporation(request, t.f);
  assert.ok(!result.ok && result.error.code === "db_error" && result.error.mutationOutcome === "review_required");
});

test("failed reconciliation after response loss preserves safe error and uncertain outcome", async () => {
  for (const code of ["forbidden", "network", "auth_required", "mfa_required"] as const) {
    const t = transport({ lost: "apply", statusError: errors.err(code, "Synthetic safe failure") });
    const result = await incorporation.runIncorporation(request, t.f);
    assert.ok(!result.ok && result.error.code === code && result.error.mutationOutcome === "uncertain");
    assert.deepEqual(t.calls, ["prepare", "materialize", "apply", "status"]);
  }
  const t = transport({ lost: "apply", status: receipt("applied", { revisionAfter: Number.MAX_SAFE_INTEGER + 1 }) });
  const result = await incorporation.runIncorporation(request, t.f);
  assert.ok(!result.ok && result.error.code === "db_error" && result.error.mutationOutcome === "review_required");
});

/** Executes the real exported actions with local dependencies replaced; no cookies/network/env. */
function actions(options: { level?: string; verified?: boolean; sessionValid?: boolean; denied?: boolean;
  claimSub?: string; claimSession?: string; changeScopeAfterPrepare?: boolean; applyForbidden?: boolean } = {}) {
  const calls: string[] = [];
  const rpcArgs: { name: string; args: Record<string, unknown> }[] = [];
  let activeReads = 0;
  const client = {
    auth: {
      getSession: async () => {
        calls.push("session");
        return { data: { session: { access_token: `header.${Buffer.from(JSON.stringify({ sub: options.claimSub ?? user,
          session_id: options.claimSession ?? sessionId })).toString("base64url")}.signature` } }, error: null };
      },
      mfa: { getAuthenticatorAssuranceLevel: async () => { calls.push("aal"); return { data: { currentLevel: options.level ?? "aal2" }, error: null }; } },
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name); rpcArgs.push({ name, args });
      if (name.endsWith("apply") && options.applyForbidden) return { data: null, error: { code: "42501" } };
      const data = name.endsWith("snapshot") ? snapshot() : name.endsWith("prepare") ? pending()
        : name.endsWith("apply") ? receipt("applied") : name.endsWith("cancel") ? tombstone() : receipt("materialized");
      return { data, error: null };
    },
  };
  const exported = {} as typeof Staff;
  const compiled = ts.transpileModule(readFileSync("lib/patient-intake/staff.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireModule = (name: string): unknown => {
    if (name === "zod") return { z };
    if (name === "node:crypto") return { createHash };
    if (name === "@/lib/crypto") return crypto;
    if (name === "@/lib/db/errors") return errors;
    if (name === "./admin-v1") return admin;
    if (name === "./incorporation") return incorporation;
    if (name === "./staff-assurance") return { runAssuredIntakeRpc };
    if (name === "@/lib/db/session") return { getActiveSession: async () => {
      calls.push("active"); activeReads++;
      if (options.denied) return errors.err("auth_required", "Synthetic denied");
      return errors.ok({ organizationId: options.changeScopeAfterPrepare && activeReads > 1 ? id(99) : org, userId: user, memberId: member });
    } };
    if (name === "@/lib/security/rate-limit") return { limitByKey: async () => { calls.push("limit"); return { ok: true }; } };
    if (name === "@/lib/auth/mfa-access") return { readMfaStatus: async () => {
      calls.push("factor");
      return errors.ok({ required: false, allowed: true, isStaff: true,
        hasVerifiedFactor: options.verified ?? true, sessionValid: options.sessionValid ?? true });
    } };
    if (name === "@/lib/supabase/server") return {
      createSupabaseServerClient: async () => client,
      createSupabaseServiceClient: () => {
        calls.push("service-client");
        return { rpc: async (name: string, args: Record<string, unknown>) => {
          calls.push(name); rpcArgs.push({ name, args }); return { data: receipt("materialized"), error: null };
        } };
      },
    };
    throw new Error(`Unexpected local dependency ${name}`);
  };
  runInNewContext(compiled, { exports: exported, require: requireModule, Buffer });
  return { exported, calls, rpcArgs };
}

test("all four direct actions enforce AAL2 and scope before any RPC or privileged client", async () => {
  for (const options of [{ level: "aal1" }, { verified: false }, { sessionValid: false }, { denied: true },
    { claimSub: id(80) }, { claimSession: "invalid" }]) {
    const a = actions(options);
    for (const result of [await a.exported.getPatientIntakeIncorporationSnapshot(request.turnoId, scope, request.receiptId),
      await a.exported.applyPatientIntakeIncorporation(request),
      await a.exported.patientIntakeIncorporationStatus(request.turnoId, scope, request.operationId),
      await a.exported.cancelPatientIntakeIncorporation(request.turnoId, scope, request.operationId)]) assert.equal(result.ok, false);
    assert.ok(!a.calls.some(call => call.startsWith("patient_intake_") || call === "service-client"));
  }
  const a = actions();
  assert.equal((await a.exported.applyPatientIntakeIncorporation({ ...request, scope: "f".repeat(64) })).ok, false);
  assert.ok(!a.calls.some(call => call.startsWith("patient_intake_") || call === "service-client"));
});

test("real action rechecks authority before apply; service client only calls materialize", async () => {
  const a = actions();
  const result = await a.exported.applyPatientIntakeIncorporation(request);
  assert.equal(result.ok, true); publicOnly(result);
  assert.deepEqual(a.rpcArgs.map(call => call.name), ["patient_intake_incorporation_prepare", "patient_intake_incorporation_materialize", "patient_intake_incorporation_apply"]);
  assert.equal(a.calls.filter(call => call === "service-client").length, 1);
  assert.equal(a.calls.filter(call => call === "factor").length, 2);
  assert.equal(a.rpcArgs[0].args.p_org, org);
  assert.equal(a.rpcArgs[2].args.p_org, org);
  assert.deepEqual(Object.keys(a.rpcArgs[1].args).sort(), ["p_patch", "p_preparation", "p_source_fingerprint"]);
  const changed = actions({ changeScopeAfterPrepare: true });
  assert.equal((await changed.exported.applyPatientIntakeIncorporation(request)).ok, false);
  assert.ok(!changed.calls.includes("patient_intake_incorporation_apply"));
  const revoked = actions({ applyForbidden: true });
  const denial = await revoked.exported.applyPatientIntakeIncorporation(request);
  assert.ok(!denial.ok && denial.error.code === "forbidden");
});

test("snapshot/status/cancel exported actions return public DTOs and validate browser inputs", async () => {
  const a = actions();
  for (const result of [await a.exported.getPatientIntakeIncorporationSnapshot(request.turnoId, scope, request.receiptId),
    await a.exported.patientIntakeIncorporationStatus(request.turnoId, scope, request.operationId),
    await a.exported.cancelPatientIntakeIncorporation(request.turnoId, scope, request.operationId)]) {
    assert.equal(result.ok, true); publicOnly(result);
  }
  assert.ok(!a.calls.includes("service-client"));
  const bad = actions();
  assert.equal((await bad.exported.applyPatientIntakeIncorporation({ ...request, ciphertext: "browser" })).ok, false);
  assert.deepEqual(bad.calls, []);
});
