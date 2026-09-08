import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const real=createRequire(import.meta.url),id='11200000-0000-4000-8000-000000000020';
function action(options:{total?:number;loseAck?:boolean;role?:string}={}){
 let loseAck=options.loseAck;
 const calls:string[]=[];const receipts:Array<{fila:number;status:string;code:string}>=[];
 const client={from:()=>{throw Error('Nontransactional import write attempted')},rpc:async(name:string,args:Record<string,unknown>)=>{
 calls.push(name);if(name==='begin_patient_import')return{data:id,error:null};if(name==='patient_import_status')return{data:{id,total:options.total??2,rows:receipts},error:null};
 if(name==='import_patient_row'){const existing=receipts.find(r=>r.fila===args.p_row);const row=existing??{fila:Number(args.p_row),status:'imported',code:'created'};if(!existing)receipts.push(row);if(loseAck){loseAck=false;throw Error('Synthetic lost acknowledgement')}return{data:row,error:null}}throw Error(name);
 }};
 const mocks:Record<string,unknown>={'next/cache':{revalidatePath:()=>{}},'@/lib/db/session':{getActiveSession:async()=>({ok:true,data:{organizationId:id,memberId:id,role:options.role??'OWNER',esColegiado:true}})},'@/lib/supabase/server':{createSupabaseServerClient:async()=>client,createSupabaseServiceClient:()=>{throw Error('Privileged cleanup is forbidden')}},'@/lib/crypto':{encryptColumn:(v:unknown)=>v?'\\x01':null,blindIndex:(v:unknown)=>v?String(v).padEnd(64,'a'):null,blindIndexPhone:()=> 'c'.repeat(64)},'@/lib/observability/events':{trackEvent:{pacientesImported:()=>{}}}};
 const exports:Record<string,(input:unknown)=>Promise<unknown>>={};runInNewContext(ts.transpileModule(readFileSync('app/(app)/configuracion/importar-pacientes/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,JSON,require:(name:string)=>name in mocks?mocks[name]:real(name.startsWith('@/')?resolve(name.slice(2)):name)});
 return{run:exports.importarPacientesAction,calls,receipts};
}
test('actual import action uses durable row transactions and resumes an identical no-DNI file',async()=>{
 const a=action(),input={operacionId:id,organizationId:id,memberId:id,csvText:'Nombre,Apellido,Telefono\nSynthetic,One,3515551100\nSynthetic,Two,3515551100',mapeo:{nombre:0,apellido:1,telefono:2}};
 const first=await a.run(input) as {ok:boolean;data:{importados:number;completo:boolean}},again=await a.run(input) as typeof first;
 assert.equal(first.ok,true);assert.equal(first.data.importados,2);assert.equal(first.data.completo,true);assert.equal(again.data.importados,2);assert.equal(a.receipts.length,2);assert.equal(a.calls.filter(n=>n==='import_patient_row').length,2);
});

test('lost acknowledgement resumes recorded rows without repeating patient creation',async()=>{
 const a=action({loseAck:true}),input={operacionId:id,organizationId:id,memberId:id,csvText:'Nombre,Apellido,Telefono\nSynthetic,One,3515551100\nSynthetic,Two,3515551100',mapeo:{nombre:0,apellido:1,telefono:2}};
 assert.equal((await a.run(input) as {ok:boolean}).ok,false);assert.equal(a.receipts.length,1);
 const resumed=await a.run(input) as {ok:boolean;data:{importados:number}};assert.equal(resumed.ok,true);assert.equal(resumed.data.importados,2);assert.equal(a.receipts.length,2);assert.equal(a.calls.filter(n=>n==='import_patient_row').length,2);
});
test('large imports checkpoint after twenty rows and continue from persisted progress',async()=>{
 const a=action({total:25}),input={operacionId:id,organizationId:id,memberId:id,csvText:'Nombre,Apellido,Telefono\n'+Array.from({length:25},(_,i)=>`Synthetic,Patient${i},3515551100`).join('\n'),mapeo:{nombre:0,apellido:1,telefono:2}};
 const first=await a.run(input) as {data:{completo:boolean;pendientes:number}};assert.equal(first.data.completo,false);assert.equal(first.data.pendientes,5);
 const second=await a.run(input) as {data:{completo:boolean;importados:number}};assert.equal(second.data.completo,true);assert.equal(second.data.importados,25);assert.equal(a.receipts.length,25);
});
test('administrative contact role cannot start a privileged clinical import',async()=>{
 const a=action({role:'ASISTENTE'});const result=await a.run({operacionId:id,organizationId:id,memberId:id,csvText:'N,A,T\nSynthetic,One,3515551100',mapeo:{nombre:0,apellido:1,telefono:2}}) as {ok:boolean};assert.equal(result.ok,false);assert.equal(a.calls.length,0);
});

test('changing the active organization stops before any import read or write',async()=>{
 const a=action();const result=await a.run({operacionId:id,organizationId:'11200000-0000-4000-8000-000000000099',memberId:id,csvText:'N,A,T\nSynthetic,One,3515551100',mapeo:{nombre:0,apellido:1,telefono:2}}) as {ok:boolean};assert.equal(result.ok,false);assert.equal(a.calls.length,0);
});
