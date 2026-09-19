"use client";
import {useEffect,useState} from "react";
import {createRepresentacionAction,listRepresentacionesAction,reviewRepresentacionAction} from "@/app/(app)/pacientes/representaciones-actions";
import type {RepresentationItem} from "@/lib/db/representaciones";

export function RepresentacionesCard({pacienteId}:{pacienteId:string}){
  const [items,setItems]=useState<RepresentationItem[]>([]),[error,setError]=useState(""),[pending,setPending]=useState(false),[open,setOpen]=useState(false);
  const [review,setReview]=useState<string|null>(null),[reason,setReason]=useState(""),[identity,setIdentity]=useState(false),[relationship,setRelationship]=useState(false);
  async function load(){const r=await listRepresentacionesAction(pacienteId);if(!r.ok){setError(r.error.message);return;}setItems(r.data);setError("");}
  useEffect(()=>{void load();/* refreshed after every mutation */},[pacienteId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function create(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(pending)return;const data=new FormData(event.currentTarget);setPending(true);setError("");
    try{const r=await createRepresentacionAction({pacienteId,nombre:data.get("nombre"),documento:data.get("documento"),telefono:data.get("telefono"),vinculo:data.get("vinculo"),desde:data.get("desde"),hasta:data.get("hasta"),evidencia:data.get("evidencia"),restricciones:data.get("restricciones"),alcances:data.getAll("alcances")});
      if(!r.ok){setError(r.error.message);return;}setOpen(false);await load();
    }catch{setError("No pudimos guardar los datos. Reintentá.");}finally{setPending(false);}
  }
  async function decide(item:RepresentationItem){
    if(pending)return;setPending(true);setError("");try{
      const r=await reviewRepresentacionAction({id:item.id,pacienteId,accion:item.estado==="PENDIENTE"?"VERIFICAR":"REVOCAR",motivo:reason,identidad:identity,vinculo:relationship});
      if(!r.ok){setError(r.error.message);return;}setReview(null);setReason("");setIdentity(false);setRelationship(false);await load();
    }catch{setError("No pudimos registrar la revisión. Reintentá.");}finally{setPending(false);}
  }
  return <section className="fi-card" data-sensitive style={{padding:20,marginTop:20}}>
    <h3>Representantes y apoyos</h3>
    <p>Un contacto de emergencia no puede firmar ni acceder a la historia por ese solo vínculo. Cada representación necesita revisión, alcance y vigencia propios.</p>
    {error&&<p role="alert">{error}</p>}
    {items.length===0&&!error&&<p>No hay representaciones registradas. Esto no determina quién debe consentir: se evalúa cada acto.</p>}
    {items.map(item=><article key={item.id} style={{borderTop:"1px solid var(--line)",paddingBlock:16}}>
      <strong>{item.nombre}</strong><p>Documento: {item.documento}</p><p>{item.vinculo} · {item.estado} · {item.desde??"Inicio por revisar"} a {item.hasta??"Fin por revisar"}</p>
      <p>Alcances: {item.alcances.join(", ")||"Pendientes"}. Restricciones: {item.restricciones}</p>
      <p>Acreditación: {item.evidencia}</p>
      {item.estado==="PENDIENTE"&&(!item.desde||!item.hasta||item.alcances.length===0)&&<p>Registro previo incompleto: conservá el antecedente y cargá una nueva representación con fechas, alcance y documentación antes de verificarla.</p>}
      {item.estado!=="REVOCADA"&&(item.estado!=="PENDIENTE"||(item.desde&&item.hasta&&item.alcances.length>0))&&<button className="fi-btn fi-btn-ghost" onClick={()=>{setReview(review===item.id?null:item.id);setReason("");setIdentity(false);setRelationship(false);}}>{item.estado==="PENDIENTE"?"Revisar acreditación":"Revocar representación"}</button>}
      {review===item.id&&<div className="au-form">
        {item.estado==="PENDIENTE"&&<><label><input type="checkbox" checked={identity} onChange={e=>setIdentity(e.target.checked)}/> Comprobé la identidad de esta persona.</label><label><input type="checkbox" checked={relationship} onChange={e=>setRelationship(e.target.checked)}/> Revisé la documentación del vínculo y sus restricciones.</label></>}
        <label className="au-field"><span>Fundamento y evidencia de la revisión</span><textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={20} maxLength={2000}/></label>
        <button className="fi-btn fi-btn-primary" disabled={pending||reason.trim().length<20||(item.estado==="PENDIENTE"&&(!identity||!relationship))} onClick={()=>void decide(item)}>{pending?"Guardando…":item.estado==="PENDIENTE"?"Confirmar revisión profesional":"Confirmar revocación"}</button>
      </div>}
    </article>)}
    <button className="fi-btn fi-btn-ghost" onClick={()=>setOpen(!open)}>{open?"Cerrar formulario":"Registrar representación pendiente"}</button>
    {open&&<form onSubmit={create} className="au-form">
      <label className="au-field"><span>Nombre completo del representante</span><input name="nombre" required minLength={3} maxLength={150}/></label>
      <label className="au-field"><span>Documento de identidad</span><input name="documento" required minLength={5} maxLength={40}/></label>
      <label className="au-field"><span>Teléfono de contacto (no concede acceso)</span><input name="telefono" required minLength={6} maxLength={40}/></label>
      <label className="au-field"><span>Vínculo declarado</span><select name="vinculo" required defaultValue=""><option value="" disabled>Elegir vínculo</option><option value="MADRE">Madre</option><option value="PADRE">Padre</option><option value="ABUELO">Abuelo/a</option><option value="OTRO">Otro vínculo o apoyo: detallar en la acreditación</option></select></label>
      <label className="au-field"><span>Vigente desde</span><input name="desde" type="date" required/></label><label className="au-field"><span>Vigente hasta (según documentación y revisión)</span><input name="hasta" type="date" required/></label>
      <fieldset><legend>Alcances expresamente acreditados</legend><label><input name="alcances" type="checkbox" value="CONSENTIMIENTO"/> Participar en consentimientos</label><br/><label><input name="alcances" type="checkbox" value="AGENDA"/> Gestiones de agenda</label><br/><label><input name="alcances" type="checkbox" value="ENTREGA_REVISADA"/> Solicitar entrega clínica con revisión profesional</label></fieldset>
      <p>Estos alcances no crean una cuenta del paciente ni habilitan automáticamente el portal o su narrativa clínica.</p>
      <label className="au-field"><span>Documentación vista, vínculo y referencia de la acreditación</span><textarea name="evidencia" required minLength={20} maxLength={2000}/></label>
      <label className="au-field"><span>Restricciones o “sin restricciones acreditadas”</span><textarea name="restricciones" required minLength={3} maxLength={2000}/></label>
      <button className="fi-btn fi-btn-primary" disabled={pending}>{pending?"Guardando…":"Guardar pendiente de revisión"}</button>
    </form>}
  </section>;
}
