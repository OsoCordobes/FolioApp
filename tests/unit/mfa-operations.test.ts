import assert from "node:assert/strict";
import test from "node:test";
import { enrollTotp, confirmTotp } from "../../lib/auth/mfa-operations";
const id = "10100000-0000-4000-8000-000000000040";
const base = { required: true, allowed: false, isStaff: true, hasVerifiedFactor: false, sessionValid: true };
function fixture(options: { existing?: boolean; verifyError?: boolean; foreign?: boolean; stale?: boolean } = {}) {
 const calls:string[]=[]; let confirmed=false;
 return {calls, auth:{
  getUser:async()=>{calls.push("getUser");return {data:{user:{id:"user"}},error:null};},
  mfa:{
   listFactors:async()=>({data:{all:options.foreign?[]:[{id,status:options.existing?"verified":"unverified",factor_type:"totp"}],totp:[],phone:[]},error:null}),
   unenroll:async()=>{calls.push("unenroll");return {data:{},error:null};},
   enroll:async()=>{calls.push("enroll");return {data:{id,type:"totp",totp:{qr_code:"<svg/>",secret:"synthetic-only"}},error:null};},
   challenge:async()=>{calls.push("challenge");return {data:{id:"challenge"},error:null};},
   verify:async()=>{calls.push("verify");confirmed=true;return {data:{},error:options.verifyError?{message:"sensitive auth internals"}:null};},
  },
 },rpc:async()=>({data:{...base,hasVerifiedFactor:options.existing||confirmed,allowed:confirmed&&!options.stale},error:null})};
}
test("enrollment is available to required staff without an existing factor",async()=>{
 const f=fixture();const result=await enrollTotp(f as never,"Principal");
 assert.equal(result.ok,true);assert.deepEqual(f.calls,["getUser","unenroll","enroll"]);
});
test("password-only access cannot enroll a replacement while a verified factor exists",async()=>{
 const f=fixture({existing:true});const result=await enrollTotp(f as never,"Reemplazo");
 assert.equal(result.ok,false);assert.ok(!f.calls.includes("enroll"));assert.ok(!f.calls.includes("unenroll"));
});
test("invalid code is rejected before any Auth call",async()=>{
 const f=fixture();assert.equal((await confirmTotp(f as never,id,"not-an-otp")).ok,false);assert.deepEqual(f.calls,[]);
});
test("malformed action arguments are rejected before any Auth call",async()=>{
 const f=fixture();
 assert.equal((await enrollTotp(f as never,null as never)).ok,false);
 assert.equal((await confirmTotp(f as never,id,123456 as never)).ok,false);
 assert.deepEqual(f.calls,[]);
});
test("preparation does not let AAL1 replace an existing authenticator",async()=>{
 const f=fixture({existing:true});
 f.rpc=async()=>({data:{...base,required:false,allowed:true,hasVerifiedFactor:true,sessionValid:false},error:null});
 assert.equal((await enrollTotp(f as never,"Reemplazo")).ok,false);
 assert.deepEqual(f.calls,["getUser"]);
});
test("only the authenticated user's own listed factor can be challenged",async()=>{
 const f=fixture({foreign:true});assert.equal((await confirmTotp(f as never,id,"123456")).ok,false);assert.ok(!f.calls.includes("challenge"));
});
test("verification makes a challenge, checks the code, and rechecks live authorization",async()=>{
 const f=fixture();assert.equal((await confirmTotp(f as never,id,"123456")).ok,true);assert.deepEqual(f.calls,["getUser","challenge","verify"]);
 const stale=fixture({stale:true});assert.equal((await confirmTotp(stale as never,id,"123456")).ok,false);
});
test("provider errors never echo authentication internals or entered secrets",async()=>{
 const f=fixture({verifyError:true});const result=await confirmTotp(f as never,id,"123456");
 assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes("sensitive"));assert.ok(!JSON.stringify(result).includes("123456"));
});
