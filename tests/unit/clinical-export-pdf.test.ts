import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { FichaPdfDocument, type FichaPdfData } from "../../lib/pdf/ficha-pdf";
const data: FichaPdfData = {
 organizacion:'Consultorio sintético',profesional:'Profesional de prueba',matricula:null,paciente:'Paciente sintético',edad:'16',genero:'—',motivo:'Registro sintético',fechaSesion:null,
 soap:{s:'',o:'',a:'',p:''},resumenHerramienta:null,especialidad:null,evolucion:[],generadoTs:'2026-09-08T12:00:00Z',
 alcanceEntrega:'Documento de lectura; no incluye bytes de adjuntos ni un archivo restaurable.',
 instrumentos:[{nombre:'Instrumento histórico',instrumentoId:'historico.v7',version:7,total:'99',banda:'BANDA ORIGINAL',fecha:'2026-09-08',respuestas:{items:[1,2,3]},respuestasEstado:'registradas'}],
};
function visible(value: unknown): string {
 if(value==null||typeof value==='boolean')return '';
 if(typeof value==='string'||typeof value==='number')return String(value);
 if(Array.isArray(value))return value.map(visible).join('\n');
 if(typeof value==='object'&&'props' in value)return visible((value as {props:{children?:unknown}}).props.children);
 return '';
}
test('clinical PDF prints original responses/version and an honest delivery scope',()=>{
 const text=visible(FichaPdfDocument({data}));assert.ok(text.includes('historico.v7 · versión 7'));assert.ok(text.includes('BANDA ORIGINAL'));assert.ok(text.includes('"items"'));assert.ok(text.includes('no incluye bytes'));assert.ok(text.includes('99'));
});
test('clinical PDF renders a synthetic readable artifact without reinterpreting original score',()=>{
 // @react-pdf uses the React client reconciler, not the react-server export
 // condition enabled by the general data-layer unit runner. Keep isolation.
 // Yoga loads its bundled WASM as a data URI; decode that in memory while
 // every network request still passes through the central isolation guard.
 const script=`const guardedFetch=globalThis.fetch;globalThis.fetch=(input,...args)=>{const uri=String(input);if(uri.startsWith('data:application/octet-stream;base64,')&&uri.length<2000000)return Promise.resolve(new Response(Buffer.from(uri.slice(uri.indexOf(',')+1),'base64')));return guardedFetch(input,...args)};const {default:mod}=await import('./lib/pdf/ficha-pdf.tsx');const buffer=await mod.buildFichaPdf(${JSON.stringify(data)});if(buffer.subarray(0,4).toString()!=='%PDF'||buffer.length<1000||buffer.length>4194304)process.exit(1);`;
 const child=spawnSync(process.execPath,['--import',pathToFileURL(resolve('scripts/testing/unit-bootstrap.mjs')).href,'--import','tsx','--input-type=module','-e',script],{encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env}});
 assert.equal(child.status,0,child.stderr||child.stdout);
});
test('clinical PDF explicitly labels absent source answers instead of rebuilding them from score',()=>{
 const text=visible(FichaPdfDocument({data:{...data,instrumentos:[{...data.instrumentos[0],respuestas:null,respuestasEstado:'ausentes_en_origen'}]}}));
 assert.ok(text.includes('Respuestas ausentes en el registro de origen'));assert.ok(text.includes('no se reconstruyen desde el puntaje'));
});
