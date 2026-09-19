import assert from "node:assert/strict";
import test from "node:test";
import { createPreapproval, updatePreapprovalAmount } from "../../lib/mercadopago/client";

test("provider retries retain idempotency identity across clock boundaries and abort real requests",async()=>{
 const originalFetch=globalThis.fetch; const originalNow=Date.now; const originalToken=process.env.MP_ACCESS_TOKEN;
 const requests:RequestInit[]=[];
 globalThis.fetch=async(_url,init)=>{requests.push(init!);return new Response(JSON.stringify({id:"synthetic"}),{status:200});};
 process.env.MP_ACCESS_TOKEN="synthetic-never-sent";
 try {
  const input={payerEmail:"synthetic@example.invalid",externalReference:"org-synthetic",backUrl:"https://example.invalid",amountArs:30000,idempotencyKey:"activation-stable"};
  Date.now=()=>60000; await createPreapproval(input);
  Date.now=()=>6000000; await createPreapproval(input);
  assert.equal(new Headers(requests[0].headers).get("X-Idempotency-Key"),new Headers(requests[1].headers).get("X-Idempotency-Key"));
  assert.ok(requests[0].signal instanceof AbortSignal);
  assert.ok(requests[1].signal instanceof AbortSignal);
  await updatePreapprovalAmount("synthetic",100); await updatePreapprovalAmount("synthetic",200); await updatePreapprovalAmount("synthetic",100);
  assert.equal(requests[2].body,requests[4].body);
  assert.equal(new Headers(requests[4].headers).get("X-Idempotency-Key"),null,"declarative PUT must not reuse an old A response after B");
 } finally {globalThis.fetch=originalFetch;Date.now=originalNow;if(originalToken===undefined)delete process.env.MP_ACCESS_TOKEN;else process.env.MP_ACCESS_TOKEN=originalToken;}
});
