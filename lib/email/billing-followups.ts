import "server-only";
import { getAppUrl } from "@/lib/config/app-url";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { SUPPORT_EMAIL } from "@/lib/support";
import { emailDeliveryConfiguration, type SendEmailResult } from "./client";
import { deliverDurableEmail, deliveryOutcome } from "./durable";
import { buildPagoFallidoEmail } from "./templates/pago-fallido";
import { buildSuscripcionActivadaEmail } from "./templates/suscripcion-activada";
import { buildSuscripcionReactivadaEmail } from "./templates/suscripcion-reactivada";

type Service = ReturnType<typeof createSupabaseServiceClient>;
export interface BillingFollowupJob {
  id: string; job_type: "payment_failed" | "subscription_activated" | "subscription_reactivated" | "payment_review";
  organization_id: string; subscription_id: string; charge_id: string | null; lease_token: string; idempotency_key: string;
}
export async function processBillingFollowup(service: Service, job: BillingFollowupJob): Promise<SendEmailResult> {
  // The durable terminal row is the administrator's review queue, never a customer mail.
  if (job.job_type === "payment_review") return { status: "failed", detail: "admin_review_required", retryable: false };
  const [{ data: org, error: orgError }, { data: sub, error: subError }] = await Promise.all([
    service.from("organization").select("nombre,is_internal_account,is_synthetic,deleted_at").eq("id",job.organization_id).maybeSingle(),
    service.from("suscripcion").select("payer_email,monto_cents,estado,ultimo_error,mp_preapproval_id")
      .eq("id",job.subscription_id).eq("organization_id",job.organization_id).maybeSingle(),
  ]);
  if (orgError || subError || !org || !sub) return { status: "failed", detail: "billing_context_unavailable", retryable: true };
  if (org.is_internal_account || org.is_synthetic || org.deleted_at) return { status: "failed", detail: "organization_delivery_blocked", retryable: false };
  const context = { organizationNombre: org.nombre as string, montoMensualCents: sub.monto_cents as number,
    billingUrl: `${getAppUrl()}/configuracion/billing` };
  let template: {subject: string; html: string};
  let legacyKey: string | undefined;
  if (job.job_type === "payment_failed") {
    const { data: charge, error } = await service.from("cargo_suscripcion").select("monto_cents,estado,mp_payment_id")
      .eq("id",job.charge_id).eq("suscripcion_id",job.subscription_id).maybeSingle();
    if (error || !charge) return { status: "failed", detail: "billing_charge_unavailable", retryable: true };
    if (charge.estado === "APROBADO" || sub.estado === "ACTIVA") return { status: "failed", detail: "billing_notification_obsolete", retryable: false };
    template = buildPagoFallidoEmail({ ...context, montoCents: charge.monto_cents, ultimoError: sub.ultimo_error });
    legacyKey = `pago-fallido:${job.organization_id}:${charge.mp_payment_id}`;
  } else {
    if (sub.estado !== "ACTIVA") return { status: "failed", detail: "billing_notification_obsolete", retryable: false };
    template = job.job_type === "subscription_activated" ? buildSuscripcionActivadaEmail(context) : buildSuscripcionReactivadaEmail(context);
    if (job.job_type === "subscription_activated") legacyKey = `suscripcion-activada:${job.organization_id}:${sub.mp_preapproval_id}`;
  }
  return deliverDurableEmail({organizationId:job.organization_id,kind:`billing_${job.job_type}`,
    dedupeKey:job.idempotency_key,billingFollowupId:job.id,legacyKey,to:sub.payer_email,...template,replyTo:SUPPORT_EMAIL},service);
}

export async function dispatchBillingFollowups(limit = 2) {
  const summary = {processed:0,accepted:0,retryable:0,terminal:0,failed:0};
  const configuration = emailDeliveryConfiguration();
  // Do not consume attempts while deployment/SMTP approval is pending.
  if (!configuration.enabled || !configuration.providerConfigured) return {...summary,configuration};
  const service = createSupabaseServiceClient();
  const {data,error} = await service.rpc("billing_claim_followups",{p_limit:limit});
  if (error) return {...summary,failed:1,configuration};
  for (const job of (data ?? []) as BillingFollowupJob[]) {
    let result: SendEmailResult;
    try { result = await processBillingFollowup(service,job); }
    catch { result = {status:"failed",detail:"billing_followup_failed",retryable:true}; }
    const outcome = deliveryOutcome(result);
    const finished = await service.rpc("billing_finish_followup",{p_id:job.id,p_token:job.lease_token,
      p_status:outcome.status,p_provider_id:outcome.providerId,p_error:outcome.code});
    summary.processed++;
    if (finished.error) summary.failed++;
    else if (finished.data !== true && outcome.status !== "accepted") summary.failed++;
    else summary[outcome.status]++;
  }
  return {...summary,configuration};
}
