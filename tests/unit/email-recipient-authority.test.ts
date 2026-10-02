import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { resolveBookingRecipient, validateBookingRecipient, type BookingRecipientAuthority } from "../../lib/email/recipient-authority";
import type { createSupabaseServiceClient } from "../../lib/supabase/server";

const ids = {
  org: "10000000-0000-0000-0000-000000000001", pedido: "10000000-0000-0000-0000-000000000002",
  member: "10000000-0000-0000-0000-000000000003", profile: "10000000-0000-0000-0000-000000000004",
  owner: "10000000-0000-0000-0000-000000000005", ownerProfile: "10000000-0000-0000-0000-000000000006",
  other: "10000000-0000-0000-0000-000000000007",
};
const originalTo = "assigned@example.invalid";
const context: BookingRecipientAuthority = {
  version: 1, organizationId: ids.org, pedidoId: ids.pedido, memberId: ids.member, profileId: ids.profile,
  assignedMemberId: ids.member, selection: "assigned_member", roleAtEnqueue: "PROFESIONAL",
};
function fixture() {
  const rows: Record<string, Record<string, unknown> | null> = {
    pedido: { id: ids.pedido, organization_id: ids.org, profesional_id: ids.member, estado: "PENDIENTE" },
    member: { id: ids.member, organization_id: ids.org, profile_id: ids.profile, role: "PROFESIONAL", deleted_at: null, accepted_at: "2026-01-01", invited_by_id: ids.owner },
    owner: { id: ids.owner, organization_id: ids.org, profile_id: ids.ownerProfile, role: "OWNER", deleted_at: null, accepted_at: null, invited_by_id: null },
    profile: { id: ids.profile, email: originalTo }, ownerProfile: { id: ids.ownerProfile, email: "owner@example.invalid" },
  };
  const queries: { table: string; filters: Record<string, unknown>; columns?: string }[] = [];
  const faults = { table: "", throws: false };
  const client = { from: (table: string) => {
    const query = { table, filters: {} as Record<string, unknown>, columns: "" };
    queries.push(query);
    const chain = {
      select: (columns: string) => { query.columns = columns; return chain; },
      eq: (field: string, value: unknown) => { query.filters[field] = value; return chain; },
      is: (field: string, value: unknown) => { query.filters[field] = value; return chain; },
      order: () => chain, limit: () => chain,
      maybeSingle: async () => {
        if (faults.table === table) {
          if (faults.throws) throw new Error("synthetic lookup timeout");
          return { data: null, error: { code: "synthetic_lookup_failure" } };
        }
        const key = table === "member" && (query.filters.role === "OWNER" || query.filters.id === ids.owner) ? "owner"
          : table === "profile" && query.filters.id === ids.ownerProfile ? "ownerProfile" : table;
        return { data: rows[key], error: null };
      },
    };
    return chain;
  } } as unknown as ReturnType<typeof createSupabaseServiceClient>;
  return { rows, queries, faults, client };
}

test("assigned administrative roles keep their existing self scope; a promotion still authorizes", async () => {
  for (const role of ["OWNER", "DIRECTOR", "PROFESIONAL", "ASISTENTE", "COORDINADOR"]) {
    const f = fixture(); f.rows.member!.role = role;
    assert.deepEqual(await validateBookingRecipient(f.client, ids.org, originalTo, context), { status: "authorized" });
    assert.deepEqual(f.queries.map(q => q.table), ["pedido", "member", "profile"]);
    for (const q of f.queries.slice(0, 2)) assert.equal(q.filters.organization_id, ids.org);
    assert.equal(f.queries[1].filters.id, ids.member);
    assert.equal(f.queries[2].filters.id, ids.profile);
    assert.ok(f.queries.every(q => !/motivo|nombre|cifrado|alcance|escolegiado/.test(q.columns ?? "")));
  }
});

test("selection captures the assigned identities and original email from server rows", async () => {
  const f = fixture();
  assert.deepEqual(await resolveBookingRecipient(f.client, f.client, { organizationId: ids.org, pedidoId: ids.pedido, profesionalId: ids.member }),
    { status: "resolved", to: originalTo, context });
});

test("unassigned request captures oldest OWNER fallback and permits a founder", async () => {
  const f = fixture(); f.rows.pedido!.profesional_id = null;
  const resolved = await resolveBookingRecipient(f.client, f.client, { organizationId: ids.org, pedidoId: ids.pedido });
  assert.equal(resolved.status, "resolved");
  if (resolved.status !== "resolved") assert.fail();
  assert.equal(resolved.context.selection, "owner_fallback");
  assert.equal(resolved.context.memberId, ids.owner);
  assert.equal(resolved.context.assignedMemberId, null);
  assert.deepEqual(await validateBookingRecipient(f.client, ids.org, resolved.to, resolved.context), { status: "authorized" });
  f.rows.owner!.role = "DIRECTOR";
  assert.equal((await validateBookingRecipient(f.client, ids.org, resolved.to, resolved.context)).status, "failed");
});

test("missing assigned member may use OWNER, but a failed member query cannot", async () => {
  const f = fixture(); f.rows.member = null;
  const input = { organizationId: ids.org, pedidoId: ids.pedido, profesionalId: ids.member };
  const resolved = await resolveBookingRecipient(f.client, f.client, input);
  assert.equal(resolved.status, "resolved");
  if (resolved.status === "resolved") assert.equal(resolved.context.selection, "owner_fallback");
  f.queries.length = 0; f.faults.table = "member";
  assert.deepEqual(await resolveBookingRecipient(f.client, f.client, input), { status: "failed", detail: "email_recipient_lookup_failed", retryable: true });
  assert.equal(f.queries.filter(q => q.table === "member").length, 1);
});

test("authority, identity, organization, request state and address changes fail closed", async t => {
  const changes: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ["revoked", f => { f.rows.member!.deleted_at = "2026-10-02"; }],
    ["not accepted", f => { f.rows.member!.accepted_at = null; }],
    ["member absent", f => { f.rows.member = null; }],
    ["member identity", f => { f.rows.member!.id = ids.other; }],
    ["member tenant", f => { f.rows.member!.organization_id = ids.other; }],
    ["profile binding", f => { f.rows.member!.profile_id = ids.other; }],
    ["role lost", f => { f.rows.member!.role = "UNKNOWN"; }],
    ["profile absent", f => { f.rows.profile = null; }],
    ["profile identity", f => { f.rows.profile!.id = ids.other; }],
    ["address changed", f => { f.rows.profile!.email = "new@example.invalid"; }],
    ["address representation", f => { f.rows.profile!.email = originalTo.toUpperCase(); }],
    ["request absent", f => { f.rows.pedido = null; }],
    ["request identity", f => { f.rows.pedido!.id = ids.other; }],
    ["request tenant", f => { f.rows.pedido!.organization_id = ids.other; }],
    ["request confirmed", f => { f.rows.pedido!.estado = "CONFIRMADO"; }],
    ["request reassigned", f => { f.rows.pedido!.profesional_id = ids.other; }],
  ];
  for (const [name, change] of changes) await t.test(name, async () => {
    const f = fixture(); change(f);
    assert.deepEqual(await validateBookingRecipient(f.client, ids.org, originalTo, context), { status: "failed", detail: "email_recipient_authority_lost", retryable: false });
    assert.ok(f.queries.every(q => q.filters.role !== "OWNER"));
  });
});

test("legacy, malformed and wrong-tenant contexts never infer recipients from email", async () => {
  for (const value of [undefined, null, {}, { ...context, version: 2 }, { ...context, profileId: "invalid" }, { ...context, selection: "unknown" }, { ...context, assignedMemberId: null }]) {
    const f = fixture();
    assert.deepEqual(await validateBookingRecipient(f.client, ids.org, originalTo, value), { status: "failed", detail: "email_recipient_context_missing", retryable: false });
    assert.equal(f.queries.length, 0);
  }
  const f = fixture();
  assert.deepEqual(await validateBookingRecipient(f.client, ids.other, originalTo, context), { status: "failed", detail: "email_recipient_authority_lost", retryable: false });
  assert.equal(f.queries.length, 0);
});

test("each backend lookup error or timeout is retryable, never authority loss", async () => {
  for (const table of ["pedido", "member", "profile"]) for (const throws of [false, true]) {
    const f = fixture(); Object.assign(f.faults, { table, throws });
    const failed = { status: "failed", detail: "email_recipient_lookup_failed", retryable: true };
    assert.deepEqual(await validateBookingRecipient(f.client, ids.org, originalTo, context), failed);
    assert.deepEqual(await resolveBookingRecipient(f.client, f.client, { organizationId: ids.org, pedidoId: ids.pedido, profesionalId: ids.member }), failed);
    assert.ok(f.queries.every(q => q.filters.role !== "OWNER"));
  }
});

test("preparation rejects obsolete assignment and invalid membership without enqueuing", async () => {
  const f = fixture();
  const input = { organizationId: ids.org, pedidoId: ids.pedido, profesionalId: ids.other };
  assert.deepEqual(await resolveBookingRecipient(f.client, f.client, input), { status: "failed", detail: "email_recipient_authority_lost", retryable: false });
  assert.equal(f.queries.length, 1);
  f.rows.member!.accepted_at = null;
  assert.equal((await resolveBookingRecipient(f.client, f.client, { ...input, profesionalId: ids.member })).status, "failed");
});

test("actual notifyPedidoNuevo captures encrypted authority; preparation failures never enqueue", async () => {
  const f = fixture();
  f.rows.organization = { nombre: "Synthetic organization", timezone: "UTC" };
  const enqueued: Record<string, unknown>[] = [];
  const exports: Record<string, (input: unknown) => Promise<unknown>> = {};
  runInNewContext(ts.transpileModule(readFileSync("lib/email/notify.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Intl, Date, require: (name: string) => {
    if (name.includes("supabase/server")) return { createSupabaseServiceClient: () => f.client };
    if (name === "./recipient-authority") return { resolveBookingRecipient };
    if (name === "./durable") return { deliverDurableEmail: async (input: Record<string, unknown>) => { enqueued.push(input); return { status: "queued", detail: "synthetic_queue" }; } };
    if (name.includes("config/app-url")) return { getAppUrl: () => "http://127.0.0.1:4410" };
    if (name.includes("support")) return { SUPPORT_EMAIL: "support@example.invalid" };
    if (name === "./templates/pedido-nuevo") return { canalPedidoLabel: () => "Web", buildPedidoNuevoEmail: () => ({ subject: "Synthetic notice", html: "Synthetic request" }) };
    return {};
  } });
  const input = { client: f.client, organizationId: ids.org, pedidoId: ids.pedido, profesionalId: ids.member,
    pacienteNombre: "Synthetic patient", canal: "WEB", fechaPropuestaIso: null };
  await exports.notifyPedidoNuevo(input);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].kind, "booking_request");
  assert.equal(enqueued[0].dedupeKey, `pedido:${ids.pedido}`);
  assert.equal(enqueued[0].to, originalTo);
  assert.deepEqual(enqueued[0].recipientAuthority, context);
  f.faults.table = "member";
  const failure = await exports.notifyPedidoNuevo(input);
  // VM objects have another prototype; compare serialized public results only.
  assert.equal(JSON.stringify(failure), JSON.stringify({ status: "failed", detail: "email_recipient_lookup_failed", retryable: true }));
  assert.equal(enqueued.length, 1);
  f.faults.table = "organization";
  await exports.notifyPedidoNuevo(input);
  assert.equal(enqueued.length, 1);
});
