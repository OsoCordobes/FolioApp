import assert from "node:assert/strict";
import test from "node:test";
import { decideMarcaEmailRecordatorio } from "../../lib/db/recordatorios";
import { sendEmail } from "../../lib/email/client";
test("provider acceptance can mark accepted but disabled/simulated/unknown never can", () => {
  assert.equal(decideMarcaEmailRecordatorio({status:"sent",providerId:"receipt"}).marcarEnviado,true);
  for (const status of ["simulated","blocked","queued","uncertain"] as const) {
    const result=decideMarcaEmailRecordatorio({status,detail:"delivery_pending"});
    assert.equal(result.marcarEnviado,false);
    assert.ok(result.errorMsg);
  }
});
test("transport absent configuration stays blocked and never claims receipt", async () => {
  const result=await sendEmail({to:"synthetic@example.invalid",subject:"Test",html:"Synthetic",idempotencyKey:"test"},
    {config:{enabled:true,from:"",apiKey:undefined},transport:async()=>{assert.fail("no network allowed");}});
  assert.deepEqual(result,{status:"blocked",detail:"provider_not_configured"});
});
test("provider failure retains pending work", () => {
  assert.equal(decideMarcaEmailRecordatorio({status:"failed",detail:"provider_http_429",retryable:true}).marcarEnviado,false);
});
