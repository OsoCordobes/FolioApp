import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { closeRequestSchema, resolveCloseRequestSchema, closeReceiptRequestSchema, closeReceiptSchema, closeStatusSchema,
  validCloseReceipt, validCloseStatus, type CloseRequest, type ResolveCloseRequest, type CloseReceiptRequest, type CloseReceipt, type CloseStatus } from "@/lib/turnos/close-contract";
import { getActiveSession } from "./session";
import { mutationFailure, mutationRpcError, uncertainMutation, type MutationResult } from "./mutation-result";

async function execute(input: unknown, action: "CLOSE" | "RESOLVE", probe: boolean): Promise<MutationResult<CloseReceipt | null>> {
  const parsed = (action === "CLOSE" ? closeRequestSchema : resolveCloseRequestSchema).safeParse(input);
  if (!parsed.success) return mutationFailure("validation", "Revisá los datos y el identificador de la operación.", "rejected");
  const request = { ...parsed.data, action } as CloseReceiptRequest;
  try {
    const session = await getActiveSession();
    if (!session.ok) return { ok: false, error: { ...session.error, mutationOutcome: "rejected" } };
    const client = await createSupabaseServerClient();
    const args = { p_org: session.data.organizationId, p_operation: request.operacionId, p_turno: request.turnoId,
      p_decision: request.cobro ?? null };
    const duration = request.action === "CLOSE" ? request.duracionRealMin ?? null : null;
    // Default POST: even logical reads retain authorization locks in M120.
    const { data, error } = await client.rpc(probe ? "get_turno_close_receipt" : action === "CLOSE" ? "close_turno_atomic" : "resolve_turno_close",
      probe ? { ...args, p_action: action, p_duracion: duration } : action === "CLOSE" ? { ...args, p_duracion: duration } : args);
    if (error) return mutationRpcError(error);
    if (probe && data === null) return { ok: true, data: null };
    const receipt = closeReceiptSchema.safeParse(data);
    if (!receipt.success || !validCloseReceipt(receipt.data, request) || (session.data.role === "COORDINADOR" && receipt.data.pago !== null)) return uncertainMutation();
    return { ok: true, data: receipt.data };
  } catch { return uncertainMutation(); }
}

export async function closeTurnoAtomic(input: CloseRequest): Promise<MutationResult<CloseReceipt>> {
  const result = await execute(input, "CLOSE", false);
  return result.ok ? result.data ? { ok: true, data: result.data } : uncertainMutation() : result;
}
export async function resolveTurnoClose(input: ResolveCloseRequest): Promise<MutationResult<CloseReceipt>> {
  const result = await execute(input, "RESOLVE", false);
  return result.ok ? result.data ? { ok: true, data: result.data } : uncertainMutation() : result;
}
export async function getTurnoCloseReceipt(input: CloseReceiptRequest): Promise<MutationResult<CloseReceipt | null>> {
  const parsed = closeReceiptRequestSchema.safeParse(input);
  if (!parsed.success) return mutationFailure("validation", "Datos de consulta inválidos.", "rejected");
  const { action, ...request } = parsed.data;
  return execute(request, action, true);
}
export async function getTurnoCloseStatus(turnoId: string): Promise<MutationResult<CloseStatus>> {
  if (!z.string().uuid().safeParse(turnoId).success) return mutationFailure("validation", "Turno inválido.", "rejected");
  turnoId = turnoId.toLowerCase();
  try {
    const session = await getActiveSession();
    if (!session.ok) return { ok: false, error: { ...session.error, mutationOutcome: "rejected" } };
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("get_turno_close_status", { p_org: session.data.organizationId, p_turno: turnoId });
    if (error) return mutationRpcError(error);
    const status = closeStatusSchema.safeParse(data);
    if (!status.success || status.data.turnoId !== turnoId || !validCloseStatus(status.data)
      || status.data.puedeRegistrar !== (session.data.role !== "COORDINADOR")) return uncertainMutation();
    return { ok: true, data: status.data };
  } catch { return uncertainMutation(); }
}
