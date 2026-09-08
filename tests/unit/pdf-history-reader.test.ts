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
 const rows=await readPdfHistory(client(),"org","patient",null);assert.equal(rows.length,62);assert.equal(rows.find(r => r.sesionId === "s61")?.soap?.s,"original 61");assert.equal(rows.find(r => r.sesionId === "s61")?.enmiendas?.[0].texto,"Enmienda original");assert.equal(rows[0].fecha,"2026-09-07");
});
test("PDF refuses unreadable amendment",async()=>{await assert.rejects(()=>readPdfHistory(client(true),"org","patient",null))});
test("PDF punctual request cannot fall back to a different session",async()=>{await assert.rejects(()=>readPdfHistory(client(),"org","patient","not-matching"))});

type FixtureRow = { id: string } & Record<string, unknown>;
function historyFixture(sessions: FixtureRow[], visits: FixtureRow[]) {
 return { from(table: string) { let ids: string[] = []; const query = {
  select(columns: string) { if (table === "sesion") for (const field of ["tool_id", "tool_data_cifrado", "vertebras_json"]) assert.ok(columns.split(",").includes(field), `missing ${field}`); return query; },
  eq() { return query; }, order() { return query; }, in(_key: string, value: string[]) { ids = value; return query; },
  range(from: number, to: number) { const rows = table === "sesion" ? sessions : table === "turno" ? visits.filter(v => ids.includes(v.id)) : []; return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }); }
 }; return query; } } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>;
}
function session(id: string, extra: Record<string, unknown> = {}): FixtureRow { return { id, organization_id: "org", paciente_id: "patient", turno_id: `t-${id}`, tool_id: null, tool_data_cifrado: null, vertebras_json: [], ...extra }; }
function visit(id: string, inicio = "2026-09-08T12:00:00Z"): FixtureRow { return { id: `t-${id}`, inicio, servicio: { nombre: "Consulta sintética" } }; }
test("PDF clinical chronology uses visit time across retroactively created sessions and stable ties", async () => {
 const sessions = [session("retro", { created_at: "2026-09-10", soap_s_cifrado: encryptColumn("older encounter") }), session("a", { created_at: "2026-09-01" }), session("z", { created_at: "2026-08-01", soap_s_cifrado: encryptColumn("latest encounter") })];
 const rows = await readPdfHistory(historyFixture(sessions, [visit("retro", "2026-09-01T12:00:00Z"), visit("a"), visit("z")]), "org", "patient", null);
 assert.deepEqual(rows.map(r => r.sesionId), ["z", "a", "retro"]); assert.equal(rows[0].soap?.s, "latest encounter");
});
test("PDF restores encrypted tool summary and legacy vertebra summary without losing notes or SOAP", async () => {
 const rows = await readPdfHistory(historyFixture([
  session("v2", { tool_id: "quiropraxia.ficha.v2", tool_data_cifrado: encryptColumn(JSON.stringify({ v: 2, vertebras: [{ id: "C4", tecnicaAjuste: "nota sintética" }] })), notas_cifrado: encryptColumn("nota original"), soap_p_cifrado: encryptColumn("plan original") }),
  session("legacy", { vertebras_json: [{ id: "L5", estado: "ajustada" }] })
 ], [visit("v2"), visit("legacy")]), "org", "patient", null);
 assert.equal(rows.find(r => r.sesionId === "v2")?.resumen, "1 vértebra con notas");
 assert.equal(rows.find(r => r.sesionId === "v2")?.notas, "nota original");
 assert.equal(rows.find(r => r.sesionId === "v2")?.soap?.p, "plan original");
 assert.equal(rows.find(r => r.sesionId === "legacy")?.resumen, "L5 ajustadas");
});
for (const [name, extra] of Object.entries({ ciphertext: { tool_id: "quiropraxia.ficha.v2", tool_data_cifrado: "\\x" }, json: { tool_id: "quiropraxia.ficha.v2", tool_data_cifrado: encryptColumn("not-json") }, shape: { tool_id: "quiropraxia.ficha.v2", tool_data_cifrado: encryptColumn('{"v":2,"vertebras":"invalid"}') }, version: { tool_id: "quiropraxia.ficha.v2", tool_data_cifrado: encryptColumn('{"v":1,"vertebras":[]}') }, unknown: { tool_id: "unknown.tool.v1" }, legacy: { vertebras_json: [{ id: 42 }] } })) test(`PDF refuses unreadable tool ${name}`, async () => {
 await assert.rejects(() => readPdfHistory(historyFixture([session("bad", extra)], [visit("bad")]), "org", "patient", null), /pdf_(tool|unreadable)/);
});
