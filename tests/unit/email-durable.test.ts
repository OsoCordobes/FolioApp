import assert from "node:assert/strict";
import test from "node:test";
import { deliverDurableEmail, deliveryOutcome, emailDedupeKey, processEmailDelivery } from "../../lib/email/durable";
import { decryptColumn, encryptColumn } from "../../lib/crypto";
import type { BookingRecipientAuthority } from "../../lib/email/recipient-authority";
import type { createSupabaseServiceClient } from "../../lib/supabase/server";

test("unknown delivery retries while accepted requires provider receipt", () => {
  assert.equal(deliveryOutcome({status:"uncertain",detail:"provider_response_unknown"}).status,"retryable");
  assert.equal(deliveryOutcome({status:"sent"}).status,"retryable");
  assert.equal(deliveryOutcome({status:"sent",providerId:"receipt"}).status,"accepted");
});
test("dedupe is stable, tenant scoped, and contains no contact plaintext", () => {
  const key = emailDedupeKey("org-a", "booking:user@example.invalid");
  assert.match(key,/^[a-f0-9]{64}$/);
  assert.equal(key,emailDedupeKey("org-a", "booking:user@example.invalid"));
  assert.notEqual(key,emailDedupeKey("org-b", "booking:user@example.invalid"));
});
test("synthetic organizations never reach transport even with corrupt envelope", async () => {
  const outcomes: unknown[] = [];
  const service = {
    from: () => ({select: () => ({eq: () => ({maybeSingle: async () => ({data:{is_synthetic:true},error:null})})})}),
    rpc: async (_name: string, args: unknown) => { outcomes.push(args); return {data:true,error:null}; },
  } as unknown as ReturnType<typeof createSupabaseServiceClient>;
  const result = await processEmailDelivery(service,{id:"job",organization_id:"org",kind:"booking",payload_cifrado:"not-valid",status:"leased",lease_token:"lease",provider_id:null,sanitized_error:null},
    async () => { assert.fail("external delivery attempted"); });
  assert.deepEqual(result,{status:"failed",detail:"organization_delivery_blocked",retryable:false});
  assert.equal((outcomes[0] as {p_status:string}).p_status,"terminal");
});

test("lost acknowledgement retries the identical encrypted envelope with the same provider key", async () => {
  const { encryptColumn, __cryptoTelemetryTestHooks } = await import("../../lib/crypto");
  const previous=process.env.FOLIO_ENC_KEY;
  const previousNext=process.env.FOLIO_ENC_KEY_NEXT;
  process.env.FOLIO_ENC_KEY=Buffer.alloc(32,7).toString("base64");
  delete process.env.FOLIO_ENC_KEY_NEXT;
  __cryptoTelemetryTestHooks.resetKeyCache();
  try {
    let saved=false;
    const service={
      from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{is_synthetic:false,is_internal_account:false,deleted_at:null},error:null})})})}),
      rpc:async()=>({data:saved,error:null}),
    } as unknown as ReturnType<typeof createSupabaseServiceClient>;
    const payload={to:"synthetic@example.invalid",subject:"Administrative notice",html:"Reserved appointment"};
    const row={id:"stable-id",organization_id:"org",kind:"booking",payload_cifrado:encryptColumn(JSON.stringify(payload)),status:"leased",lease_token:"lease-one",provider_id:null,sanitized_error:null};
    const sent: unknown[]=[];
    const transport=async(input:unknown)=>{sent.push(input);return {status:"sent" as const,providerId:"provider-id"};};
    const first=await processEmailDelivery(service,row,transport);
    assert.deepEqual(first,{status:"uncertain",detail:"email_receipt_persist_failed"});
    saved=true;
    const second=await processEmailDelivery(service,{...row,lease_token:"lease-two"},transport);
    assert.deepEqual(second,{status:"sent",providerId:"provider-id"});
    assert.deepEqual(sent[0],sent[1]);
    assert.equal((sent[0] as {idempotencyKey:string}).idempotencyKey,"folio-email/stable-id");
  } finally {
    if(previous===undefined) delete process.env.FOLIO_ENC_KEY; else process.env.FOLIO_ENC_KEY=previous;
    if(previousNext===undefined) delete process.env.FOLIO_ENC_KEY_NEXT; else process.env.FOLIO_ENC_KEY_NEXT=previousNext;
    __cryptoTelemetryTestHooks.resetKeyCache();
  }
});
test("payment review remains actionable and never hydrates a recipient or sends email",async()=>{
  const {processBillingFollowup}=await import("../../lib/email/billing-followups");
  const service={from:()=>assert.fail("review must not load a recipient"),rpc:()=>assert.fail("review must not send")} as unknown as ReturnType<typeof createSupabaseServiceClient>;
  const result=await processBillingFollowup(service,{id:"review",job_type:"payment_review",organization_id:"org",subscription_id:"sub",charge_id:null,lease_token:"lease",idempotency_key:"review"});
  assert.deepEqual(result,{status:"failed",detail:"admin_review_required",retryable:false});
});

const bookingIds = {
  org: "20000000-0000-0000-0000-000000000001", pedido: "20000000-0000-0000-0000-000000000002",
  member: "20000000-0000-0000-0000-000000000003", profile: "20000000-0000-0000-0000-000000000004",
  other: "20000000-0000-0000-0000-000000000005",
};
const bookingContext: BookingRecipientAuthority = {
  version: 1, organizationId: bookingIds.org, pedidoId: bookingIds.pedido, memberId: bookingIds.member,
  profileId: bookingIds.profile, selection: "assigned_member", assignedMemberId: bookingIds.member, roleAtEnqueue: "PROFESIONAL",
};
const bookingMessage = { to: "original@example.invalid", subject: "Administrative notice", html: "Synthetic request", replyTo: "support@example.invalid" };
function bookingFixture(context: unknown = bookingContext) {
  const rows: Record<string, Record<string, unknown> | null> = {
    organization: { is_synthetic: false, is_internal_account: false, deleted_at: null },
    pedido: { id: bookingIds.pedido, organization_id: bookingIds.org, profesional_id: bookingIds.member, estado: "PENDIENTE" },
    member: { id: bookingIds.member, organization_id: bookingIds.org, profile_id: bookingIds.profile, role: "PROFESIONAL", deleted_at: null, accepted_at: "2026-01-01", invited_by_id: bookingIds.other },
    profile: { id: bookingIds.profile, email: bookingMessage.to },
  };
  const row = { id: "stable-booking-job", organization_id: bookingIds.org, kind: "booking_request",
    payload_cifrado: encryptColumn(JSON.stringify({ ...bookingMessage, recipientAuthority: context })),
    status: "leased", lease_token: "first-lease", provider_id: null, sanitized_error: null };
  const queries: string[] = [];
  const finishes: Record<string, unknown>[] = [];
  const state = { failLookup: "", finishData: true, finishError: false, finishThrows: false };
  const service = {
    from: (table: string) => {
      queries.push(table);
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: state.failLookup === table ? null : rows[table], error: state.failLookup === table ? { code: "synthetic_lookup_failure" } : null }),
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "email_finish"); finishes.push(args);
      if (state.finishThrows) throw new Error("synthetic finish timeout");
      // Models only the published terminal cleanup; this is not an SQL execution.
      if (state.finishData && !state.finishError && args.p_status === "terminal") row.payload_cifrado = null;
      return { data: state.finishData, error: state.finishError ? { code: "synthetic_finish_failure" } : null };
    },
  } as unknown as ReturnType<typeof createSupabaseServiceClient>;
  const sent: unknown[] = [];
  const transport = async (input: unknown) => { sent.push(input); return { status: "sent" as const, providerId: "synthetic-receipt" }; };
  return { rows, row, queries, finishes, state, service, sent, transport };
}

test("active booking recipient is validated before transport without context metadata", async () => {
  const f = bookingFixture();
  assert.deepEqual(await processEmailDelivery(f.service, f.row, f.transport), { status: "sent", providerId: "synthetic-receipt" });
  assert.deepEqual(f.queries, ["organization", "pedido", "member", "profile"]);
  assert.deepEqual(f.sent, [{ ...bookingMessage, idempotencyKey: "folio-email/stable-booking-job" }]);
  assert.equal(f.finishes[0].p_status, "accepted");
  assert.equal(f.finishes[0].p_provider_id, "synthetic-receipt");
});

test("revoked, altered or obsolete booking recipients never reach transport; existing terminal RPC closes", async t => {
  const cases: [string, (f: ReturnType<typeof bookingFixture>) => void][] = [
    ["revoked before processing", f => { f.rows.member!.deleted_at = "2026-10-02"; }],
    ["not accepted", f => { f.rows.member!.accepted_at = null; }],
    ["member identity changed", f => { f.rows.member!.id = bookingIds.other; }],
    ["tenant changed", f => { f.rows.member!.organization_id = bookingIds.other; }],
    ["profile rebound", f => { f.rows.member!.profile_id = bookingIds.other; }],
    ["profile absent", f => { f.rows.profile = null; }],
    ["address changed", f => { f.rows.profile!.email = "replacement@example.invalid"; }],
    ["assignment changed", f => { f.rows.pedido!.profesional_id = bookingIds.other; }],
    ["request confirmed", f => { f.rows.pedido!.estado = "CONFIRMADO"; }],
    ["organization deleted", f => { f.rows.organization!.deleted_at = "2026-10-02"; }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const f = bookingFixture(); change(f);
    const result = await processEmailDelivery(f.service, f.row, f.transport);
    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.equal(result.retryable, false);
    assert.equal(f.sent.length, 0);
    assert.equal(f.finishes.length, 1);
    assert.equal(f.finishes[0].p_status, "terminal");
    assert.equal(f.finishes[0].p_id, f.row.id);
    assert.equal(f.finishes[0].p_token, "first-lease");
    assert.equal(f.row.payload_cifrado, null);
    assert.equal(f.row.id, "stable-booking-job");
    assert.ok(!JSON.stringify(f.finishes).includes(bookingMessage.to));
  });
});

test("legacy and invalid booking contexts close terminal without searching by email", async () => {
  for (const context of [undefined, {}, { ...bookingContext, version: 2 }]) {
    const f = bookingFixture(context);
    // An undefined argument selects the fixture default; explicitly encode a legacy envelope.
    if (context === undefined) f.row.payload_cifrado = encryptColumn(JSON.stringify(bookingMessage));
    assert.deepEqual(await processEmailDelivery(f.service, f.row, f.transport), { status: "failed", detail: "email_recipient_context_missing", retryable: false });
    assert.deepEqual(f.queries, ["organization"]);
    assert.equal(f.sent.length, 0);
    assert.equal(f.finishes[0].p_status, "terminal");
  }
});

test("booking lookup errors retain the original envelope for retry; stale/failed finish is uncertain", async () => {
  for (const table of ["pedido", "member", "profile"]) {
    const f = bookingFixture(); f.state.failLookup = table;
    const original = f.row.payload_cifrado;
    assert.deepEqual(await processEmailDelivery(f.service, f.row, f.transport), { status: "failed", detail: "email_recipient_lookup_failed", retryable: true });
    assert.equal(f.sent.length, 0);
    assert.equal(f.finishes[0].p_status, "retryable");
    assert.equal(f.row.payload_cifrado, original);
  }
  for (const failure of ["false", "error", "throw"]) {
    const f = bookingFixture(); f.rows.member!.deleted_at = "2026-10-02";
    Object.assign(f.state, { finishData: false, finishError: failure === "error", finishThrows: failure === "throw" });
    assert.deepEqual(await processEmailDelivery(f.service, f.row, f.transport), { status: "uncertain", detail: "email_receipt_persist_failed" });
    assert.equal(f.sent.length, 0);
    assert.ok(f.row.payload_cifrado);
  }
});

test("lost booking receipt preserves exact retry bytes/key and rechecks revocation", async () => {
  const f = bookingFixture(); f.state.finishData = false;
  const original = f.row.payload_cifrado;
  assert.deepEqual(await processEmailDelivery(f.service, f.row, f.transport), { status: "uncertain", detail: "email_receipt_persist_failed" });
  assert.equal(f.row.payload_cifrado, original);
  f.state.finishData = true;
  assert.deepEqual(await processEmailDelivery(f.service, { ...f.row, lease_token: "second-lease" }, f.transport), { status: "sent", providerId: "synthetic-receipt" });
  assert.deepEqual(f.sent[0], f.sent[1]);
  f.rows.member!.deleted_at = "2026-10-02";
  assert.deepEqual(await processEmailDelivery(f.service, { ...f.row, lease_token: "third-lease" }, f.transport), { status: "failed", detail: "email_recipient_authority_lost", retryable: false });
  assert.equal(f.sent.length, 2);
});

test("captured OWNER cannot be replaced by a new OWNER after access loss", async () => {
  const f = bookingFixture({ ...bookingContext, selection: "owner_fallback", assignedMemberId: null, roleAtEnqueue: "OWNER" });
  f.rows.pedido!.profesional_id = null; f.rows.member!.role = "OWNER";
  assert.equal((await processEmailDelivery(f.service, f.row, f.transport)).status, "sent");
  f.rows.member!.role = "DIRECTOR";
  assert.equal((await processEmailDelivery(f.service, f.row, f.transport)).status, "failed");
  assert.equal(f.sent.length, 1);
});

test("durable re-enqueue recovers original encrypted authority and accepted receipt", async () => {
  const f = bookingFixture();
  const original = f.row.payload_cifrado;
  const enqueued: Record<string, unknown>[] = [];
  let accepted = false;
  const service = {
    from: () => assert.fail("accepted receipt must not resolve another recipient"),
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "email_enqueue"); enqueued.push(args);
      return { data: [{ ...f.row, status: accepted ? "accepted" : "pending", provider_id: accepted ? "old-receipt" : null }], error: null };
    },
  } as unknown as ReturnType<typeof createSupabaseServiceClient>;
  const changedInput = { ...bookingMessage, to: "new-owner@example.invalid", organizationId: bookingIds.org,
    kind: "booking_request", dedupeKey: `pedido:${bookingIds.pedido}`, recipientAuthority: { ...bookingContext, memberId: bookingIds.other } };
  assert.deepEqual(await deliverDurableEmail(changedInput, service), { status: "queued", detail: "delivery_configuration_pending" });
  assert.equal(f.row.payload_cifrado, original);
  assert.deepEqual(await processEmailDelivery(f.service, f.row, f.transport), { status: "sent", providerId: "synthetic-receipt" });
  assert.deepEqual(f.sent, [{ ...bookingMessage, idempotencyKey: "folio-email/stable-booking-job" }]);
  accepted = true;
  assert.deepEqual(await deliverDurableEmail(changedInput, service), { status: "sent", providerId: "old-receipt" });
  assert.equal(f.row.payload_cifrado, original);
  assert.equal(f.sent.length, 1);
  const encoded = JSON.parse(decryptColumn(enqueued[0].p_payload as string)!);
  assert.equal(encoded.recipientAuthority.memberId, bookingIds.other);
  assert.equal(enqueued[0].p_key, emailDedupeKey(bookingIds.org, changedInput.dedupeKey));
  assert.ok(!JSON.stringify(Object.fromEntries(Object.entries(enqueued[0]).filter(([key]) => key !== "p_payload"))).includes("new-owner"));
});
