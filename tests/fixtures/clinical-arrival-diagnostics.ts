import {readFile} from 'node:fs/promises';
import type {Page,Request,Response} from '@playwright/test';
import {actionResult} from './clinical-response-loss';

export interface ArrivalDiagnostics {
 requestSeen:boolean;requestBound:boolean;responseSeen:boolean;requestFailed:boolean;bodyPending:boolean;
 status:number|null;requestMs:number|null;responseMs:number|null;elapsedMs:number;
 responseClassification:'pending'|'success'|'not_confirmed'|'unreadable';
}
interface Cleanup {add:(label:string,run:()=>Promise<void>)=>void;}
interface Dependencies {readManifest?:()=>Promise<string>;now?:()=>number;}

/** Compare only the application's current plain arrival input. Never return its identifiers or contents. */
function bindsArrival(request:Request,turnoId:string):boolean {
 try {
  if(!/^text\/plain(?:;|$)/i.test(request.headers()['content-type']??''))return false;
  const args:unknown=JSON.parse(request.postData()??'');
  if(!Array.isArray(args)||args.length!==1||!args[0]||typeof args[0]!=='object'||Array.isArray(args[0]))return false;
  const input=args[0] as Record<string,unknown>;
  return Object.keys(input).every(key=>['turnoId','to','duracionRealMin'].includes(key))&&input.turnoId===turnoId&&input.to==='en_sala'&&(input.duracionRealMin===undefined||input.duracionRealMin==='$undefined');
 }catch{return false;}
}

/** Passive diagnostics only: no route handler, forwarding, retries, polling or awaited response body. */
export async function observeClinicalArrival(page:Page,cleanup:Cleanup,turnoId:string,dependencies:Dependencies={}) {
 let actionIds:Set<string>;
 try {
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(turnoId))throw new Error();
  // Keep the full manifest (including its encryption key) in memory only. Project path is fixed.
  const manifest=JSON.parse(await (dependencies.readManifest??(()=>readFile('.next-test/server/server-reference-manifest.json','utf8')))()) as {node?:Record<string,{exportedName?:unknown}>;edge?:Record<string,{exportedName?:unknown}>};
  actionIds=new Set(Object.entries({...manifest.edge,...manifest.node}).filter(([id,entry])=>/^[a-f0-9]{42}$/.test(id)&&entry?.exportedName==='transitionTurnoAction').map(([id])=>id));
  if(actionIds.size===0)throw new Error();
 }catch{throw new Error('Clinical arrival observation could not load action metadata.');}
 const now=dependencies.now??(()=>performance.now()),started=now();
 const elapsed=()=>{const delta=now()-started;return Number.isFinite(delta)?Math.max(0,Math.round(delta)):0;};
 const state:ArrivalDiagnostics={requestSeen:false,requestBound:false,responseSeen:false,requestFailed:false,bodyPending:false,status:null,requestMs:null,responseMs:null,elapsedMs:0,responseClassification:'pending'};
 let active=true,tracked:Request|undefined;
 function onRequest(request:Request):void {
  if(!active)return;
  try {
   const url=new URL(request.url());
   if(url.origin!=='http://localhost:4420'||url.pathname!=='/hoy'||url.username||url.password||request.method()!=='POST'||!actionIds.has(request.headers()['next-action']))return;
   state.requestSeen=true;
   if(tracked||!bindsArrival(request,turnoId))return;
   tracked=request;state.requestBound=true;state.requestMs=elapsed();
  }catch{/* A diagnostic must never affect the application's transport or expose a payload. */}
 }
 async function readBody(response:Response):Promise<void> {
  let body:string;
  try {body=await response.text();}catch{if(active){state.bodyPending=false;state.responseClassification='unreadable';}return;}
  if(!active)return;
  state.bodyPending=false;
  try{actionResult(body);state.responseClassification='success';}
  catch{state.responseClassification='not_confirmed';}
 }
 function onResponse(response:Response):void {
  if(!active)return;
  try {
   if(!tracked||response.request()!==tracked)return;
   state.responseSeen=true;state.responseMs=elapsed();
   const status=response.status();state.status=Number.isInteger(status)&&status>=100&&status<=599?status:null;
   if(state.status!==200){state.responseClassification='not_confirmed';return;}
   state.bodyPending=true;
   // Deliberately detached: the original SQL poll retains its existing deadline.
   void readBody(response).catch(()=>{if(active){state.bodyPending=false;state.responseClassification='unreadable';}});
  }catch{state.responseClassification='unreadable';}
 }
 function onRequestFailed(request:Request):void {if(active&&tracked===request)state.requestFailed=true;}
 const dispose=async()=>{
  if(!active)return;active=false;state.elapsedMs=elapsed();
  page.off('request',onRequest);page.off('response',onResponse);page.off('requestfailed',onRequestFailed);tracked=undefined;
  // A pending body read may complete later; it cannot mutate the frozen snapshot and is never awaited.
 };
 cleanup.add('passive arrival observation',dispose);
 page.on('request',onRequest);page.on('response',onResponse);page.on('requestfailed',onRequestFailed);
 const snapshot=():ArrivalDiagnostics=>({...state,elapsedMs:active?elapsed():state.elapsedMs});
 return {snapshot,failureMessage:()=>`Clinical arrival was not confirmed by SQL: ${JSON.stringify(snapshot())}`,dispose};
}
