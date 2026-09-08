import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { tryDecrypt } from "@/lib/crypto";
import { emailDeliveryConfiguration, type SendEmailResult } from "./client";
import { notifyBookingConfirmada, notifyBookingRecibida, notifyPedidoNuevo } from "./notify";
type Service=ReturnType<typeof createSupabaseServiceClient>;
type Job={id:string;organization_id:string;pedido_id:string;turno_id:string|null;kind:string;lease_token:string};
const blocked=():SendEmailResult=>({status:"blocked",detail:"booking_notification_obsolete"});
async function prepare(service:Service,job:Job):Promise<SendEmailResult>{
 const [{data:org,error:orgError},{data:pedido,error:pedidoError},{data:lease,error:leaseError}]=await Promise.all([
  service.from("organization").select("deleted_at,is_synthetic").eq("id",job.organization_id).maybeSingle(),
  service.from("pedido").select("estado,nombre_cifrado,email_cifrado,fecha_propuesta,profesional_id,canal").eq("id",job.pedido_id).eq("organization_id",job.organization_id).maybeSingle(),
  service.from("booking_followup_job").select("status,lease_token,lease_until").eq("id",job.id).eq("organization_id",job.organization_id).maybeSingle(),
 ]);
 if(orgError||pedidoError||leaseError)return{status:"failed",detail:"booking_context_unavailable",retryable:true};
 if(!org||org.deleted_at||org.is_synthetic||!pedido||!lease||lease.status!=="leased"||lease.lease_token!==job.lease_token||new Date(lease.lease_until).getTime()<=Date.now())return blocked();
 const common={client:service,organizationId:job.organization_id,pacienteNombre:tryDecrypt(pedido.nombre_cifrado)??"",pacienteEmail:tryDecrypt(pedido.email_cifrado)};
 if(job.kind==="confirmed_email"){
  if(pedido.estado!=="CONFIRMADO"||!job.turno_id)return blocked();
  const {data:turno,error}=await service.from("turno").select("estado,deleted_at").eq("id",job.turno_id).eq("organization_id",job.organization_id).maybeSingle();
  if(error)return{status:"failed",detail:"booking_context_unavailable",retryable:true};
  if(!turno||turno.deleted_at||!["AGENDADO","CONFIRMADO"].includes(turno.estado))return blocked();
  return notifyBookingConfirmada({...common,turnoId:job.turno_id});
 }
 if(pedido.estado!=="PENDIENTE")return blocked();
 if(job.kind==="received_email"&&pedido.fecha_propuesta)return notifyBookingRecibida({...common,pedidoId:job.pedido_id,inicioIso:pedido.fecha_propuesta,servicioNombre:"Turno"});
 if(job.kind==="staff_request_email")return notifyPedidoNuevo({...common,pedidoId:job.pedido_id,canal:pedido.canal,fechaPropuestaIso:pedido.fecha_propuesta,profesionalId:pedido.profesional_id});
 return blocked();
}
export async function dispatchBookingFollowups(limit=1){
 const summary={processed:0,completed:0,retryable:0,terminal:0,failed:0};
 const config=emailDeliveryConfiguration();if(!config.enabled||!config.providerConfigured)return summary;
 const service=createSupabaseServiceClient();const claimed=await service.rpc("booking_claim_followups",{p_limit:limit});
 if(claimed.error)return{...summary,failed:1};
 for(const job of (claimed.data??[]) as Job[]){
  let result:SendEmailResult;try{result=await prepare(service,job);}catch{result={status:"failed",detail:"booking_preparation_failed",retryable:true};}
  // Queued means the immutable generic email job is committed and owns retries.
  const success=result.status==="sent"||result.status==="queued";
  const terminal=!success&&(result.status!=="failed"||result.retryable===false);
  const finish=await service.rpc("booking_finish_followup",{p_id:job.id,p_lease:job.lease_token,p_success:success,p_terminal:terminal});
  summary.processed++;if(finish.error||finish.data!==true)summary.failed++;else if(success)summary.completed++;else if(terminal)summary.terminal++;else summary.retryable++;
 }
 return summary;
}
