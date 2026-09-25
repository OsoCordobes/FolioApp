import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveSession } from "@/lib/db/session";
import { err, type Result } from "@/lib/db/errors";
import { limitByKey } from "@/lib/security/rate-limit";
import { parseCallerRpcResult } from "@/lib/caller/rpc-result";

const uuid = z.string().uuid();
const codeResult = z.object({ code: z.string().regex(/^A\d{4}$/), reused: z.boolean() });
const callResult = z.object({ code: z.string().regex(/^A\d{4}$/), destination: z.string().max(32), cursor: z.number().int().nonnegative(), reused: z.boolean() });
const pairResult = z.object({ screenId: uuid, pairCode: z.string().regex(/^[a-f0-9]{16}$/).optional(), expiresAt: z.string().optional(), alreadyIssued: z.boolean() });
const screenListResult = z.object({ screens: z.array(z.object({
  screenId: uuid,
  createdAt: z.string(),
  pairExpiresAt: z.string(),
  tokenExpiresAt: z.string().nullable(),
  status: z.enum(["pendiente", "activa", "vencida", "revocada"]),
})).max(50), nextCursor: z.object({ createdAt: z.string(), screenId: uuid }).nullable() });

function callerError(code: string | undefined, mutation: boolean) {
  if (code === "42501") return err("forbidden", "No tenés permiso para esta acción.");
  if (code === "40001") return err("conflict", "Esta operación corresponde a otro llamado. Actualizá la vista.");
  if (code === "55000") return err("transition_invalid", "Primero entregá un código de espera.");
  if (code === "22023") return err("validation", "Revisá los datos del llamado.");
  const result = err("db_error", mutation ? "No pudimos confirmar el guardado. Revisá el estado antes de volver a intentar." : "No pudimos leer la pantalla.");
  if (mutation && !result.ok) result.error.mutationOutcome = "review_required";
  return result;
}

async function staffRpc<T>(name: string, params: Record<string, unknown>, schema: z.ZodType<T>, mutation = true): Promise<Result<T>> {
  const session = await getActiveSession();
  if (!session.ok) return session;
  try {
    const max = name === "caller_create_pair" ? 30 : name === "caller_revoke_screen" ? 120 : 240;
    const limited = await limitByKey(`caller.staff.${name}`, `${session.data.organizationId}:${session.data.userId}`, max);
    if (!limited.ok) {
      const result = err("forbidden", "Esperá un momento antes de repetir esta acción.");
      if (!result.ok && mutation) result.error.mutationOutcome = "review_required";
      return result;
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(name, { p_org: session.data.organizationId, ...params });
    if (error) return callerError(error.code, mutation);
    return parseCallerRpcResult(schema, data, mutation);
  } catch {
    const result = err("network", "Se interrumpió la conexión. Revisá el estado antes de volver a intentar.");
    if (!result.ok) result.error.mutationOutcome = "uncertain";
    return result;
  }
}

export async function issueCallerCode(turnoId: string) {
  if (!uuid.safeParse(turnoId).success) return err("validation", "Turno inválido.");
  return staffRpc("caller_issue_code", { p_turno: turnoId }, codeResult);
}

export async function callWaitingCode(input: { turnoId: string; operationId: string; destination: "RECEPCION" | "CONSULTORIO"; room: number | null }) {
  if (!uuid.safeParse(input.turnoId).success || !uuid.safeParse(input.operationId).success ||
      (input.destination === "RECEPCION" ? input.room !== null : !Number.isInteger(input.room) || input.room! < 1 || input.room! > 99)) {
    return err("validation", "Elegí un destino válido.");
  }
  return staffRpc("caller_call", { p_turno: input.turnoId, p_operation: input.operationId, p_kind: input.destination, p_room: input.room }, callResult);
}

export async function createCallerPair(operationId: string) {
  if (!uuid.safeParse(operationId).success) return err("validation", "Operación inválida.");
  return staffRpc("caller_create_pair", { p_operation: operationId }, pairResult);
}

export async function revokeCallerScreen(screenId: string) {
  if (!uuid.safeParse(screenId).success) return err("validation", "Pantalla inválida.");
  return staffRpc("caller_revoke_screen", { p_screen: screenId }, z.boolean());
}

export async function listCallerScreens(cursor: { createdAt: string; screenId: string } | null = null) {
  if (cursor && (!uuid.safeParse(cursor.screenId).success || !Number.isFinite(Date.parse(cursor.createdAt)))) return err("validation", "Página inválida.");
  return staffRpc("caller_list_screens", { p_before_created: cursor?.createdAt ?? null, p_before_id: cursor?.screenId ?? null, p_limit: 20 }, screenListResult, false);
}
