import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import test from "node:test";
import ts from "typescript";
const actual=createRequire(import.meta.url);
type Element={type:string;props:Record<string,any>}; // eslint-disable-line @typescript-eslint/no-explicit-any
function fixture(){
 const values:unknown[]=[];let cursor=0;const calls:Array<{kind:string;input?:unknown}>=[];
 const exports:{FirmaCanvasModal?:(props:unknown)=>Element}={};
 const js=ts.transpileModule(readFileSync("components/paciente/firma-canvas-modal.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const make=(type:string,props:Record<string,unknown>)=>({type,props});
 runInNewContext(js,{exports,Date,require:(name:string)=>{
  if(name==="react/jsx-runtime")return {jsx:make,jsxs:make,Fragment:"fragment"};
  if(name==="react")return {useState:(initial:unknown)=>{const key=cursor++;if(!(key in values))values[key]=initial;return [values[key],(v:unknown)=>{values[key]=v;}];},useRef:()=>({current:null}),useCallback:(f:unknown)=>f,useMemo:(f:()=>unknown)=>f()};
  if(name==="@/lib/use-modal-a11y")return {useModalA11y:()=>{}};
  if(name.includes("consentimiento-evaluacion-actions"))return {createConsentAssessmentAction:async(input:unknown)=>{calls.push({kind:"assessment",input});return {ok:true,data:{id:"assessment"}};}};
  if(name==="@/app/(app)/pacientes/actions")return {uploadFirmaConsentimientoAction:async()=>{calls.push({kind:"signature"});return {ok:true};}};
  return actual(name.startsWith("@/")?resolve(name.slice(2)):name);
 }});
 const render=()=>{cursor=0;return exports.FirmaCanvasModal!({pacienteId:"patient",pacienteNombre:"Paciente sintético adolescente",plantillas:[{id:"template",tipo:"TRATAMIENTO_MENOR",titulo:"Acto revisado",version:1,textoMarkdown:"Texto completo"}],tutores:[],onClose:()=>{},onCreated:()=>calls.push({kind:"completed"})});};
 return {render,calls};
}
function nodes(node:unknown):Element[]{if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=="object"||!("props" in node))return [];const e=node as Element;return [e,...nodes(e.props.children)];}
function text(node:unknown):string{if(Array.isArray(node))return node.map(text).join(" ");if(node&&typeof node==="object"&&"props" in node)return text((node as Element).props.children);return typeof node==="string"?node:"";}
function fill(f:ReturnType<typeof fixture>,mode?:string){
 let tree=nodes(f.render());const areas=tree.filter(e=>e.type==="textarea");areas[0].props.onChange({target:{value:"Evaluación del acto documentada por el profesional"}});areas[1].props.onChange({target:{value:"Se documenta la participación expresada por el paciente"}});
 tree.find(e=>e.type==="input"&&e.props.type==="date")!.props.onChange({target:{value:"2099-01-01"}});
 if(mode){const selects=tree.filter(e=>e.type==="select");selects[0].props.onChange({target:{value:mode}});selects[1].props.onChange({target:{value:"EVALUADO"}});}
 tree=nodes(f.render());return tree.find(e=>e.type==="button"&&/Guardar evaluación/.test(text(e)))!;
}
test("consent interface starts pending even for a minor template and preserves care without a signature",async()=>{
 const f=fixture();assert.match(text(f.render()),/ni impide registrar la atención/);const button=fill(f);assert.match(text(button),/pendiente/);button.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.calls.map(c=>c.kind),["assessment","completed"]);assert.equal((f.calls[0].input as {decision:{modo:string}}).decision.modo,"PENDIENTE");
});
test("consent interface cannot advance assisted signing without verified representation",async()=>{
 const f=fixture();const button=fill(f,"ASISTIDO");button.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,0);assert.match(text(f.render()),/representación verificada y vigente/);
});
