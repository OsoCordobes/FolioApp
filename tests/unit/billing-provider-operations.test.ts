import assert from "node:assert/strict";
import test from "node:test";
import { runProviderOperation } from "../../lib/billing/provider-operations";
const providerInfo={providerSubscriptionId:"created",status:"PENDIENTE",amountCents:3000000,currency:"ARS",payerEmail:null,externalReference:"folio_operation_op",checkoutUrl:"https://example.invalid/checkout",nextChargeDate:null,lastModified:"2026-09-08T10:00:00Z",liveMode:true};
function fixture(config:{phase?:string;kind?:string;matches?:number;remoteAmount?:number;busy?:boolean;finishError?:boolean}={}) {
 const calls:string[]=[]; const writes:Record<string,unknown>[]=[];
 const chain={select:()=>chain,eq:()=>chain,update:(value:Record<string,unknown>)=>{writes.push(value);return chain;},single:async()=>({data:{payer_email:"synthetic@example.invalid"},error:null})};
 const client={from:()=>chain,rpc:async(name:string)=>{
  calls.push(name);
  if(name==="billing_claim_operation")return {data:config.busy?null:{id:"op",organization_id:"org",subscription_id:"sub",kind:config.kind??"create",phase:config.phase??"create",amount_cents:3000000,previous_preapproval_id:config.kind?"previous":null,status:"processing",idempotency_key:"stable",lease_token:"token",attempts:2},error:null};
  if(name==="billing_mark_operation_write")return {data:true,error:null};
  return {data:config.finishError?null:{id:"sub",monto_cents:3000000},error:config.finishError?{}:null};
 }};
 const provider={name:"synthetic",findSubscriptionsForOperation:async()=>{calls.push("search");return Array.from({length:config.matches??1},()=>providerInfo);},
 fetchSubscription:async()=>{calls.push("fetch");return {...providerInfo,providerSubscriptionId:"previous",amountCents:config.remoteAmount??3000000};},
 createSubscription:async()=>{calls.push("CREATE");return {subscription:providerInfo,checkoutUrl:providerInfo.checkoutUrl};},
 updateSubscriptionAmount:async()=>{calls.push("UPDATE");return providerInfo;},cancelSubscription:async()=>{calls.push("CANCEL");return {...providerInfo,status:"CANCELADA"};}};
 return {deps:{client,provider},calls,writes};
}
test("uncertain creation with no observed provider match never repeats POST",async()=>{
 const f=fixture({matches:0});const r=await runProviderOperation("op",f.deps as never);
 assert.equal(r.ok,false);assert.ok(f.calls.includes("search"));assert.ok(!f.calls.includes("CREATE"));assert.equal(f.writes[0].status,"uncertain");
});
test("uncertain creation recovers exact provider fact then atomically completes",async()=>{
 const f=fixture();const r=await runProviderOperation("op",f.deps as never);
 assert.equal(r.ok,true);assert.deepEqual(f.calls,["billing_claim_operation","search","billing_complete_operation"]);
});
test("ambiguous provider matches require manual resolution without another charge",async()=>{
 const f=fixture({matches:2});const r=await runProviderOperation("op",f.deps as never);
 assert.equal(r.ok,false);assert.equal(f.writes[0].status,"terminal");assert.ok(!f.calls.includes("CREATE"));
});
test("new mutation persists its phase before calling provider",async()=>{
 const f=fixture({phase:"pending"});await runProviderOperation("op",f.deps as never);
 assert.deepEqual(f.calls,["billing_claim_operation","billing_mark_operation_write","CREATE","billing_complete_operation"]);
});
test("uncertain price write reads authoritative value and never blindly repeats PUT",async()=>{
 const f=fixture({kind:"amount",phase:"amount",remoteAmount:2000000});const r=await runProviderOperation("op",f.deps as never);
 assert.equal(r.ok,false);assert.ok(f.calls.includes("fetch"));assert.ok(!f.calls.includes("UPDATE"));
});
test("observed target price repairs local state without another PUT",async()=>{
 const f=fixture({kind:"amount",phase:"amount"});const r=await runProviderOperation("op",f.deps as never);
 assert.equal(r.ok,true);assert.ok(!f.calls.includes("UPDATE"));assert.ok(f.calls.includes("billing_complete_operation"));
});
test("busy operation lease makes no external request",async()=>{
 const f=fixture({busy:true});await runProviderOperation("op",f.deps as never);assert.deepEqual(f.calls,["billing_claim_operation"]);
});
test("provider success plus DB failure stays unresolved for observational repair",async()=>{
 const f=fixture({finishError:true});const r=await runProviderOperation("op",f.deps as never);assert.equal(r.ok,false);assert.equal(f.writes[0].status,"uncertain");
});
