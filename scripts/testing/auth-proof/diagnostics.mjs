/** Classify Docker failures without exposing raw output from the isolated proof. */
export function dockerFailureKind(output){
 const message=String(output).toLowerCase();
 if(/toomanyrequests|rate limit/.test(message))return 'registry_rate_limit';
 if(/manifest unknown|not found|pull access denied/.test(message))return 'image_unavailable';
 if(/unhealthy|health check|healthcheck/.test(message))return 'unhealthy';
 if(/cannot connect to the docker daemon|is the docker daemon running/.test(message))return 'daemon_unavailable';
 if(/address already in use|port is already allocated/.test(message))return 'port_conflict';
 if(/timeout|timed out|connection reset|tls handshake|no route to host|temporary failure|network is unreachable/.test(message))return 'network';
 return 'unknown';
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&UUID.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const serviceRowsShape=value=>Array.isArray(value)&&value.length<=30&&value.every(row=>record(row)
 &&Object.keys(row).sort().join(',')==='dur,id,nombre,precioCents,tipoCanonico'
 &&typeof row.id==='string'&&typeof row.nombre==='string'&&typeof row.dur==='number'
 &&typeof row.precioCents==='number'&&typeof row.tipoCanonico==='string');
const serviceRows=value=>serviceRowsShape(value)&&value.every(row=>record(row)
 &&Object.keys(row).sort().join(',')==='dur,id,nombre,precioCents,tipoCanonico'
 &&uuid(row.id)&&typeof row.nombre==='string'&&row.nombre.trim().length>0&&row.nombre.length<=120
 &&Number.isInteger(row.dur)&&row.dur>=5&&row.dur<=480
 &&Number.isInteger(row.precioCents)&&row.precioCents>=0&&row.precioCents<=2147483647
 &&typeof row.tipoCanonico==='string'&&row.tipoCanonico.length>0);
const snapshot=value=>record(value)&&Object.keys(value).sort().join(',')==='revision,servicios'
 &&revision(value.revision)&&serviceRows(value.servicios);

/** Shape only: never return argument values, action headers or body fragments. */
export async function servicesRequestKind(body,contentType=''){
 if(typeof body!=='string'||body.length>1_048_576)return 'unknown';
 let raw=body;
 if(/^multipart\/form-data(?:;|$)/i.test(contentType)){
  try{
   const form=await new Response(body,{headers:{'Content-Type':contentType}}).formData();
   const roots=form.getAll('0');
   if(roots.length!==1||typeof roots[0]!=='string')return 'unknown';
   raw=roots[0];
  }catch{return 'unknown';}
 }
 let args;try{args=JSON.parse(raw);}catch{return 'unknown';}
 if(!Array.isArray(args))return 'unknown';
 const [input,user]=args;
 if(args.length===2&&record(input)
  &&Object.keys(input).sort().join(',')==='operacionId,organizationId,revision,servicios'
  &&uuid(input.organizationId)&&uuid(input.operacionId)&&revision(input.revision)
  &&serviceRowsShape(input.servicios)&&uuid(user))return 'services_command';
 // Two UUIDs alone cannot identify the action; a snapshot response is needed.
 if(args.length===2&&uuid(input)&&uuid(user))return 'uuid_pair';
 if(args.length===2&&Number.isInteger(input)&&input>=2&&input<=7&&record(user))return 'step_args';
 return 'unknown';
}

/** Decode just the JSON action result and bounded references, not React trees. */
export function servicesResponseCategory(body){
 const unknown={result:'unknown',code:'unknown',outcome:'unknown',revision:'unknown',rows:'unknown',shape:'unknown'};
 if(typeof body!=='string'||body.length>1_048_576)return unknown;
 const chunks=new Map();
 for(const line of body.split('\n')){
  const row=/^([0-9a-f]+):(.*)$/.exec(line);if(!row)continue;
  try{
   const value=JSON.parse(row[2]);
   if(chunks.has(row[1])||chunks.size>=1000)return unknown;
   chunks.set(row[1],value);
  }catch{/* Non-JSON Flight chunks are not action results. */}
 }
 const resolve=value=>{
  const seen=new Set();
  for(let depth=0;typeof value==='string'&&depth<16;depth++){
   const ref=/^\$(?:@)?([0-9a-f]+)$/.exec(value);if(!ref)return value;
   if(seen.has(ref[1]))return undefined;
   seen.add(ref[1]);value=chunks.get(ref[1]);
  }
  return value;
 };
 const root=chunks.get('0');if(!record(root))return unknown;
 const result=resolve(root.a);if(!record(result))return unknown;
 if(result.ok===true){
  const data=resolve(result.data);
  const isSnapshot=snapshot(data);
  return {result:'ok',code:'none',outcome:'none',
   revision:isSnapshot?String(data.revision):revision(result.revision)?String(result.revision):'unknown',
   rows:isSnapshot?String(data.servicios.length):'unknown',shape:isSnapshot?'snapshot':revision(result.revision)?'step':'unknown'};
 }
 if(result.ok!==false)return unknown;
 const error=resolve(result.error);
 const codes=['auth_required','mfa_required','no_org','forbidden','not_found','validation','conflict','transition_invalid','locked','db_error','network'];
 const outcomes=['rejected','uncertain','review_required'];
 return {result:'rejected',code:record(error)&&codes.includes(error.code)?error.code:'unknown',
  outcome:record(error)&&error.mutationOutcome===undefined?'none':record(error)&&outcomes.includes(error.mutationOutcome)?error.mutationOutcome:'unknown',
  revision:'unknown',rows:'unknown',shape:'unknown'};
}

export function servicesActionKind(request,result){
 if(request==='services_command')return 'services_write';
 if(request==='uuid_pair'&&result.shape==='snapshot')return 'services_snapshot';
 if(request==='step_args'&&(result.shape==='step'||result.result==='ok'&&result.shape==='unknown'))return 'step_update';
 return 'unknown';
}

/** Observe initiation and settlement separately: no response does not mean no POST. */
export function createServicesObserver(within){
 const rows=[],indexes=new Map(),reads=[];
 let droppedEvents=0;
 const register=(request,seen)=>{
  if(indexes.has(request))return indexes.get(request);
  try{
   if(request.method()!=='POST'||new URL(request.url()).pathname!=='/onboarding')return undefined;
   if(rows.length>=9){droppedEvents=Math.min(9,droppedEvents+1);return undefined;}
  }
  catch{return undefined;}
  const index=rows.length;
  const row={http:'none',request:'unknown',action:'unknown',state:'pending',seen,...servicesResponseCategory('')};
  rows.push(row);indexes.set(request,index);
  reads.push(within(()=>servicesRequestKind(request.postData()??'',request.headers()['content-type']??''),'unknown').then(kind=>{
   row.request=kind;row.action=servicesActionKind(kind,row);
  }));
  return index;
 };
 return {
  request(request){register(request,'request');},
  response(response){
   const index=register(response.request(),'response_only');if(index===undefined)return;
   const row=rows[index],http=String(response.status());
   row.http=/^[1-5][0-9]{2}$/.test(http)?http:'none';row.state='responded';
   reads.push(within(async()=>servicesResponseCategory(await response.text()),servicesResponseCategory('')).then(result=>{
    Object.assign(row,result);row.action=servicesActionKind(row.request,result);
   }));
  },
  requestfailed(request){const index=register(request,'request');if(index!==undefined)rows[index].state='failed';},
  droppedEvents(){return droppedEvents;},
  async finish(){await Promise.all(reads);indexes.clear();return rows.map(row=>({...row}));},
 };
}

const ALERTS=new Map([
 ['Revisá los servicios antes de guardar.','validation'],
 ['No tenés permiso para esa acción.','forbidden'],
 ['Volvé a iniciar sesión.','auth_required'],
 ['Error en la base de datos.','db_error'],
 ['Cambió la cuenta o el consultorio activo. Volvé a cargar la página.','account_changed'],
 ['No pudimos leer los servicios guardados. Volvé a cargar para continuar.','snapshot_read'],
 ['No pudimos confirmar la cuenta activa. Volvé a cargar para continuar.','owner_missing'],
 ['Los servicios cambiaron. Cargá los guardados antes de continuar.','conflict'],
 ['No pudimos confirmar el guardado. Verificá el mismo cambio antes de editar.','uncertain'],
 ['No pudimos preparar el guardado. Habilitá almacenamiento del navegador y reintentá.','prepare_storage'],
 ['No se pudo guardar.','no_message'],
]);
export function servicesAlertCategory(text,title=''){
 const normalize=value=>typeof value==='string'?value.trim().replace(/\s*Reintentar guardar$/,'').trim():'';
 return ALERTS.get(normalize(title))??ALERTS.get(normalize(text))??'unknown';
}
export function servicesPageErrorKind(name){
 const known={Error:'error',TypeError:'type_error',ReferenceError:'reference_error',SyntaxError:'syntax_error',RangeError:'range_error'};
 return Object.hasOwn(known,name)?known[name]:'unknown';
}

// The outer runner admits only complete lines in this closed grammar.
const CODE='(?:none|unknown|auth_required|mfa_required|no_org|forbidden|not_found|validation|conflict|transition_invalid|locked|db_error|network)';
const REVISION='(?:unknown|0|[1-9][0-9]{0,15})';
const RESPONSE=new RegExp(`^services_proof_response:phase=initial_save index=[0-9] seen=(?:request|response_only|none) state=(?:pending|responded|failed|none) request=(?:services_command|uuid_pair|step_args|unknown) action=(?:services_write|services_snapshot|step_update|unknown) http=(?:none|[1-5][0-9]{2}) result=(?:unknown|ok|rejected) code=${CODE} outcome=(?:none|unknown|rejected|uncertain|review_required) revision=${REVISION} rows=(?:unknown|[0-9]|[12][0-9]|30)$`);
const ALERT=/^services_proof_alert:phase=initial_save index=[0-9] scope=(?:none|unknown|save_indicator|wizard_banner|wizard_field|other) category=(?:none|unknown|validation|forbidden|auth_required|db_error|account_changed|snapshot_read|owner_missing|conflict|uncertain|prepare_storage|no_message)$/;
const PAGEERROR=/^services_proof_pageerror:phase=initial_save kind=(?:none|unknown|error|type_error|reference_error|syntax_error|range_error) count=[0-9]$/;
const OBSERVATION=/^services_proof_observation:phase=initial_save captured=[0-9] dropped_events=[0-9]$/;
export function servicesProofLines(output){
 return String(output).split(/\r?\n/).filter(line=>RESPONSE.test(line)||ALERT.test(line)||PAGEERROR.test(line)||OBSERVATION.test(line)).slice(-27);
}
