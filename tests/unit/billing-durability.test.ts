import assert from "node:assert/strict";
import test from "node:test";
import { recordChargeAttempt } from "../../lib/db/suscripcion";
import type { ChargeAttemptInfo } from "../../lib/payments";
const charge: ChargeAttemptInfo = { providerChargeId: "attempt", providerSubscriptionId: "subscription", amountCents: 3000000, currency: "ARS", attemptDate: "2026-09-08T10:00:00Z", payment: {paymentId:"payment",status:"APROBADO",statusDetail:null} };
test("charge orchestration fails when the atomic transaction fails, allowing provider retry", async () => {
  const calls: string[] = [];
  const client = {rpc: async (name: string) => { calls.push(name); return {data:null,error:{code:"23514",message:"outbox unavailable"}}; }};
  const result = await recordChargeAttempt({charge,rawPayload:{email:"must-not-be-copied"}}, client as never);
  assert.equal(result.ok,false);
  assert.deepEqual(calls,["billing_record_charge"]);
});

import { processBillingWebhook } from "../../lib/billing/webhook";
function webhookDeps(config: {claim?:string;claimError?:boolean;applyError?:boolean;completeError?:boolean;providerError?:boolean}={}) {
 const calls:string[]=[];
 const chain={update:()=>chain,eq:()=>chain,select:()=>chain,maybeSingle:async()=>({data:config.completeError?null:{event_key:"key"},error:config.completeError?{message:"write failed"}:null})};
 const deps={
  client:{rpc:async()=>({data:config.claimError?null:{status:config.claim??"claimed",token:"token"},error:config.claimError?{}:null}),from:()=>chain},
  provider:{fetchSubscription:async()=>{calls.push("fetch");if(config.providerError)throw new Error("provider down");return {providerSubscriptionId:"subscription",status:"ACTIVA",liveMode:true};}},
  applySubscription:async()=>{calls.push("apply");return config.applyError?{ok:false,error:{code:"db_error"}}:{ok:true,data:null};},
  recordCharge:async()=>({ok:true,data:{}}),
 };
 return {deps,calls};
}
for(const failure of [{claimError:true},{claim:"busy"},{applyError:true},{completeError:true},{providerError:true}]) {
 test(`webhook requires durable completion: ${JSON.stringify(failure)}`,async()=>{
  const {deps}=webhookDeps(failure);
  assert.equal(await processBillingWebhook({key:"key",topic:"subscription_preapproval",resourceId:"subscription"},deps as never),"retry");
 });
}
test("completed receipt deduplicates before provider fetch",async()=>{
 const {deps,calls}=webhookDeps({claim:"done"});
 assert.equal(await processBillingWebhook({key:"key",topic:"subscription_preapproval",resourceId:"subscription"},deps as never),"done");
 assert.deepEqual(calls,[]);
});
test("incomplete receipt executes again and acknowledges only after completion",async()=>{
 const {deps,calls}=webhookDeps();
 assert.equal(await processBillingWebhook({key:"key",topic:"subscription_preapproval",resourceId:"subscription"},deps as never),"done");
 assert.deepEqual(calls,["fetch","apply"]);
});
