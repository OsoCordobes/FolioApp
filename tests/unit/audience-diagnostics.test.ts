import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveAudience} from '../../lib/supabase/middleware';
test('audience lookup failures preserve routing behavior and emit only normalized diagnostics',async(t)=>{
 const logs=t.mock.method(console,'warn',()=>{});
 const q={select(){return q},is(){return q},or(){return q},limit(){return q},maybeSingle:async()=>({data:null,error:{code:'42501',message:'patient@example.invalid secret-cookie'}})};
 const client={rpc:async()=>({data:null,error:{code:'PGRST116',message:'patient@example.invalid secret-cookie'}}),from:()=>q};
 assert.deepEqual(await resolveAudience(client as never),{isMember:false,isPortalAccount:false});
 assert.equal(logs.mock.calls.length,2);const text=JSON.stringify(logs.mock.calls.map(c=>c.arguments));assert.match(text,/42501/);assert.match(text,/PGRST116/);assert.doesNotMatch(text,/patient@example|secret-cookie/);
});
