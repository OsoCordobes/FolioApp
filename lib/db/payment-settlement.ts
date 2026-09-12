import { z } from "zod";
import { capabilitiesFor } from "@/lib/auth/capabilities";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { settlementReceiptSchema, type SettlementReceipt } from "@/lib/turnos/close-contract";
import { getActiveSession } from "./session";
import { mutationFailure, mutationRpcError, uncertainMutation, type MutationResult } from "./mutation-result";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const requestSchema = z.object({ pagoId: uuid, turnoId: uuid.optional() }).strict();
const bindingSchema = z.object({ id: z.string().uuid(), turno_id: z.string().uuid(), turno: z.object({
  organization_id: z.string().uuid(), profesional_id: z.string().uuid().nullable(), estado: z.string(),
}) });

/** Wrappers select their capability gate; M121 revalidates current authority under locks. */
export async function settlePayment(input: { pagoId: string; turnoId?: string }, surface: "finance" | "agenda"): Promise<MutationResult<SettlementReceipt>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success || (surface === "agenda" && !parsed.data.turnoId)) return mutationFailure("validation", "Pago o turno inválido.", "rejected");
  try {
    const session = await getActiveSession();
    if (!session.ok) return { ok: false, error: { ...session.error, mutationOutcome: "rejected" } };
    const caps = capabilitiesFor(session.data.role, session.data.esColegiado);
    if (!caps.canRegistrarCobro || (surface === "finance" && !caps.canSeeFinanzas)) return mutationFailure("forbidden", "No tenés permiso para registrar ese cobro.", "rejected");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.from("pago")
      .select("id, turno_id, turno:turno_id!inner(organization_id, profesional_id, estado)").eq("id", parsed.data.pagoId).maybeSingle();
    if (error) return mutationRpcError(error);
    const binding = bindingSchema.safeParse(data);
    if (!binding.success || binding.data.id !== parsed.data.pagoId || binding.data.turno.organization_id !== session.data.organizationId
      || (parsed.data.turnoId && binding.data.turno_id !== parsed.data.turnoId)) return mutationFailure("not_found", "El pago no pertenece al turno y organización solicitados.", "rejected");
    if (session.data.role === "PROFESIONAL" && binding.data.turno.profesional_id !== session.data.memberId) return mutationFailure("forbidden", "Solo podés registrar cobros de tus propios turnos.", "rejected");
    if (surface === "agenda" && binding.data.turno.estado !== "CERRADO") return mutationFailure("conflict", "Revisá el cierre del turno antes de cobrar.", "review_required");
    // No REST UPDATE fallback, even for an already-paid row: authority may have changed.
    const response = await client.rpc("settle_pago_atomic", { p_org: session.data.organizationId, p_turno: binding.data.turno_id, p_pago: parsed.data.pagoId });
    if (response.error) return mutationRpcError(response.error);
    const receipt = settlementReceiptSchema.safeParse(response.data);
    if (!receipt.success || receipt.data.turnoId !== binding.data.turno_id || receipt.data.pago.id !== parsed.data.pagoId) return uncertainMutation();
    return { ok: true, data: receipt.data };
  } catch { return uncertainMutation(); }
}
