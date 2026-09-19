import assert from "node:assert/strict";
import test from "node:test";
import { deliveryOutcome, emailDedupeKey, processEmailDelivery } from "../../lib/email/durable";
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
