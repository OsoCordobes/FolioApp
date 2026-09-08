import assert from "node:assert/strict";
import test from "node:test";
import { readPdfCollection, readPdfHistory, decodePdfField } from "../../lib/pdf/history-reader";
import { encryptColumn } from "../../lib/crypto";
import type { createSupabaseServerClient } from "../../lib/supabase/server";
process.env.FOLIO_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.FOLIO_ENC_HMAC_KEY = Buffer.alloc(32, 8).toString("base64");
test("PDF traversal retains 1201 authorized rows beyond PostgREST default", async () => {
 const rows=Array.from({length:1201},(_,i)=>({id:String(i)}));
 const result=await readPdfCollection(async(from,to)=>({data:rows.slice(from,Math.min(to+1,from+111)),count:1201,error:null}));
 assert.equal(result.length,1201);assert.equal(result.at(-1)?.id,"1200");
});
for(const mode of ["late-failure","missing-count","changed-count","duplicate","empty-page","oversize-count"] as const)test(`PDF refuses ${mode}`,async()=>{
 let calls=0;await assert.rejects(()=>readPdfCollection(async()=>{
  calls++;if(calls===1)return{data:[{id:"first"}],count:2,error:null};
  return{data:mode==="empty-page"?[]:[{id:mode==="duplicate"?"first":"second"}],count:mode==="missing-count"?null:mode==="changed-count"?3:mode==="oversize-count"?10001:2,error:mode==="late-failure"?{message:"synthetic"}:null};
 }));
});
test("PDF rejects nonnull empty bytea instead of silently deleting clinical text",()=>{assert.throws(()=>decodePdfField("\\x"));assert.throws(()=>decodePdfField("broken"));assert.equal(decodePdfField(null),null)});
function client(corrupt=false,missing=false){
 const sessions=Array.from({length:62},(_,i)=>({id:`s${i}`,organization_id:"org",paciente_id:"patient",turno_id:`t${i}`,created_at:"2026-09-08",locked_at:null,soap_s_cifrado:encryptColumn(`original ${i}`)}));
 return{from(table:string){let start=0,end=199,ids:string[]=[];const query={
 select(){return query},eq(){return query},order(){return query},in(_key:string,value:string[]){ids=value;return query},range(a:number,b:number){start=a;end=b;return query},
 then(resolve:(r:unknown)=>unknown){const rows=table==="sesion"?sessions:table==="turno"?ids.map(id=>({id,inicio:"2026-09-08T02:59:59Z",servicio:{nombre:"Consulta sintética"}})):missing?[]:[{id:"e1",organization_id:"org",sesion_id:"s61",autor_id:"author",created_at:"2026-09-09",motivo:"Corrección sintética",texto_correccion_cifrado:corrupt?"\\x":encryptColumn("Enmienda original")}];return Promise.resolve(resolve({data:rows.slice(start,end+1),count:rows.length,error:null}));}
 };return query;}} as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>;
}
test("PDF includes all 62 sessions and amendment preserving original SOAP",async()=>{
 const rows=await readPdfHistory(client(),"org","patient",null);assert.equal(rows.length,62);assert.equal(rows[61].soap?.s,"original 61");assert.equal(rows[61].enmiendas?.[0].texto,"Enmienda original");assert.equal(rows[0].fecha,"2026-09-07");
});
test("PDF refuses unreadable amendment",async()=>{await assert.rejects(()=>readPdfHistory(client(true),"org","patient",null))});
test("PDF punctual request cannot fall back to a different session",async()=>{await assert.rejects(()=>readPdfHistory(client(),"org","patient","not-matching"))});
