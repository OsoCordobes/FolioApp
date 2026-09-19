"use client";
import {useEffect,useState} from "react";
import {listConsentAssessmentsAction,revokeConsentAssessmentAction} from "@/app/(app)/pacientes/consentimiento-evaluacion-actions";
import type {AssessmentItem} from "@/lib/db/consentimiento-evaluacion";
export function EvaluacionesConsentimiento({pacienteId,revision}:{pacienteId:string;revision:number}){
 const [items,setItems]=useState<AssessmentItem[]>([]),[error,setError]=useState(""),[selected,setSelected]=useState<string|null>(null),[reason,setReason]=useState(""),[pending,setPending]=useState(false);
 async function load(){const r=await listConsentAssessmentsAction(pacienteId);if(!r.ok){setError(r.error.message);return;}setItems(r.data);setError("");}
 useEffect(()=>{void load();},[pacienteId,revision]); // eslint-disable-line react-hooks/exhaustive-deps
 async function revoke(id:string){if(pending)return;setPending(true);try{const r=await revokeConsentAssessmentAction(id,pacienteId,reason);if(!r.ok){setError(r.error.message);return;}setSelected(null);setReason("");await load();}catch{setError("No pudimos guardar la revisión.");}finally{setPending(false);}}
 return <div style={{marginBlock:16}}><h4>Evaluaciones por acto</h4>{error&&<p role="alert">{error}</p>}
 {items.length===0&&!error&&<p>Todavía no se registraron evaluaciones. La atención clínica puede continuar documentándose.</p>}
 {items.map(item=><div key={item.id} style={{marginBlock:12}}><p>{item.modo==="PENDIENTE"?"Pendiente: sin firma atribuida":item.modo==="AUTONOMO"?"Decisión autónoma evaluada":item.modo==="ASISTIDO"?"Participación asistida evaluada":"Representación evaluada"} · {item.revocadoEn?"Retirada para revisión":`Revisar antes de ${new Date(item.vigenteHasta).toLocaleDateString("es-AR",{timeZone:"America/Argentina/Cordoba"})}`}</p>
 <details data-sensitive><summary>Ver fundamento y participación registrados</summary><p>{item.fundamento}</p><p>{item.participacion}</p><p>Riesgos: {item.riesgo==="EVALUADO"?"Evaluados":"Requieren revisión"}. Texto versión {item.version}.</p><p>Registrado el {new Date(item.createdAt).toLocaleString("es-AR",{timeZone:"America/Argentina/Cordoba"})}. Referencia del evaluador: {item.autorId}.</p></details>
 {!item.revocadoEn&&<button className="fi-btn fi-btn-ghost" onClick={()=>{setSelected(selected===item.id?null:item.id);setReason("");}}>Retirar esta evaluación</button>}
 {selected===item.id&&<div className="au-form"><label className="au-field"><span>Motivo (no modifica firmas ya registradas)</span><textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></label><button className="fi-btn fi-btn-primary" disabled={pending||reason.trim().length<10} onClick={()=>void revoke(item.id)}>Registrar revisión</button></div>}
 </div>)}</div>;
}
