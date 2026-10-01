import "server-only";

import { createClient } from "@supabase/supabase-js";
import { tokenHash, prepareAdminContribution } from "./admin-v1";

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("intake_service_unavailable");
  // Dedicated service client: no staff cookies, no auth storage, and only M144 RPCs.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(12000) }) },
  });
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client().rpc(name, args);
  if (error) throw new Error("intake_rpc_failed");
  return data;
}

export async function exchangeInvitation(token: string): Promise<{ session: string; expiresAt: string }> {
  const result = await rpc("patient_intake_exchange", { p_token_hash: tokenHash(token) });
  if (!result || typeof result !== "object") throw new Error("intake_exchange_invalid");
  const row = result as Record<string, unknown>;
  if (typeof row.session !== "string" || !/^[0-9a-f]{64}$/.test(row.session) ||
      typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))) throw new Error("intake_exchange_invalid");
  return { session: row.session, expiresAt: row.expiresAt };
}

export async function submitContribution(rawSession: string, operationId: string, answers: unknown) {
  const p_session_hash = tokenHash(rawSession);
  const key = await rpc("patient_intake_submission_key", { p_session_hash });
  if (!key || typeof key !== "object") throw new Error("intake_key_invalid");
  const row = key as Record<string, unknown>;
  if (typeof row.invitationId !== "string" || typeof row.keyCipherBase64 !== "string") throw new Error("intake_key_invalid");
  const prepared = prepareAdminContribution(answers, Buffer.from(row.keyCipherBase64, "base64"), row.invitationId, operationId);
  const result = await rpc("patient_intake_submit", {
    p_session_hash, p_operation: operationId, p_version: prepared.questionnaireVersion,
    p_fingerprint: prepared.fingerprint, p_answers_cifrado: prepared.answersCipher,
  });
  return parseReceipt(result);
}

export async function operationStatus(rawSession: string, operationId: string) {
  const result = await rpc("patient_intake_operation_status", { p_session_hash: tokenHash(rawSession), p_operation: operationId });
  if (!result || typeof result !== "object") throw new Error("intake_status_invalid");
  const row = result as Record<string, unknown>;
  if (row.status === "not_received") return { status: "not_received" as const };
  return parseReceipt(result);
}

function parseReceipt(value: unknown): { status: "received"; receiptId: string; receivedAt: string } {
  if (!value || typeof value !== "object") throw new Error("intake_receipt_invalid");
  const row = value as Record<string, unknown>;
  if (row.status !== "received" || typeof row.receiptId !== "string" || typeof row.receivedAt !== "string") throw new Error("intake_receipt_invalid");
  return { status: "received", receiptId: row.receiptId, receivedAt: row.receivedAt };
}
