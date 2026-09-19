import assert from "node:assert/strict";
import test from "node:test";
import { encryptColumn } from "../../lib/crypto";
import { buildClinicalExport } from "../../lib/patient/clinical-export";
import type { createSupabaseServerClient } from "../../lib/supabase/server";
const org="11600000-0000-4000-8000-000000000001",patient="11600000-0000-4000-8000-000000000002";
type Row={id:string}&Record<string,unknown>;
function fixture(extra:Record<string,Row[]>={}, failTable?:string, mutate=false){
 const calls:Record<string,number>={};
 return {from(table:string){let start=0,end=499;calls[table]=(calls[table]??0)+1;const query={
  select(){return query},eq(key:string,value:string){if(key==='organization_id')assert.equal(value,org);if(key==='paciente_id')assert.equal(value,patient);return query},in(){return query},is(){return query},order(){return query},
  range(a:number,b:number){start=a;end=b;return query},
  then(resolve:(v:unknown)=>unknown){let rows=(extra[table]??[]).map(row=>({organization_id:org,paciente_id:patient,...row}));if(mutate&&table==='instrumento_respuesta'&&calls[table]>1)rows=rows.map(r=>({...r,banda:'CHANGED'}));return Promise.resolve(resolve({data:rows.slice(start,Math.min(end+1,start+111)),count:rows.length,error:failTable===table?{message:'PRIVATE SDK DATA'}:null}));}
 };return query;}} as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>;
}
const instrument=(n=1):Row=>({id:`instrument-${n}`,instrumento_id:'historico.v7',instrumento_version:7,respuestas_cifrado:encryptColumn(JSON.stringify({respuestas:[1,2,3],nota:'Registro sintético'})),score_total:99,banda:'BANDA ORIGINAL',sesion_id:null,completado_por:'profesional',created_at:'2026-09-08',updated_at:'2026-09-08',locked_at:null});
test('clinical export preserves every instrument response, recorded score and historical version',async()=>{
 const r=await buildClinicalExport(fixture({instrumento_respuesta:Array.from({length:1201},(_,i)=>instrument(i))}),org,patient);assert.equal(r.ok,true);if(!r.ok)return;
 const data=r.data as unknown as {instrumentos:Record<string,unknown>[]};assert.equal(data.instrumentos?.length,1201);assert.equal(data.instrumentos[1200].instrumento_version,7);assert.equal(data.instrumentos[0].score_total,99);assert.equal(data.instrumentos[0].banda,'BANDA ORIGINAL');assert.deepEqual(data.instrumentos[0].respuestas,{respuestas:[1,2,3],nota:'Registro sintético'});
});
test('clinical document inventory does not claim included bytes or expose storage paths',async()=>{
 const id='11600000-0000-4000-8000-000000000003';const r=await buildClinicalExport(fixture({documento_clinico:[{id,storage_bucket:'documentos-clinicos',storage_path:`documentos-clinicos/${org}/${patient}/synthetic.pdf`,mime_type:'application/pdf',tamanio_bytes:123,content_sha256:'a'.repeat(64),descripcion_cifrado:encryptColumn('Descripción sintética'),deleted_at:null}]}),org,patient);assert.equal(r.ok,true);if(!r.ok)return;
 const d=(r.data as unknown as {documentos:Record<string,unknown>[]}).documentos?.[0];assert.ok(d);assert.equal(d.bytes_incluidos,false);assert.equal(d.download_url,`/api/documentos/${id}/archivo`);assert.equal(JSON.stringify(d).includes('synthetic.pdf'),false);
});
for(const table of ['instrumento_respuesta','documento_clinico','consentimiento','consentimiento_evaluacion'])test(`clinical export fails on unreadable collection ${table}`,async()=>{const r=await buildClinicalExport(fixture({},table),org,patient);assert.equal(r.ok,false);assert.equal(JSON.stringify(r).includes('PRIVATE SDK DATA'),false)});
test('clinical export refuses corrupted instrument JSON',async()=>{const r=await buildClinicalExport(fixture({instrumento_respuesta:[{...instrument(),respuestas_cifrado:encryptColumn('not json')}]}),org,patient);assert.equal(r.ok,false)});
test('clinical export detects same-count instrument edits between reads',async()=>{const r=await buildClinicalExport(fixture({instrumento_respuesta:[instrument()]},undefined,true),org,patient);assert.equal(r.ok,false)});


test('consent evidence preserves both participants and immutable assessment snapshots without raw Storage URLs', async () => {
 const cid='11600000-0000-4000-8000-000000000004';
 const assessment={id:'assessment',fundamento_cifrado:encryptColumn('Razón sintética'),participacion_cifrado:encryptColumn('Participación sintética'),
  paciente_identidad_snapshot:{nombre_cifrado:encryptColumn('Nombre original')},representante_snapshot:{nombre_cifrado:encryptColumn('Representante original')},version_snapshot:3};
 const consentimiento={id:cid,evaluacion_id:'assessment',evidencia_estado:'REGISTRADA',texto_snapshot:'Texto original confirmado',version_snapshot:3,
  participantes:['PACIENTE','REPRESENTANTE'].map((rol,i)=>({rol,path:`consentimientos-firmados/${org}/${patient}/firma${i}.png`,sha256:'a'.repeat(64),persona_ref:String(i)}))};
 const result=await buildClinicalExport(fixture({consentimiento:[consentimiento],consentimiento_evaluacion:[assessment]}),org,patient);
 assert.equal(result.ok,true);if(!result.ok)return;
 const evidence=result.data.consentimientos_evidencia[0];assert.equal(evidence.texto_snapshot,'Texto original confirmado');
 const signatures=evidence.firmas as Record<string,unknown>[];assert.equal(signatures.length,2);assert.equal(signatures[1].download_url,`/api/consentimientos/${cid}/firma?participante=1`);
 assert.equal(signatures[1].bytes_verificados,false);assert.equal(JSON.stringify(result.data).includes('firma1.png'),false);
 assert.deepEqual(result.data.evaluaciones_consentimiento[0].representante_snapshot,{nombre:'Representante original'});
});
for (const failure of ['missing-assessment','outside-path','corrupt-snapshot']) test(`consent inventory rejects ${failure}`,async()=>{
 const assessment={id:'assessment',fundamento_cifrado:encryptColumn('Razón'),participacion_cifrado:encryptColumn('Participación'),
  representante_snapshot:{nombre_cifrado:failure==='corrupt-snapshot'?'broken':encryptColumn('Sintético')}};
 const consent={id:'consent',evaluacion_id:'assessment',evidencia_estado:'REGISTRADA',texto_snapshot:'Confirmado',version_snapshot:1,
  participantes:[{rol:'PACIENTE',path:`consentimientos-firmados/${failure==='outside-path'?'other':org}/${patient}/firma.png`,sha256:'a'.repeat(64)}]};
 const result=await buildClinicalExport(fixture({consentimiento:[consent],consentimiento_evaluacion:failure==='missing-assessment'?[]:[assessment]}),org,patient);
 assert.equal(result.ok,false);
});

