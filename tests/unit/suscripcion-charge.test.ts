import assert from "node:assert/strict";
import test from "node:test";
import { recordChargeAttempt } from "../../lib/db/suscripcion";
import type { ChargeAttemptInfo } from "../../lib/payments";

const charge: ChargeAttemptInfo = { providerChargeId:"attempt",providerSubscriptionId:"subscription",amountCents:3000000,currency:"ARS",attemptDate:"2026-09-08T10:00:00Z",lastModified:"2026-09-08T10:01:00Z",payment:{paymentId:"payment",status:"APROBADO",statusDetail:"provider detail"}};
// State matrix and rollback behavior execute the real SQL RPC in M99_billing_durability.spec.sql.
test("charge orchestration sends authoritative fields only, never raw body or recipient", async () => {
 let params: Record<string, unknown> = {};
 const outcome = {cargo:null,isNewCharge:true,estadoAntes:"MOROSA",estadoDespues:"ACTIVA",organizationId:"org",payerEmail:"owner@example.invalid",montoMensualCents:3000000,mpPreapprovalId:"subscription",morosaDesdeAntes:null};
 const client={rpc:async (name:string,args:Record<string,unknown>)=>{assert.equal(name,"billing_record_charge");params=args;return {data:outcome,error:null};}};
 const result=await recordChargeAttempt({charge,rawPayload:{patient:"private"}},client as never);
 assert.deepEqual(result,{ok:true,data:outcome});
 assert.equal(JSON.stringify(params).includes("private"),false);
 assert.equal(JSON.stringify(params).includes("provider detail"),false);
 assert.equal((params.p_charge as Record<string,unknown>).lastModified,charge.lastModified);
});
test("missing subscription remains retryable not_found",async()=>{
 const result=await recordChargeAttempt({charge,rawPayload:null},{rpc:async()=>({data:null,error:{code:"P0002",message:"subscription_not_linked"}})} as never);
 assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,"not_found");
});
test("missing durable result is an error",async()=>{
 const result=await recordChargeAttempt({charge,rawPayload:null},{rpc:async()=>({data:null,error:null})} as never);
 assert.equal(result.ok,false);
});
test("transport rejection does not escape the DB Result contract",async()=>{
 const result=await recordChargeAttempt({charge,rawPayload:null},{rpc:async()=>{throw new Error("connection interrupted");}} as never);
 assert.equal(result.ok,false);
});
