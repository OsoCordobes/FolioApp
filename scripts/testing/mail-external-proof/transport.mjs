import {LIMITS,digest,validId,envelope} from './contract.mjs';

/** Native fetch wrapper, never a provider stub in execution. Only POST /emails, no GET. */
export function createBoundary({manifest,inputs,apiKey,receipt,persist,fetchImpl,now=Date.now}){
 const began=now(),frozen=Object.fromEntries(['A','B'].map(label=>[label,{key:inputs[label].idempotencyKey,body:JSON.stringify(envelope(manifest,label))}]));
 if(!['A','B'].every(label=>/^folio-email\/[a-f0-9-]{36}$/.test(frozen[label].key))||frozen.A.key===frozen.B.key)throw Error('mail_proof_inputs');
 let phase='A',busy=false,controlledLossDurable=false;
 const injectedLoss=Error('mail_proof_controlled_response_loss');
 const stop=code=>{phase='stopped';receipt.failure??=code;throw Error('mail_proof_stopped');};
 const ensureActive=()=>{if(phase==='stopped')throw Error('mail_proof_stopped');};
 const wrapper=async(input,options={})=>{
  if(phase==='stopped'||phase==='complete')return stop('closed');
  if(busy)return stop('concurrent_request');
  if(now()-began>=LIMITS.milliseconds||now()>=Date.parse(manifest.authorization.expiresAt))return stop('deadline');
  let url;try{url=new URL(input);}catch{return stop('request_scope');}
  if(url.href!=='https://api.resend.com/emails'||url.username||url.password||url.hash||url.search||String(options.method??'GET').toUpperCase()!=='POST')return stop('request_scope');
  if(Object.keys(options).some(k=>!['method','headers','body','signal','redirect'].includes(k)))return stop('request_options');
  if(options.redirect!==undefined&&options.redirect!=='error')return stop('redirect');
  const headers=new Headers(options.headers);
  if([...headers.keys()].some(k=>!['authorization','content-type','idempotency-key'].includes(k))||headers.get('authorization')!==`Bearer ${apiKey}`||headers.get('content-type')!=='application/json')return stop('request_headers');
  const label=phase==='A'?'A':'B',expected=frozen[label],key=headers.get('idempotency-key');
  if(key!==expected.key||options.body!==expected.body)return stop('request_identity');
  if(phase==='replayB'&&!controlledLossDurable)return stop('replay_forbidden');
  if(receipt.posts>=LIMITS.posts)return stop('post_budget');
  const replay=phase==='replayB';busy=true;
  const attempt={label,attempt:receipt.posts+1,keyHash:digest(key),envelopeHash:digest(expected.body),state:'attempting',providerId:null};
  receipt.posts++;receipt.attempts.push(attempt);
  try{
   await persist(); // No HTTP unless counter/identity hash are already durable.
   ensureActive();
   const remaining=Math.min(10000,LIMITS.milliseconds-(now()-began),Date.parse(manifest.authorization.expiresAt)-now());
   if(remaining<=0)return stop('deadline');
   const timeout=AbortSignal.timeout(Math.floor(remaining));
   const response=await fetchImpl(url.href,{...options,headers,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,timeout]):timeout});
   ensureActive();
   if(!response.ok){attempt.state='provider_rejected';await persist();return stop('provider_http');}
   const raw=await response.clone().text();if(raw.length>16384)return stop('response_limit');
   ensureActive();
   let data;try{data=JSON.parse(raw);}catch{return stop('receipt_invalid');}
   if(!validId(data.id))return stop('receipt_invalid');
   if(label==='B'&&data.id===receipt.messageIds.A)return stop('receipt_inconsistent');
   if(replay&&data.id!==receipt.messageIds.B)return stop('replay_id_mismatch');
   attempt.providerId=data.id;attempt.state='accepted';receipt.messageIds[label]=data.id;await persist();
   ensureActive();
   if(label==='A'){phase='B';return response;}
   if(!replay){
    // Permission for the third POST appears only after BOTH receipt writes succeeded.
    receipt.controlledLoss=true;attempt.state='controlled_response_loss';await persist();
    ensureActive();controlledLossDurable=true;phase='replayB';throw injectedLoss;
   }
   receipt.replaySameId=true;attempt.state='replayed_same_id';await persist();ensureActive();phase='complete';return response;
  }catch(error){
   if(controlledLossDurable&&phase==='replayB'&&error===injectedLoss)throw error;
   if(!controlledLossDurable)receipt.controlledLoss=false;
   attempt.state=attempt.providerId?'accepted_but_stopped':'uncertain';phase='stopped';receipt.failure??='transport_or_journal';throw Error('mail_proof_stopped');
  }finally{busy=false;}
 };
 return {fetch:wrapper,get phase(){return phase;},get controlledLossDurable(){return controlledLossDurable;},
  stop:()=>{phase='stopped';},install(){const original=globalThis.fetch;globalThis.fetch=wrapper;return()=>{globalThis.fetch=original;};}};
}
