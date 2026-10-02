import assert from 'node:assert/strict';
import test from 'node:test';
import {assertJoinedInputs,JOINED_PROJECT,todayPlan} from '../../scripts/testing/public-booking-joined-proof/prove.mjs';

test('plans today in the organization timezone when UTC is already tomorrow',()=>{
 const plan=todayPlan('2026-10-03T00:00:00Z');
 assert.equal(plan.day,'2026-10-02');assert.equal(plan.start,'2026-10-03T02:00:00.000Z');
 assert.equal(plan.end,'2026-10-03T02:30:00.000Z');assert.equal(plan.hora,'23:00');
 assert.equal(plan.horaFin,'23:30');assert.equal(plan.weekday,5);
});
test('fails when today cannot contain a future slot, without rolling to tomorrow',()=>{
 assert.throws(()=>todayPlan('2026-10-03T00:01:00Z'),/joined_no_future_slot_today/);
 assert.throws(()=>todayPlan('invalid'),/joined_clock_invalid/);
});
test('rounds to a complete 30 minute future slot across organization midnight',()=>{
 const plan=todayPlan('2026-10-03T03:01:59Z');
 assert.equal(plan.day,'2026-10-03');assert.equal(plan.hora,'02:30');
 assert.equal(plan.start,'2026-10-03T05:30:00.000Z');
 assert.equal(plan.weekday,6);
});
const key=role=>`x.${Buffer.from(JSON.stringify({iss:'supabase-local',role})).toString('base64url')}.x`;
function fixture(){
 return {isolation:{project:JOINED_PROJECT,githubActions:'true',runnerEnvironment:'github-hosted',platform:'linux',fresh:true,internalNetwork:true},
  config:{mode:'app',appUrl:'http://127.0.0.1:4410',supabaseUrl:'http://127.0.0.1:55421',anonKey:key('anon'),
   serviceKey:key('service_role'),databaseUrl:'postgresql://postgres:synthetic@127.0.0.1:55422/postgres',realSupabase:true,clinical:true},
  scope:Object.fromEntries(['org','member','patient','servicio','integration'].map(name=>[name,'11111111-1111-4111-8111-111111111111'])),
  browserCookies:[{name:'sb-local-auth-token',value:'synthetic',domain:'127.0.0.1',path:'/'}]};
}
test('preflight rejects local, reused, external or unguarded execution',()=>{
 for(const [name,value] of [['githubActions','false'],['runnerEnvironment','self-hosted'],['platform','win32'],['fresh',false],['internalNetwork',false],['project','folio_google_internal_proof']]){
  const input=fixture();input.isolation[name]=value;assert.throws(()=>assertJoinedInputs(input));
 }
 const symbol=Symbol.for('folio.test.isolation'),original=globalThis[symbol];
 try{globalThis[symbol]=false;assert.throws(()=>assertJoinedInputs(fixture()),/joined_io_guard_missing/);}
 finally{globalThis[symbol]=original;}
});
test('preflight uses the real app validator for hosted keys, external DB and ordinary server',()=>{
 assert.doesNotThrow(()=>assertJoinedInputs(fixture()));
 for(const [name,value] of [['databaseUrl','postgresql://postgres:x@db.example.invalid/postgres'],
  ['appUrl','http://127.0.0.1:3000'],['supabaseUrl','https://example.supabase.co'],
  ['serviceKey',`x.${Buffer.from(JSON.stringify({iss:'supabase-local',role:'service_role',ref:'hosted'})).toString('base64url')}.x`]]){
  const input=fixture();input.config[name]=value;assert.throws(()=>assertJoinedInputs(input));
 }
 const input=fixture();input.browserCookies[0].domain='localhost';assert.throws(()=>assertJoinedInputs(input));
});
