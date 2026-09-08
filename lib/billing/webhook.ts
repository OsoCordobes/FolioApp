import { applySubscriptionUpdate, recordChargeAttempt } from "@/lib/db/suscripcion";
import { getPaymentProvider } from "@/lib/payments";
import { checkMpLiveMode } from "@/lib/mercadopago/webhook-security";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type Client = ReturnType<typeof createSupabaseServiceClient>;
type Dependencies = {
  client: Client;
  provider: ReturnType<typeof getPaymentProvider>;
  applySubscription: typeof applySubscriptionUpdate;
  recordCharge: typeof recordChargeAttempt;
};

/** Authenticate before calling. Only completed durable receipts are acknowledged. */
export async function processBillingWebhook(
  event: { key: string; topic: string; resourceId: string; discard?: boolean },
  dependencies?: Dependencies,
): Promise<"done" | "retry"> {
  const deps = dependencies ?? {
    client: createSupabaseServiceClient(), provider: getPaymentProvider(),
    applySubscription: applySubscriptionUpdate, recordCharge: recordChargeAttempt,
  };
  const { data: receipt, error } = await deps.client.rpc("billing_claim_receipt", {
    p_key: event.key, p_topic: event.topic, p_resource: event.resourceId,
  });
  if (error || !receipt) return "retry";
  if (receipt.status === "done") return "done";
  if (receipt.status !== "claimed") return "retry";
  try {
    if (!event.discard && event.topic === "subscription_preapproval") {
      const info = await deps.provider.fetchSubscription(event.resourceId);
      if (!checkMpLiveMode(info.liveMode).discard) {
        const result = await deps.applySubscription(info, deps.client);
        if (!result.ok) throw new Error("subscription_write_failed");
      }
    } else if (!event.discard && event.topic === "subscription_authorized_payment") {
      const charge = await deps.provider.fetchChargeAttempt(event.resourceId);
      // Validate the authoritative subscription's environment, not only unsigned body metadata.
      const info = await deps.provider.fetchSubscription(charge.providerSubscriptionId);
      if (!checkMpLiveMode(info.liveMode).discard) {
        const result = await deps.recordCharge({ charge, rawPayload: null }, deps.client);
        if (!result.ok) throw new Error("charge_write_failed");
      }
    }
    const { data: completed, error: completeError } = await deps.client.from("billing_webhook_receipt")
      .update({status:"done", completed_at: new Date().toISOString(), lease_token:null, lease_until:null, sanitized_error:null})
      .eq("event_key",event.key).eq("lease_token",receipt.token).select("event_key").maybeSingle();
    return completeError || !completed ? "retry" : "done";
  } catch {
    await deps.client.from("billing_webhook_receipt")
      .update({status:"pending", lease_token:null, lease_until:null, sanitized_error:"processing_failed", available_at: new Date(Date.now()+60_000).toISOString()})
      .eq("event_key",event.key).eq("lease_token",receipt.token);
    return "retry";
  }
}

/** Recover incomplete receipts even after the provider exhausts its redeliveries. */
export async function replayBillingWebhooks(client: Client = createSupabaseServiceClient()) {
  const { data, error } = await client.from("billing_webhook_receipt")
    .select("event_key,topic,resource_id").neq("status","done")
    .lte("available_at",new Date().toISOString()).order("available_at").limit(5);
  if (error) return { retried: 0, failed: 1 };
  const results = await Promise.all((data ?? []).map((row: {event_key:string;topic:string;resource_id:string}) =>
    processBillingWebhook({key:row.event_key,topic:row.topic,resourceId:row.resource_id})));
  return { retried:results.length, failed:results.filter(r=>r==="retry").length };
}
