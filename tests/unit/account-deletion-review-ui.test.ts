import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function compiled(file:string){return ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;}
test('existing request and confirmation render human review without an execution date or automatic erasure promise',async()=>{
 type Element={type:string;props:{children?:unknown;onClick?:()=>Promise<void>}};
 const jsx=(type:string,props:Element['props'])=>({type,props});let state=0;let confirmation:unknown;
 const exports:{DatosClient?:(props:unknown)=>Element}={};
 const imports:Record<string,unknown>={'react':{useState:(initial:unknown)=>[state++===2?true:initial,()=>{}],useTransition:()=>[false,()=>{}]},'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/use-confirm':{useConfirm:()=>({dialogo:null,confirmar:async(value:unknown)=>{confirmation=value;return false;}})},'./actions':{}};
 runInNewContext(compiled('app/(app)/configuracion/datos/datos-client.tsx'),{exports,Date,require:(name:string)=>{if(name in imports)return imports[name];throw Error(name);}});
 const props={email:'synthetic@example.invalid',deletionRequestedAt:'2000-01-01',deletionReason:null,consentSignedAt:null,consentTextVersion:null};
 const render=exports.DatosClient!(props),text=JSON.stringify(render);
 assert.ok(text.includes('Solicitud pendiente de revisión'));assert.ok(!text.includes('se ejecuta el'));assert.ok(!text.includes('30 días'));
 state=0;const form=exports.DatosClient!({...props,deletionRequestedAt:null});
 const elements:Element[]=[];const visit=(value:unknown)=>{if(Array.isArray(value)){value.forEach(visit);return;}if(value&&typeof value==='object'&&'props'in value){const e=value as Element;elements.push(e);visit(e.props.children);}};visit(form);
 await elements.find(e=>e.type==='button'&&e.props.children==='Registrar solicitud de baja')!.props.onClick!();
 const message=JSON.stringify(confirmation);assert.ok(message.includes('No se borrarán automáticamente'));assert.ok(!message.includes('30 días'));
});

for(const missing of [false,true])test(`request and withdrawal only update the verified user's marker (missing row ${missing})`,async()=>{
 const writes:Array<Record<string,unknown>>=[];const filters:Array<[string,unknown]>=[];const calls:string[]=[];
 const q={update:(value:Record<string,unknown>)=>{writes.push(value);return q;},eq:(column:string,value:unknown)=>{filters.push([column,value]);return q;},select:()=>q,maybeSingle:async()=>({data:missing?null:{id:'actor'},error:null})};
 const exports:Record<string,(reason?:string)=>Promise<{ok:boolean;status?:string;scheduledFor?:string}>>={};
 const imports:Record<string,unknown>={'next/cache':{revalidatePath:()=>{}},'@/lib/auth/mfa-access':{verifyMfaSession:async()=>({ok:true,data:{user:{id:'actor'}}})},'@/lib/me/personal-export':{},'@/lib/crypto':{},'@/lib/support':{},'@/lib/supabase/server':{createSupabaseServerClient:async()=>({}),createSupabaseServiceClient:()=>({from:(table:string)=>{calls.push(table);return q;}})}};
 runInNewContext(compiled('app/(app)/configuracion/datos/actions.ts'),{exports,Date,require:(name:string)=>{if(name in imports)return imports[name];throw Error(name);}});
 const request=await exports.requestAccountDeletionAction('synthetic reason');assert.equal(request.ok,!missing);assert.equal(request.scheduledFor,undefined);
 if(!missing)assert.equal(request.status,'manual_review_required');
 const cancel=await exports.cancelAccountDeletionAction();assert.equal(cancel.ok,!missing);
 assert.deepEqual(calls,['profile','profile']);assert.deepEqual(filters,[['id','actor'],['id','actor']]);
 assert.equal(writes[0].deletion_reason,'synthetic reason');assert.equal(typeof writes[0].deletion_requested_at,'string');assert.equal(writes[1].deletion_requested_at,null);assert.equal(writes[1].deletion_reason,null);
});

