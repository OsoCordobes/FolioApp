import "server-only";
import { createHash } from "node:crypto";
import { decryptColumn, encryptColumn } from "@/lib/crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { emailDeliveryConfiguration, sendEmail, type SendEmailInput, type SendEmailResult } from "./client";

type Service = ReturnType<typeof createSupabaseServiceClient>;
export interface EmailDeliveryRow {
  id: string; organization_id: string; kind: string; payload_cifrado: string | null;
  turno_id?: string | null; status: string; lease_token: string; provider_id: string | null; sanitized_error: string | null;
}
export interface DurableEmailInput extends SendEmailInput {
  organizationId: string;
  kind: string;
  dedupeKey: string;
  expiresAt?: string;
  legacyKey?: string;
  turnoId?: string;
  billingFollowupId?: string;
}
export function emailDedupeKey(org: string, key: string): string {
  return createHash("sha256").update(`${org}\0${key}`).digest("hex");
}
export function deliveryOutcome(result: SendEmailResult): { status: "retryable" | "terminal" | "accepted"; code: string | null; providerId: string | null } {
  if (result.status === "sent" && result.providerId) return { status: "accepted", code: null, providerId: result.providerId };
  if (result.status === "failed" && result.retryable === false) return { status: "terminal", code: result.detail, providerId: null };
  return { status: "retryable", code: result.status === "sent" ? "provider_receipt_missing" : result.detail, providerId: null };
}

/** Immutable encrypted envelope; repeated events recover the original receipt/payload. */
export async function deliverDurableEmail(input: DurableEmailInput, serviceInput?: Service): Promise<SendEmailResult> {
  try {
    const service = serviceInput ?? createSupabaseServiceClient();
    const payload = encryptColumn(JSON.stringify({ to: input.to, subject: input.subject, html: input.html, replyTo: input.replyTo }));
    const { data, error } = await service.rpc("email_enqueue", {
      p_org: input.organizationId, p_key: emailDedupeKey(input.organizationId, input.dedupeKey),
      p_kind: input.kind, p_payload: payload, p_expires_at: input.expiresAt ?? null, p_legacy_key: input.legacyKey ?? null, p_turno: input.turnoId ?? null, p_billing_job: input.billingFollowupId ?? null,
    });
    const row = (data as EmailDeliveryRow[] | null)?.[0];
    if (error || !row) return { status: "failed", detail: "email_enqueue_failed", retryable: true };
    if ((row.status === "accepted" || row.status === "delivered") && row.provider_id) return { status: "sent", providerId: row.provider_id };
    if (row.status === "terminal") return { status: "failed", detail: row.sanitized_error ?? "email_terminal", retryable: false };
    const configuration = emailDeliveryConfiguration();
    if (!configuration.enabled || !configuration.providerConfigured) return { status: "queued", detail: "delivery_configuration_pending" };
    const claim = await service.rpc("email_claim", { p_limit: 1, p_id: row.id });
    if (claim.error) return { status: "failed", detail: "email_claim_failed", retryable: true };
    const leased = (claim.data as EmailDeliveryRow[] | null)?.[0];
    return leased ? await processEmailDelivery(service, leased) : { status: "queued", detail: "delivery_pending" };
  } catch {
    return { status: "failed", detail: "email_preparation_failed", retryable: true };
  }
}

export async function processEmailDelivery(service: Service, row: EmailDeliveryRow, transport = sendEmail): Promise<SendEmailResult> {
  let result: SendEmailResult;
  try {
    // Recheck immediately before decrypting or invoking an external transport.
    const { data: org, error } = await service.from("organization").select("is_synthetic,is_internal_account,deleted_at")
      .eq("id", row.organization_id).maybeSingle();
    if (error || !org) result = { status: "failed", detail: "organization_lookup_failed", retryable: true };
    else if (org.is_synthetic || org.deleted_at || (row.kind.startsWith("billing_") && org.is_internal_account)) {
      result = { status: "failed", detail: "organization_delivery_blocked", retryable: false };
    } else {
      if (row.turno_id) {
        const {data:turno,error:turnoError} = await service.from("turno").select("estado,paciente_id")
          .eq("id",row.turno_id).eq("organization_id",row.organization_id).maybeSingle();
        if (turnoError || !turno) throw new Error("appointment_unavailable");
        const obsolete = row.kind === "reminder_post_visit" ? turno.estado !== "CERRADO"
          : ["CANCELADO","REAGENDADO","CERRADO","NO_ASISTIO"].includes(turno.estado);
        const {data:patient,error:patientError} = await service.from("paciente").select("deleted_at,pseudonimizado_en")
          .eq("id",turno.paciente_id).eq("organization_id",row.organization_id).maybeSingle();
        if (patientError) throw new Error("patient_unavailable");
        if (obsolete || !patient || patient.deleted_at || patient.pseudonimizado_en) {
          const finished = await service.rpc("email_finish",{p_id:row.id,p_token:row.lease_token,p_status:"terminal",p_error:"appointment_obsolete"});
          return finished.error || finished.data !== true ? {status:"uncertain",detail:"email_receipt_persist_failed"}
            : {status:"failed",detail:"appointment_obsolete",retryable:false};
        }
      }
      const plaintext = decryptColumn(row.payload_cifrado);
      if (!plaintext) throw new Error("payload_unavailable");
      const payload = JSON.parse(plaintext) as SendEmailInput;
      result = await transport({ ...payload, idempotencyKey: `folio-email/${row.id}` });
    }
  } catch { result = { status: "failed", detail: "email_payload_unavailable", retryable: true }; }
  const outcome = deliveryOutcome(result);
  const finished = await service.rpc("email_finish", {
    p_id: row.id, p_token: row.lease_token, p_status: outcome.status,
    p_provider_id: outcome.providerId, p_error: outcome.code,
  });
  if (finished.error || finished.data !== true) return { status: "uncertain", detail: "email_receipt_persist_failed" };
  return result;
}

export async function dispatchEmailDeliveries(limit = 3) {
  const summary = { processed: 0, accepted: 0, retryable: 0, terminal: 0, failed: 0 };
  const configuration = emailDeliveryConfiguration();
  if (!configuration.enabled || !configuration.providerConfigured) return { ...summary, configuration };
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("email_claim", { p_limit: limit });
  if (error) return { ...summary, failed: 1, configuration };
  for (const row of (data ?? []) as EmailDeliveryRow[]) {
    try {
      const result = await processEmailDelivery(service, row);
      summary.processed++;
      summary[deliveryOutcome(result).status]++;
    } catch { summary.failed++; }
  }
  return { ...summary, configuration };
}
