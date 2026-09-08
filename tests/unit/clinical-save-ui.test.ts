import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import ts from "typescript";
const actual=createRequire(import.meta.url);
// The VM executes the actual editor and React handlers; only rendering and I/O are replaced.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Element={type:unknown;props:Record<string,any>};
function tree(value:unknown):Element[]{if(Array.isArray(value))return value.flatMap(tree);if(!value||typeof value!=="object"||!("props" in value))return [];const e=value as Element;return [e,...tree(e.props.children)];}
function text(value:unknown):string{if(Array.isArray(value))return value.map(text).join(" ");if(value&&typeof value==="object"&&"props" in value)return text((value as Element).props.children);return typeof value==="string"?value:"";}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const slots:unknown[]=[];let cursor=0;
 const navigation:string[]=[];
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const requests:Array<{input:any;closed:boolean;resolve:(value:any)=>void;reject:(error:Error)=>void}>=[];
 const context={paciente:{id:randomUUID(),nombre:"Paciente sintético",edad:30},especialidad:"psicologia",organizacionNombre:"Sintético",notas:[],plan:{radiografias:[],estudiosAdjuntos:[],toolHistorial:[],turnoActivo:{id:randomUUID(),sesionRevision:0,sesionUpdatedAt:null as string|null,modo:"en_curso",estado:"ATENDIENDO",inicio:"2026-09-08T15:00:00Z",soapDraft:null,toolDraft:null,soapPrevio:null}}};
 const react={useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==="function"?initial():initial;return [slots[i],(value:unknown)=>{slots[i]=typeof value==="function"?value(slots[i]):value;}];},useRef:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect:()=>{},useMemo:(fn:()=>unknown)=>fn()};
 const exports:{editor?:()=>Element}={};const source=readFileSync("components/paciente/paciente-detalle.tsx","utf8");
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText+'\nexports.editor=TabPlan;';
 const jsx=(type:unknown,props:Record<string,unknown>)=>({type,props});
 runInNewContext(js,{exports,structuredClone,Date,Intl,JSON,crypto:{randomUUID},window:{location:{reload:()=>navigation.push("reload")}},require:(name:string)=>{
  if(name==="react")return react;
  if(name==="react/jsx-runtime")return {jsx,jsxs:jsx,Fragment:"fragment"};
  if(name==="next/navigation")return {useRouter:()=>({refresh:()=>navigation.push("refresh"),push:(url:string)=>navigation.push(url)})};
  if(name==="@/components/paciente/contexto")return {usePacienteFicha:()=>context};
  if(name==="@/lib/especialidades/registry")return {getEspecialidad:()=>({Icon:"icon",Tool:"tool",badgeLabel:"Clínica",soapGuia:{}}),filtrarToolHistorial:()=>[]};
  if(name==="@/app/(app)/pacientes/actions")return {saveSesionFichaAction:(input:unknown)=>new Promise((resolve,reject)=>requests.push({input,closed:false,resolve,reject})),saveSesionYCerrarAction:(input:unknown)=>new Promise((resolve,reject)=>requests.push({input,closed:true,resolve,reject}))};
  if(["@/lib/ficha/clinical-save-coordinator","@/lib/ficha/borrador"].includes(name))return actual(resolve(name.slice(2)));
  return {};
 }});
 const render=()=>{cursor=0;return exports.editor!();};
 const button=(label:string)=>tree(render()).find(e=>e.type==="button"&&text(e).trim()===label)!;
 const edit=(value:string)=>{const editor=tree(render()).find(e=>typeof e.props.setSoap==="function")!;editor.props.setSoap({...editor.props.soap,subjetivo:value});render();};
 const ack=(i:number)=>{const r=requests[i];r.resolve({ok:true,data:{sesionId:randomUUID(),revision:r.input.revisionEsperada+1,updatedAt:"2026-09-08T15:00:00Z",operationId:r.input.operacionId,cerrado:r.closed}});};
 return {context,requests,navigation,render,button,edit,ack};
}
test("actual editor serializes double click and pending close, retaining late edits after save",async()=>{
 const f=fixture();f.edit("first");const save=f.button("Guardar sesión"),close=f.button("Guardar y cerrar");save.props.onClick();save.props.onClick();close.props.onClick();assert.equal(f.requests.length,1);
 f.edit("second while pending");f.ack(0);await settle();f.context.plan.turnoActivo.sesionRevision=999;f.render();f.button("Guardar sesión").props.onClick();assert.equal(f.requests[1].input.revisionEsperada,1);assert.equal(f.requests[1].input.soap.subjetivo,"second while pending");
});
test("actual editor retries lost response with original operation and preserves newly typed content",async()=>{
 const f=fixture();f.edit("submitted");f.button("Guardar sesión").props.onClick();f.requests[0].reject(Error("transport"));await settle();f.edit("later");const retry=f.button("Confirmar operación pendiente");assert.ok(retry);retry.props.onClick();assert.equal(f.requests[1].input.operacionId,f.requests[0].input.operacionId);assert.equal(f.requests[1].input.soap.subjetivo,"submitted");f.ack(1);await settle();assert.equal(tree(f.render()).find(e=>typeof e.props.setSoap==="function")!.props.soap.subjetivo,"later");
});
test("actual editor blocks conflict overwrite and requires recovery before reload",async()=>{
 const f=fixture();f.edit("mine");f.button("Guardar sesión").props.onClick();f.requests[0].resolve({ok:false,error:{code:"conflict",message:"Changed"}});await settle();f.edit("mine again");assert.equal(f.button("Guardar sesión").props.disabled,true);f.button("Guardar sesión").props.onClick();assert.equal(f.requests.length,1);assert.equal(f.button("Recargar la versión guardada para revisar").props.disabled,true);
});
test("actual close does not navigate away from edits typed after its snapshot",async()=>{
 const f=fixture();f.edit("final submitted");f.button("Guardar y cerrar").props.onClick();f.edit("late amendment draft");f.ack(0);await settle();assert.ok(!f.navigation.includes("/hoy"));assert.match(text(f.render()),/enmienda/);assert.equal(f.button("Guardar sesión").props.disabled,true);
});
test("refreshed appointment cannot silently receive another encounter's draft",()=>{
 const f=fixture();f.edit("old encounter");f.context.plan.turnoActivo.id=randomUUID();const save=f.button("Guardar sesión");assert.equal(save.props.disabled,true);save.props.onClick();assert.equal(f.requests.length,0);assert.match(text(f.render()),/no se enviará a otra visita/);
});

test("pending operation can be confirmed against its original anchor after a server refresh",async()=>{
 const f=fixture();f.edit("original encounter");f.button("Guardar sesión").props.onClick();const original=f.requests[0].input;
 f.requests[0].reject(Error("lost response"));await settle();f.context.plan.turnoActivo.id=randomUUID();f.render();
 f.button("Confirmar operación pendiente").props.onClick();assert.equal(f.requests.length,2);
 assert.equal(f.requests[1].input.turnoId,original.turnoId);assert.equal(f.requests[1].input.pacienteId,original.pacienteId);assert.equal(f.requests[1].input.operacionId,original.operacionId);
 f.ack(1);await settle();assert.equal(f.button("Guardar sesión").props.disabled,true);
});
