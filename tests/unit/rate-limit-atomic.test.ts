import assert from "node:assert/strict";
import test from "node:test";
import {rateLimit} from "../../lib/security/rate-limit";

async function configured(fn:()=>Promise<void>) {
  const env = { NODE_ENV:"production", UPSTASH_REDIS_REST_URL:"https://limiter.example.invalid", UPSTASH_REDIS_REST_TOKEN:"synthetic-token", FOLIO_ENC_HMAC_KEY:Buffer.alloc(32,9).toString("base64") };
  const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
  Object.assign(process.env,env);
  try { await fn(); } finally { for(const [k,v] of Object.entries(previous)) { if(v===undefined) delete process.env[k]; else process.env[k]=v; } }
}

test("rate limiter uses one atomic operation and opaque identity, with stable separate scopes", async t=>{
  await configured(async()=>{
    const commands: unknown[][]=[];
    t.mock.method(globalThis,"fetch",async (_url: RequestInfo | URL,init?: RequestInit)=>{
      commands.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({result:[1,60]}));
    });
    const email="synthetic-patient@example.invalid";
    const a=await rateLimit("portal-otp",email,{maxRequests:5,windowSec:60});
    await rateLimit("portal-otp",email,{maxRequests:5,windowSec:60});
    await rateLimit("login",email,{maxRequests:5,windowSec:60});
    assert.deepEqual(a,{ok:true,remaining:4,resetIn:60});
    assert.equal(commands.length,3);
    for (const command of commands) {
      assert.equal(command[0],"EVAL");
      assert.equal(command[2],1);
      assert.match(String(command[3]),/^rl:v2:[a-f0-9]{64}$/);
      assert.equal(command[4],60);
      assert.ok(!JSON.stringify(command).includes(email));
    }
    assert.equal(commands[0][3],commands[1][3]);
    assert.notEqual(commands[0][3],commands[2][3]);
  });
});

test("provider counter/TTL corruption fails closed; a nearly expired limit returns one second",async t=>{
  await configured(async()=>{
    const results:unknown[]=[[2,0],null,["1",60],[0,60],[1,-1],[Number.MAX_VALUE,60],[1,"60"],[1,60,"unexpected"]];
    t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({result:results.shift()})));
    assert.deepEqual(await rateLimit("login","synthetic",{maxRequests:1,windowSec:60}),{ok:false,remaining:0,resetIn:1});
    while(results.length) assert.equal((await rateLimit("login","synthetic",{maxRequests:1,windowSec:60})).ok,false);
  });
});

test("invalid limiter settings cannot create unbounded counters",async t=>{
  await configured(async()=>{
    const fetch=t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({result:[1,60]})));
    for(const options of [{maxRequests:0,windowSec:60},{maxRequests:2.5,windowSec:60},{maxRequests:10,windowSec:0},{maxRequests:10,windowSec:Infinity}]) {
      assert.equal((await rateLimit("login","synthetic",options)).ok,false);
    }
    assert.equal(fetch.mock.calls.length,0);
  });
});
