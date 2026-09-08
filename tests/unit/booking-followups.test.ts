import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
function worker(state='CONFIRMADO',delivery='queued'){
 const calls:unknown[]=[];const job={id:'job',organization_id:'org',pedido_id:'pedido',turno_id:'turno',kind:'confirmed_email',lease_token:'lease'};
 const rows:Record<string,unknown>={booking_followup_job:{...job,status:'leased',lease_until:'2100-01-01'},organization:{deleted_at:null,is_synthetic:false},pedido:{estado:state,nombre_cifrado:'Synthetic',email_cifrado:'synthetic@example.invalid'},turno:{estado:'CONFIRMADO',deleted_at:null}};
 const client={rpc:async(name:string,args:unknown)=>{calls.push([name,args]);return {data:name==='booking_claim_followups'?[job]:true,error:null}},from:(name:string)=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:rows[name],error:null})};return query;}};
 const exports:Record<string,()=>Promise<Record<string,number>>>={};
 runInNewContext(ts.transpileModule(readFileSync('lib/email/booking-followups.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,require:(name:string)=>name==='server-only'?{}:name.includes('supabase/server')?{createSupabaseServiceClient:()=>client}:name.includes('crypto')?{tryDecrypt:(v:unknown)=>v}:name==='./client'?{emailDeliveryConfiguration:()=>({enabled:true,providerConfigured:true})}:{notifyBookingConfirmada:async()=>{calls.push('send');return{status:delivery}},notifyBookingRecibida:async()=>({status:'queued'}),notifyPedidoNuevo:async()=>({status:'queued'})}});
 return {run:exports.dispatchBookingFollowups,calls};
}
test('durable email enqueue transfers responsibility before finishing booking job',async()=>{const w=worker();const result=await w.run();assert.equal(result.completed,1);assert.equal(w.calls.filter(v=>v==='send').length,1);assert.equal((w.calls.at(-1) as [string,{p_success:boolean}])[1].p_success,true);});
test('obsolete or failed delivery does not become a successful booking followup',async()=>{const stale=worker('RECHAZADO');assert.equal((await stale.run()).terminal,1);assert.equal(stale.calls.includes('send'),false);const failed=worker('CONFIRMADO','failed');assert.equal((await failed.run()).retryable,1);});
