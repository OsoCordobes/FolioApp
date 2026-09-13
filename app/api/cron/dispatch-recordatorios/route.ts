/** Durable reminder worker: a live lease owns every send; uncertain WhatsApp sends require review. */
import { NextRequest, NextResponse } from "next/server";
import { buildConfirmToken } from "@/lib/booking/confirm-token";
import { fmtHora } from "@/lib/booking/slots-format";
import { getAppUrl } from "@/lib/config/app-url";
import { decryptColumn, tryDecrypt } from "@/lib/crypto";
import { ESTADOS_CANCELAN_SIDE_EFFECTS } from "@/lib/db/turnos";
import { emailDeliveryConfiguration } from "@/lib/email/client";
import { deliverDurableEmail, deliveryOutcome } from "@/lib/email/durable";
import { buildConfirmacion24hEmail, buildPostVisitaEmail, buildRecordatorio2hEmail } from "@/lib/email/templates/recordatorio-turno";
import { toWhatsappE164 } from "@/lib/format/phone";
import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { sendConfirmacion24h, sendPostVisita, sendRecordatorio2h } from "@/lib/whatsapp/templates";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Service = ReturnType<typeof createSupabaseServiceClient>;
interface RecordatorioRow {
  id: string; organization_id: string; turno_id: string;
  tipo: "CONFIRMACION_24H" | "RECORDATORIO_2H" | "POST_VISITA";
  scheduled_ts: string; intentos: number; lease_token: string;
}
type Outcome = "accepted" | "retryable" | "terminal";
async function finish(service: Service, job: RecordatorioRow, state: Outcome, canal: string | null, providerId: string | null, error: string | null): Promise<Outcome> {
  const result = await service.rpc("recordatorio_finish", {p_id:job.id,p_token:job.lease_token,p_status:state,p_canal:canal,p_provider_id:providerId,p_error:error});
  if (result.error || result.data !== true) throw new Error("reminder_finish_failed");
  return state;
}
async function runDispatch() {
  const configuration = emailDeliveryConfiguration();
  if (!configuration.enabled) return NextResponse.json({ok:true,processed:0,configuration});
  const service = createSupabaseServiceClient();
  const {data:jobs,error} = await service.rpc("recordatorio_claim",{p_limit:3});
  if (error) return NextResponse.json({ok:false,error:"reminder_claim_failed"},{status:503});
  const results = {processed:0,accepted:0,retryable:0,terminal:0,failed:0};
  for (const job of (jobs ?? []) as RecordatorioRow[]) {
    results.processed++;
    try { results[await processJob(service,job)]++; }
    catch {
      results.failed++;
      // A missing receipt after a WhatsApp call must not become a retry.
      // Leave that lease to recordatorio_claim, which quarantines uncertainty.
      const {data:row} = await service.from("recordatorio_job").select("external_started_at,canal").eq("id",job.id).maybeSingle();
      if (row && !(row.external_started_at && row.canal === "whatsapp")) {
        await finish(service,job,"retryable",null,null,"reminder_processing_failed").catch(()=>undefined);
      }
    }
  }
  return NextResponse.json({ok:results.failed===0,...results},{status:results.failed ? 503 : 200});
}
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ok:false,error:"cron_unconfigured"},{status:503});
  if (!verifyBearer(req.headers.get("authorization"),process.env.CRON_SECRET)) return NextResponse.json({ok:false,error:"unauthorized"},{status:401});
  try { return await runDispatch(); }
  catch { return NextResponse.json({ok:false,error:"reminder_worker_failed"},{status:503}); }
}
export const POST = GET;

async function processJob(service: Service, job: RecordatorioRow): Promise<Outcome> {
  const {data:turno,error} = await service.from("turno").select("id,inicio,paciente_id,servicio_id,estado")
    .eq("id",job.turno_id).eq("organization_id",job.organization_id).maybeSingle();
  if (error || !turno) throw new Error("turno_unavailable");
  const skipStates: readonly string[] = [...ESTADOS_CANCELAN_SIDE_EFFECTS,"CERRADO"];
  if ((job.tipo !== "POST_VISITA" && skipStates.includes(turno.estado)) || (job.tipo === "POST_VISITA" && turno.estado !== "CERRADO")) {
    return finish(service,job,"terminal",null,null,"appointment_obsolete");
  }
  const [patientResult,orgResult,serviceResult] = await Promise.all([
    service.from("paciente").select("identidad_id,deleted_at,pseudonimizado_en").eq("id",turno.paciente_id).eq("organization_id",job.organization_id).maybeSingle(),
    service.from("organization").select("nombre,direccion_completa,ciudad,timezone,is_internal_account,is_synthetic,deleted_at").eq("id",job.organization_id).maybeSingle(),
    service.from("servicio").select("nombre").eq("id",turno.servicio_id).eq("organization_id",job.organization_id).maybeSingle(),
  ]);
  if (patientResult.error || orgResult.error || serviceResult.error) throw new Error("reminder_context_failed");
  const org = orgResult.data;
  const patient = patientResult.data;
  if (!org) throw new Error("organization_unavailable");
  // Keep the existing internal/demo exclusion until existing demo flags are reviewed.
  if (org.is_synthetic || org.deleted_at) return finish(service,job,"terminal",null,null,"organization_delivery_blocked");
  if (!patient?.identidad_id || patient.deleted_at || patient.pseudonimizado_en) return finish(service,job,"terminal",null,null,"patient_unavailable");
  const {data:ident,error:identError} = await service.from("paciente_identidad").select("nombre_cifrado,telefono_cifrado,email_cifrado")
    .eq("id",patient.identidad_id).eq("organization_id",job.organization_id).maybeSingle();
  if (identError || !ident) throw new Error("identity_unavailable");
  const nombre = decryptColumn(ident.nombre_cifrado);
  if (!nombre) throw new Error("identity_decryption_failed");
  const telefono = tryDecrypt(ident.telefono_cifrado,"recordatorio.telefono");
  const emailRaw = tryDecrypt(ident.email_cifrado,"recordatorio.email");
  const email = emailRaw?.trim().includes("@") ? emailRaw.trim() : null;
  const phone = toWhatsappE164(telefono);
  const timezone = safeTimezone(org.timezone);
  const fecha = new Date(turno.inicio).toLocaleDateString("es-AR",{weekday:"short",day:"numeric",month:"short",timeZone:timezone});
  const hora = fmtHora(turno.inicio,timezone);
  const direccion = [org.direccion_completa,org.ciudad].filter(Boolean).join(", ");
  const memo = "Consultá tus indicaciones en el portal de Folio o contactá al consultorio.";
  if (phone && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    // Persist the uncertainty boundary BEFORE any provider I/O. There is no
    // documented WhatsApp idempotency here; an ambiguous response never falls
    // through to a second channel or a blind automatic resend.
    const started = await service.from("recordatorio_job").update({external_started_at:new Date().toISOString(),canal:"whatsapp"})
      .eq("id",job.id).eq("lease_token",job.lease_token).eq("delivery_state","leased")
      .gt("lease_until",new Date().toISOString()).select("id");
    if (started.error || started.data?.length !== 1) throw new Error("reminder_lease_lost");
    let receipt: {id:string};
    try {
      const operation = job.tipo === "CONFIRMACION_24H"
        ? sendConfirmacion24h({to:phone,pacienteNombre:nombre,fecha,hora,consultorioNombre:org.nombre,direccion,servicio:"Turno"})
        : job.tipo === "RECORDATORIO_2H"
          ? sendRecordatorio2h({to:phone,pacienteNombre:nombre,hora,consultorioNombre:org.nombre})
          : sendPostVisita({to:phone,pacienteNombre:nombre,memoCorto:memo,profesionalNombre:org.nombre});
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try { receipt = await Promise.race([operation,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error("provider_timeout")),10_000);})]); }
      finally { if (timeout) clearTimeout(timeout); }
    } catch { return finish(service,job,"terminal","whatsapp",null,"provider_response_unknown"); }
    if (!receipt.id) return finish(service,job,"terminal","whatsapp",null,"provider_receipt_missing");
    return finish(service,job,"accepted","whatsapp",receipt.id,null);
  }
  if (!email) return finish(service,job,"terminal","ninguno",null,"contact_unavailable");
  let confirmarUrl: string | null = null;
  let cancelarUrl: string | null = null;
  if (job.tipo === "CONFIRMACION_24H") {
    try {
      const expMs = new Date(turno.inicio).getTime();
      confirmarUrl = `${getAppUrl()}/t/${buildConfirmToken({turnoId:turno.id,accion:"confirmar",expMs})}`;
      cancelarUrl = `${getAppUrl()}/t/${buildConfirmToken({turnoId:turno.id,accion:"cancelar",expMs})}`;
    } catch { /* Portal fallback; never log raw signing errors. */ }
  }
  const template = job.tipo === "CONFIRMACION_24H"
    ? buildConfirmacion24hEmail({pacienteNombre:nombre,consultorioNombre:org.nombre,servicioNombre:"Turno",fecha,hora,direccion:direccion || null,confirmarUrl,cancelarUrl})
    : job.tipo === "RECORDATORIO_2H"
      ? buildRecordatorio2hEmail({pacienteNombre:nombre,consultorioNombre:org.nombre,hora})
      : buildPostVisitaEmail({pacienteNombre:nombre,profesionalNombre:org.nombre,memoCorto:memo});
  const expiry = Math.min(new Date(job.scheduled_ts).getTime()+6*60*60_000,
    job.tipo === "POST_VISITA" ? Infinity : new Date(turno.inicio).getTime());
  const result = await deliverDurableEmail({organizationId:job.organization_id,turnoId:job.turno_id,
    kind:job.tipo === "POST_VISITA" ? "reminder_post_visit" : "reminder",dedupeKey:`reminder:${job.id}`,
    expiresAt:new Date(expiry).toISOString(),to:email,...template},service);
  const outcome = deliveryOutcome(result);
  return finish(service,job,outcome.status,"email",outcome.providerId,outcome.code);
}
function safeTimezone(tz: string | null | undefined): string {
  if (tz) { try { new Intl.DateTimeFormat("es-AR",{timeZone:tz}); return tz; } catch {} }
  return "America/Argentina/Cordoba";
}
