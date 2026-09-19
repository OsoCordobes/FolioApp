import { getAppUrl } from "@/lib/config/app-url";
import { getPaymentProvider, type PaymentProvider, type SubscriptionInfo } from "@/lib/payments";
import { checkMpLiveMode } from "@/lib/mercadopago/webhook-security";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type Client = ReturnType<typeof createSupabaseServiceClient>;
export interface ProviderOperation {
 id:string;organization_id:string;subscription_id:string;kind:"create"|"amount"|"cancel";
 amount_cents:number;previous_preapproval_id:string|null;provider_id:string|null;
 status:string;phase:"pending"|"cancel_previous"|"create"|"amount"|"cancel";
 idempotency_key:string;lease_token:string;attempts:number;
}
export type OperationResult = {ok:true;row:Record<string,unknown>;checkoutUrl:string|null}|{ok:false;reason:"busy"|"uncertain"};

/** An expired lease is a reason to observe the provider, never to repeat an uncertain POST. */
export async function runProviderOperation(id:string,dependencies?:{client:Client;provider:PaymentProvider;appUrl?:string}):Promise<OperationResult> {
 const client=dependencies?.client??createSupabaseServiceClient();
 const provider=dependencies?.provider??getPaymentProvider();
 const {data,error}=await client.rpc("billing_claim_operation",{p_id:id});
 if(error || !data)return {ok:false,reason:"busy"};
 const op=data as ProviderOperation;
 if(op.status==="done") {
  const {data:row,error:readError}=await client.from("suscripcion").select("*").eq("id",op.subscription_id).single();
  if(readError || !row || !op.provider_id)return {ok:false,reason:"uncertain"};
  try {const info=await provider.fetchSubscription(op.provider_id);return {ok:true,row,checkoutUrl:info.checkoutUrl};}
  catch{return {ok:false,reason:"uncertain"};}
 }
 let uncertainCode="provider_observation_required";
 try {
  const {data:sub,error:subError}=await client.from("suscripcion").select("payer_email").eq("id",op.subscription_id).single();
  if(subError || !sub)throw new Error("subscription_read_failed");
  const markWrite=async(phase:ProviderOperation["phase"])=>{
   const result=await client.rpc("billing_mark_operation_write",{p_id:op.id,p_token:op.lease_token,p_phase:phase});
   if(result.error || result.data!==true)throw new Error("operation_lease_lost");
  };
  let info:SubscriptionInfo;
  if(op.kind==="create") {
   const reference=`folio_operation_${op.id}`;
   if(op.phase==="create") {
    if(!provider.findSubscriptionsForOperation)throw new Error("provider_recovery_unavailable");
    const matches=await provider.findSubscriptionsForOperation(sub.payer_email,reference);
    if(matches.length!==1) {
     uncertainCode=matches.length>1?"provider_ambiguous":"provider_not_observed";
     throw new Error(uncertainCode);
    }
    info=matches[0];
   } else {
    if(op.previous_preapproval_id) {
     let previous=await provider.fetchSubscription(op.previous_preapproval_id);
     if(previous.status!=="CANCELADA") {
      if(op.phase==="cancel_previous")throw new Error("previous_cancellation_unconfirmed");
      await markWrite("cancel_previous");
      previous=await provider.cancelSubscription(op.previous_preapproval_id);
      if(previous.status!=="CANCELADA")throw new Error("previous_cancellation_unconfirmed");
     }
    }
    await markWrite("create");
    const created=await provider.createSubscription({payerEmail:sub.payer_email,externalReference:reference,
     backUrl:`${dependencies?.appUrl??getAppUrl()}/configuracion/billing?activation=ok`,amountCents:op.amount_cents,idempotencyKey:op.idempotency_key});
    info=created.subscription;
   }
  } else {
   if(!op.previous_preapproval_id)throw new Error("provider_subscription_missing");
   info=await provider.fetchSubscription(op.previous_preapproval_id);
   const matches=op.kind==="amount"?info.amountCents===op.amount_cents:info.status==="CANCELADA";
   if(!matches) {
    if(op.phase!=="pending")throw new Error("provider_write_unconfirmed");
    await markWrite(op.kind);
    info=op.kind==="amount"?await provider.updateSubscriptionAmount(op.previous_preapproval_id,op.amount_cents):await provider.cancelSubscription(op.previous_preapproval_id);
   }
  }
  if(checkMpLiveMode(info.liveMode).discard)throw new Error("provider_sandbox_discarded");
  const completed=await client.rpc("billing_complete_operation",{p_id:op.id,p_token:op.lease_token,p_info:info});
  if(completed.error || !completed.data)throw new Error("operation_completion_failed");
  return {ok:true,row:completed.data,checkoutUrl:info.checkoutUrl};
 } catch {
  await client.from("billing_provider_operation").update({status:op.attempts>=10 || uncertainCode==="provider_ambiguous"?"terminal":"uncertain",
   sanitized_error:uncertainCode,available_at:new Date(Date.now()+60_000*Math.min(60,2**op.attempts)).toISOString(),lease_token:null,lease_until:null})
   .eq("id",op.id).eq("lease_token",op.lease_token);
  return {ok:false,reason:"uncertain"};
 }
}

export async function recoverProviderOperations(client:Client=createSupabaseServiceClient()) {
 const {data,error}=await client.from("billing_provider_operation").select("id")
  .in("status",["pending","processing","uncertain"]).lte("available_at",new Date().toISOString()).order("available_at").limit(3);
 if(error)return {recovered:0,unresolved:1};
 const results=await Promise.all((data??[]).map((row:{id:string})=>runProviderOperation(row.id)));
 return {recovered:results.filter(result=>result.ok).length,unresolved:results.filter(result=>!result.ok).length};
}
